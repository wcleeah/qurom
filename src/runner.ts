import { createGraph } from "./graph"
import { createTelemetry, type TelemetryRun } from "./telemetry"

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
  | { kind: "session.status"; sessionID: string; role: string; status: string }
  | { kind: "session.error"; sessionID: string; role: string; name: string; message?: string }
  | { kind: "agent.message.start"; role: string; messageID: string }
  | { kind: "agent.reasoning"; role: string; text: string }
  | {
      kind: "agent.tool"
      role: string
      tool: string
      status: "running" | "completed" | "error"
      callID: string
      error?: string
    }
  | { kind: "agent.permission"; role: string; permission: string }
  | { kind: "agent.telemetry"; role: string; tokensIn?: number; tokensOut?: number; toolCallsTotal?: number }
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

export type BridgeFactory = (config: RuntimeConfig, opts: { bus: EventBus }) => Bridge

const noopBridgeFactory: BridgeFactory = () => ({
  async start() {},
  async stop() {},
})

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

export async function runQuorum(args: RunQuorumArgs): Promise<RunResult> {
  const { config, prerequisites, request, bus, signal } = args
  const bridgeFactory = args.bridgeFactory ?? noopBridgeFactory
  const telemetryFactory = args.telemetryFactory ?? createTelemetry

  const requestId = crypto.randomUUID()
  const bridge = bridgeFactory(config, { bus })

  const telemetry = await telemetryFactory(config, {
    requestId,
    inputMode: request.inputMode,
    topic: request.inputMode === "topic" ? request.topic : undefined,
    documentPath: request.inputMode === "document" ? request.documentPath : undefined,
  })

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
          trackSessionObservation() {
            // Session-to-observation linking is owned by the opencode bridge (Phase 03+).
          },
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
      return `session.status:${event.role}:${event.status}`
    case "session.error":
      return `session.error:${event.role}:${event.name}`
    case "agent.message.start":
      return `agent.message.start:${event.role}`
    case "agent.reasoning":
      return `agent.reasoning:${event.role}`
    case "agent.tool":
      return `agent.tool:${event.role}:${event.tool}:${event.status}`
    case "agent.permission":
      return `agent.permission:${event.role}:${event.permission}`
    case "agent.telemetry":
      return `agent.telemetry:${event.role}`
    case "result":
      return "result"
    default:
      return assertNever(event)
  }
}
