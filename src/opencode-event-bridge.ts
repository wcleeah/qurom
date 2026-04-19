import { createOpencodeClient } from "@opencode-ai/sdk/v2"

import type { RuntimeConfig } from "./config"
import type { Bridge, EventBus, RunnerEvent } from "./runner"

type OpencodeClient = ReturnType<typeof createOpencodeClient>

export type OpencodeBridgeOptions = {
  bus: EventBus
  // Test seam: inject a stub client. Defaults to the real opencode SDK client.
  clientFactory?: (config: RuntimeConfig) => OpencodeClient
}

function formatErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function defaultClientFactory(config: RuntimeConfig): OpencodeClient {
  return createOpencodeClient({
    baseUrl: config.env.OPENCODE_BASE_URL,
    directory: config.env.OPENCODE_DIRECTORY,
  })
}

export function createOpencodeEventBridge(config: RuntimeConfig, opts: OpencodeBridgeOptions): Bridge {
  const { bus } = opts
  const captureEvents = config.env.QUORUM_CAPTURE_OPENCODE_EVENTS === "1"
  const captureSyncHistory = config.env.QUORUM_CAPTURE_SYNC_HISTORY === "1"

  const client = (opts.clientFactory ?? defaultClientFactory)(config)

  const trackedSessions = new Map<string, string>()
  const activeReasoningParts = new Set<string>()
  const reasoningBuffers = new Map<string, string>()
  const seenAssistantMessages = new Set<string>()
  const seenPermissionRequests = new Set<string>()
  const seenToolStates = new Set<string>()
  const lastSessionStatuses = new Map<string, string>()
  const roleCounters = new Map<string, { tools: number; errors: number }>()
  const capturedEvents: unknown[] = []

  let abortController = new AbortController()
  let streamTask: Promise<void> | undefined
  let unsubscribeBus: (() => void) | undefined

  function reasoningPartKey(sessionID: string, messageID: string, partID: string) {
    return `${sessionID}:${messageID}:${partID}`
  }

  function shouldFlushReasoning(buffer: string) {
    const normalized = buffer.replace(/\s+/g, " ").trim()
    if (!normalized) return false
    if (buffer.includes("\n")) return true
    if (/[.!?:]["')\]]?\s*$/.test(buffer)) return true
    return normalized.length >= 140
  }

  function flushReasoning(role: string, key: string) {
    const text = reasoningBuffers.get(key)
    if (!text) return

    const normalized = text.replace(/\s+/g, " ").trim()
    reasoningBuffers.set(key, "")
    if (!normalized) return

    bus.emit({ kind: "agent.reasoning", role, text: normalized })
  }

  function bumpToolCounter(role: string, status: "running" | "completed" | "error") {
    const counter = roleCounters.get(role) ?? { tools: 0, errors: 0 }
    if (status === "running") counter.tools += 1
    if (status === "error") counter.errors += 1
    roleCounters.set(role, counter)
    bus.emit({ kind: "agent.telemetry", role, toolCallsTotal: counter.tools })
  }

  async function persistArtifacts(runDir: string) {
    if (captureEvents && capturedEvents.length > 0) {
      await Bun.write(`${runDir}/opencode-events.json`, JSON.stringify(capturedEvents, null, 2))
    }

    if (!captureSyncHistory) return

    await Bun.write(
      `${runDir}/opencode-sync-history.json`,
      JSON.stringify(
        {
          deferred: true,
          reason: "Installed @opencode-ai/sdk package does not expose sync.history.list()",
        },
        null,
        2,
      ),
    )
  }

  function handleBusEvent(event: RunnerEvent) {
    if (event.kind === "session.created") {
      trackedSessions.set(event.sessionID, event.role)
      return
    }
    if (event.kind === "lifecycle" && event.phase === "complete" && event.outputDir) {
      // Fire-and-forget: persistArtifacts errors must not crash the bridge.
      void persistArtifacts(event.outputDir).catch(() => {})
    }
  }

  async function consumeStream() {
    const response = await client.event.subscribe(
      { directory: config.env.OPENCODE_DIRECTORY },
      { signal: abortController.signal },
    )

    for await (const event of response.stream) {
      if (
        captureEvents &&
        "properties" in event &&
        typeof event.properties === "object" &&
        event.properties &&
        "sessionID" in event.properties &&
        typeof event.properties.sessionID === "string" &&
        trackedSessions.has(event.properties.sessionID)
      ) {
        capturedEvents.push(event)
      }

      if (event.type === "session.status") {
        const role = trackedSessions.get(event.properties.sessionID)
        if (!role) continue

        const nextStatus =
          event.properties.status.type === "retry"
            ? `retry ${event.properties.status.attempt}`
            : event.properties.status.type

        if (lastSessionStatuses.get(event.properties.sessionID) === nextStatus) continue

        lastSessionStatuses.set(event.properties.sessionID, nextStatus)
        bus.emit({ kind: "session.status", sessionID: event.properties.sessionID, role, status: nextStatus })
        continue
      }

      if (event.type === "session.error") {
        const sessionID = event.properties.sessionID
        const role = sessionID ? trackedSessions.get(sessionID) : undefined
        if (!role || !sessionID) continue

        const name = event.properties.error?.name ?? "UnknownError"
        const message =
          typeof event.properties.error?.data?.message === "string" ? event.properties.error.data.message : undefined

        bus.emit({ kind: "session.error", sessionID, role, name, message })
        continue
      }

      if (event.type === "permission.asked") {
        const role = trackedSessions.get(event.properties.sessionID)
        if (!role) continue
        if (seenPermissionRequests.has(event.properties.id)) continue

        seenPermissionRequests.add(event.properties.id)

        bus.emit({
          kind: "agent.permission",
          role,
          permission: event.properties.permission,
          sessionID: event.properties.sessionID,
          messageID: event.properties.tool?.messageID,
          callID: event.properties.tool?.callID,
        })
        continue
      }

      if (event.type === "message.updated") {
        const role = trackedSessions.get(event.properties.sessionID)
        if (!role) continue
        if (event.properties.info.role !== "assistant") continue
        if (seenAssistantMessages.has(event.properties.info.id)) continue

        seenAssistantMessages.add(event.properties.info.id)
        bus.emit({ kind: "agent.message.start", role, messageID: event.properties.info.id })
        continue
      }

      if (event.type === "message.part.delta") {
        const role = trackedSessions.get(event.properties.sessionID)
        if (!role) continue
        if (event.properties.field !== "text") continue

        const key = reasoningPartKey(event.properties.sessionID, event.properties.messageID, event.properties.partID)
        if (!activeReasoningParts.has(key)) continue

        const nextBuffer = `${reasoningBuffers.get(key) ?? ""}${event.properties.delta}`
        reasoningBuffers.set(key, nextBuffer)
        if (!shouldFlushReasoning(nextBuffer)) continue

        flushReasoning(role, key)
        continue
      }

      if (event.type !== "message.part.updated") continue

      const role = trackedSessions.get(event.properties.sessionID)
      if (!role) continue
      const part = event.properties.part

      if (part.type === "reasoning") {
        const key = reasoningPartKey(event.properties.sessionID, part.messageID, part.id)
        if (!part.time?.end) {
          activeReasoningParts.add(key)
          if (!reasoningBuffers.has(key)) {
            reasoningBuffers.set(key, "")
          }
          continue
        }

        flushReasoning(role, key)
        activeReasoningParts.delete(key)
        reasoningBuffers.delete(key)
        continue
      }

      if (part.type !== "tool") continue
      if (part.state.status === "pending") continue

      const toolStateKey = `${event.properties.sessionID}:${part.messageID}:${part.id}:${part.state.status}`
      if (seenToolStates.has(toolStateKey)) continue
      seenToolStates.add(toolStateKey)

      const status: "running" | "completed" | "error" =
        part.state.status === "completed" ? "completed" : part.state.status === "error" ? "error" : "running"
      const errorText =
        part.state.status === "error" && part.state.error ? formatErrorMessage(part.state.error) : undefined
      const partMetadata = "metadata" in part.state && part.state.metadata ? part.state.metadata : undefined
      const output =
        part.state.status === "completed" && "output" in part.state ? part.state.output : undefined

      bus.emit({
        kind: "agent.tool",
        role,
        tool: part.tool,
        status,
        callID: part.callID,
        sessionID: event.properties.sessionID,
        messageID: part.messageID,
        partID: part.id,
        input: part.state.input,
        output,
        metadata: partMetadata as Record<string, unknown> | undefined,
        error: errorText,
      })
      bumpToolCounter(role, status)
    }
  }

  return {
    async start() {
      if (streamTask) return

      // Fresh AbortController so a restart after stop() opens a new subscription.
      if (abortController.signal.aborted) {
        abortController = new AbortController()
      }

      unsubscribeBus = bus.on(handleBusEvent)

      streamTask = consumeStream().catch((error) => {
        if (abortController.signal.aborted) return
        // Surface stream failures as a session.error-shaped lifecycle signal would be wrong;
        // emit a synthetic session.error without a sessionID. The TUI ignores entries it cannot map.
        // For now, swallow silently: there is no role to attribute the failure to.
        void error
      })
    },
    async stop() {
      abortController.abort()
      if (unsubscribeBus) {
        unsubscribeBus()
        unsubscribeBus = undefined
      }
      const pending = streamTask
      streamTask = undefined
      await pending
    },
  }
}
