import { createGraph } from "./graph"
import { createOpencodeEventBridge } from "./opencode-event-bridge"
import { ensureRunDir } from "./output"
import { createTelemetry, type TelemetryRun, type TraceObservation } from "./telemetry"

import type { RuntimeConfig } from "./config"
import type { InputRequest } from "./schema"
import type { validateRuntimePrerequisites } from "./opencode"

export type RunnerEvent =
  | {
      kind: "lifecycle"
      phase: "starting" | "running" | "complete" | "error"
      requestId: string
      traceId?: string
      outputDir?: string
      error?: unknown
    }
  | { kind: "graph.node"; node: string; phase: "start" | "end" }
  | { kind: "session.created"; sessionID: string; role: string }
  | { kind: "session.status"; sessionID: string; status: string }
  | { kind: "session.error"; sessionID: string; name: string; message?: string }
  | { kind: "agent.message.start"; sessionID: string; messageID: string }
  | { kind: "agent.reasoning"; sessionID: string; text: string }
  | {
      kind: "agent.tool"
      tool: string
      status: "running" | "completed" | "error"
      callID: string
      sessionID: string
      messageID: string
      partID: string
      input?: unknown
      output?: unknown
      metadata?: Record<string, unknown>
      error?: string
    }
  | {
      kind: "agent.permission"
      permission: string
      sessionID: string
      messageID?: string
      callID?: string
    }
  | { kind: "result"; runResult: unknown }

export type RunnerEventListener = (event: RunnerEvent) => void

export type EventBus = {
  emit: (event: RunnerEvent) => void
  on: (listener: RunnerEventListener) => () => void
  off: (listener: RunnerEventListener) => void
}

export function createEventBus(): EventBus {
  const listeners = new Set<RunnerEventListener>()
  return {
    emit(event) {
      for (const listener of listeners) {
        try {
          listener(event)
        } catch {
          // Listener errors are isolated; one bad subscriber must not break others.
        }
      }
    },
    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    off(listener) {
      listeners.delete(listener)
    },
  }
}

export type Bridge = {
  start: () => Promise<void>
  stop: () => Promise<void>
}

export type BridgeFactory = (config: RuntimeConfig, opts: { bus: EventBus; runDir: string }) => Bridge

export type RuntimePrerequisites = Awaited<ReturnType<typeof validateRuntimePrerequisites>>

export type RunQuorumArgs = {
  config: RuntimeConfig
  prerequisites: RuntimePrerequisites
  request: InputRequest
  bus: EventBus
  signal?: AbortSignal
  bridgeFactory?: BridgeFactory
  telemetryFactory?: (
    config: RuntimeConfig,
    input: { requestId: string; inputMode: "topic" | "document"; topic?: string; documentPath?: string },
  ) => Promise<TelemetryRun>
}

export type RunResult = {
  requestId: string
  traceId?: string
  outputPath?: string
  outcome: string
  raw: unknown
}

function toolKey(event: { sessionID: string; messageID: string; partID: string }) {
  return `${event.sessionID}:${event.messageID}:${event.partID}`
}

function permissionKey(input: { sessionID: string; messageID?: string; callID?: string }) {
  return `${input.sessionID}:${input.messageID ?? ""}:${input.callID ?? ""}`
}

// Subscribes to bus.agent.tool / bus.agent.permission and owns Langfuse Tool span lifecycle.
// Maintains its own sessionID -> role map (built from session.created) so it can attach role
// metadata to spans even though bridge events no longer carry role.
// Per-key promise chain preserves the natural ordering the bridge stream provides while
// still letting other tool keys progress in parallel.
// Exported for direct testing; runQuorum is the only production caller.
export function attachTelemetryListener(bus: EventBus, telemetry: TelemetryRun) {
  const sessionObservations = new Map<string, TraceObservation>()
  const sessionRoles = new Map<string, string>()
  const toolObservations = new Map<string, TraceObservation>()
  const toolPermissions = new Map<string, string[]>()
  const pending = new Map<string, Promise<void>>()

  const off = bus.on((event) => {
    if (event.kind === "session.created") {
      sessionRoles.set(event.sessionID, event.role)
      return
    }

    if (event.kind === "agent.permission") {
      if (!event.messageID || !event.callID) return
      // Filter events for sessions this run did not spawn (bridge no longer filters).
      if (!sessionRoles.has(event.sessionID)) return
      const key = permissionKey(event)
      const list = toolPermissions.get(key) ?? []
      list.push(event.permission)
      toolPermissions.set(key, list)
      return
    }

    if (event.kind !== "agent.tool") return
    if (!sessionRoles.has(event.sessionID)) return

    const key = toolKey(event)
    const permKey = permissionKey({
      sessionID: event.sessionID,
      messageID: event.messageID,
      callID: event.callID,
    })
    const role = sessionRoles.get(event.sessionID) ?? "unknown"
    const snapshot = { ...event, role, permKey }

    const previous = pending.get(key) ?? Promise.resolve()
    const next = previous.then(() => handle(snapshot)).catch(() => {})
    pending.set(
      key,
      next.finally(() => {
        if (pending.get(key) === next) pending.delete(key)
      }),
    )
  })

  async function handle(snapshot: {
    role: string
    tool: string
    status: "running" | "completed" | "error"
    callID: string
    sessionID: string
    messageID: string
    partID: string
    input?: unknown
    output?: unknown
    metadata?: Record<string, unknown>
    error?: string
    permKey: string
  }) {
    const key = toolKey(snapshot)
    const existing = toolObservations.get(key)

    if (!existing) {
      const parent = sessionObservations.get(snapshot.sessionID)
      if (!parent) return // No parent span available yet; skip silently.

      const observation = await telemetry.startObservation({
        traceId: parent.traceId,
        parentObservationId: parent.id,
        name: `tool.${snapshot.tool}`,
        type: "Tool",
        input: {
          tool: snapshot.tool,
          callId: snapshot.callID,
          args: snapshot.input,
        },
        metadata: {
          role: snapshot.role,
          sessionId: snapshot.sessionID,
          messageId: snapshot.messageID,
          partId: snapshot.partID,
          callId: snapshot.callID,
          permissions: toolPermissions.get(snapshot.permKey),
          ...(snapshot.metadata ? { toolMetadata: snapshot.metadata } : {}),
        },
      })
      if (observation) toolObservations.set(key, observation)
    }

    if (snapshot.status === "completed" || snapshot.status === "error") {
      const observation = toolObservations.get(key)
      await telemetry.endObservation(observation, {
        output: {
          tool: snapshot.tool,
          status: snapshot.status,
          result: snapshot.status === "completed" ? snapshot.output : undefined,
          error: snapshot.status === "error" ? snapshot.error : undefined,
        },
        metadata: {
          role: snapshot.role,
          sessionId: snapshot.sessionID,
          callId: snapshot.callID,
          permissions: toolPermissions.get(snapshot.permKey),
          ...(snapshot.metadata ? { toolMetadata: snapshot.metadata } : {}),
        },
        level: snapshot.status === "error" ? "ERROR" : undefined,
      })
      toolObservations.delete(key)
      toolPermissions.delete(snapshot.permKey)
    }
  }

  function trackSessionObservation(sessionID: string, observation: TraceObservation | undefined) {
    if (!observation) return
    sessionObservations.set(sessionID, observation)
  }

  async function dispose() {
    off()
    await Promise.allSettled([...pending.values()])
  }

  return { trackSessionObservation, dispose }
}

export async function runQuorum(args: RunQuorumArgs): Promise<RunResult> {
  const { config, prerequisites, request, bus, signal } = args
  const bridgeFactory = args.bridgeFactory ?? createOpencodeEventBridge
  const telemetryFactory = args.telemetryFactory ?? createTelemetry

  const requestId = crypto.randomUUID()
  const runDir = await ensureRunDir(config.quorumConfig.artifactDir, requestId)

  const telemetry = await telemetryFactory(config, {
    requestId,
    inputMode: request.inputMode,
    topic: request.inputMode === "topic" ? request.topic : undefined,
    documentPath: request.inputMode === "document" ? request.documentPath : undefined,
  })

  const bridge = bridgeFactory(config, { bus, runDir })
  const telemetryListener = attachTelemetryListener(bus, telemetry)

  bus.emit({
    kind: "lifecycle",
    phase: "starting",
    requestId,
    traceId: telemetry.traceId,
  })

  await bridge.start()

  try {
    const runResult = await telemetry.runWithRootObservation(async () => {
      bus.emit({ kind: "lifecycle", phase: "running", requestId, traceId: telemetry.traceId })

      const graph = createGraph(config, prerequisites.skill.content, {
        observer: {
          onNodeStart(node) {
            bus.emit({ kind: "graph.node", node, phase: "start" })
          },
          onNodeEnd(node) {
            bus.emit({ kind: "graph.node", node, phase: "end" })
          },
          onSessionCreated({ sessionID, role }) {
            bus.emit({ kind: "session.created", sessionID, role })
          },
        },
        telemetry: {
          run: telemetry,
          trackSessionObservation: telemetryListener.trackSessionObservation,
        },
      })

      const invocation = await graph.invoke(
        { ...request, requestId },
        { configurable: { thread_id: requestId }, signal },
      )

      const traceMetadata = {
        requestId: invocation.requestId,
        status: invocation.status,
        round: invocation.round,
        approvedAgents: invocation.approvedAgents,
        unresolvedFindings: invocation.unresolvedFindings.length,
        failureReason: invocation.failureReason,
        outputPath: invocation.outputPath,
        traced: telemetry.enabled,
      }

      await telemetry.updateTrace({
        output: {
          requestId: invocation.requestId,
          outcome: invocation.status,
          round: invocation.round,
          approvedAgents: invocation.approvedAgents,
          unresolvedFindings: invocation.unresolvedFindings.length,
          failureReason: invocation.failureReason,
          outputPath: invocation.outputPath,
        },
        metadata: traceMetadata,
      })

      return invocation
    })

    bus.emit({ kind: "result", runResult })
    bus.emit({
      kind: "lifecycle",
      phase: "complete",
      requestId,
      traceId: telemetry.traceId,
      outputDir: runResult.outputPath,
    })

    return {
      requestId,
      traceId: telemetry.traceId,
      outputPath: runResult.outputPath,
      outcome: runResult.status,
      raw: runResult,
    }
  } catch (error) {
    bus.emit({
      kind: "lifecycle",
      phase: "error",
      requestId,
      traceId: telemetry.traceId,
      error,
    })
    throw error
  } finally {
    try {
      await telemetryListener.dispose()
    } catch {
      // Telemetry listener disposal errors must not mask the original failure.
    }
    try {
      await telemetry.shutdown()
    } catch {
      // Telemetry shutdown errors must not mask the original failure.
    }
    try {
      await bridge.stop()
    } catch {
      // Bridge shutdown errors must not mask the original failure.
    }
  }
}

// Compile-time exhaustiveness check: missing a RunnerEvent kind here fails `tsc`.
function assertNever(value: never): never {
  throw new Error(`unexpected RunnerEvent kind: ${JSON.stringify(value)}`)
}

export function describeRunnerEvent(event: RunnerEvent): string {
  switch (event.kind) {
    case "lifecycle":
      return `lifecycle:${event.phase}`
    case "graph.node":
      return `graph.node:${event.node}:${event.phase}`
    case "session.created":
      return `session.created:${event.role}`
    case "session.status":
      return `session.status:${event.sessionID}:${event.status}`
    case "session.error":
      return `session.error:${event.sessionID}:${event.name}`
    case "agent.message.start":
      return `agent.message.start:${event.sessionID}`
    case "agent.reasoning":
      return `agent.reasoning:${event.sessionID}`
    case "agent.tool":
      return `agent.tool:${event.sessionID}:${event.tool}:${event.status}`
    case "agent.permission":
      return `agent.permission:${event.sessionID}:${event.permission}`
    case "result":
      return "result"
    default:
      return assertNever(event)
  }
}
