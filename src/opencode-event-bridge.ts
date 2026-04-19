import { createOpencodeClient } from "@opencode-ai/sdk/v2"

import type { RuntimeConfig } from "./config"
import type { Bridge, EventBus } from "./runner"

type OpencodeClient = ReturnType<typeof createOpencodeClient>

export type OpencodeBridgeOptions = {
  bus: EventBus
  runDir: string
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
  const { bus, runDir } = opts
  const captureEvents = config.env.QUORUM_CAPTURE_OPENCODE_EVENTS === "1"
  const captureSyncHistory = config.env.QUORUM_CAPTURE_SYNC_HISTORY === "1"

  const client = (opts.clientFactory ?? defaultClientFactory)(config)

  const activeReasoningParts = new Set<string>()
  const reasoningBuffers = new Map<string, string>()
  const seenAssistantMessages = new Set<string>()
  const seenPermissionRequests = new Set<string>()
  const seenToolStates = new Set<string>()
  const lastSessionStatuses = new Map<string, string>()
  const capturedEvents: unknown[] = []

  let abortController = new AbortController()
  let streamTask: Promise<void> | undefined

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

  // Pure: returns the normalized buffer text (or undefined if nothing to flush).
  // Caller owns the reasoningBuffers mutation and bus emission.
  function takeReasoning(key: string): string | undefined {
    const text = reasoningBuffers.get(key)
    if (!text) return undefined
    const normalized = text.replace(/\s+/g, " ").trim()
    if (!normalized) return undefined
    return normalized
  }

  async function persistArtifacts() {
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

  async function consumeStream() {
    const response = await client.event.subscribe(
      { directory: config.env.OPENCODE_DIRECTORY },
      { signal: abortController.signal },
    )

    for await (const event of response.stream) {
      if (captureEvents) capturedEvents.push(event)

      if (event.type === "session.idle") {
        void persistArtifacts().catch(() => {})
        continue
      }

      if (event.type === "session.status") {
        const sessionID = event.properties.sessionID
        const nextStatus =
          event.properties.status.type === "retry"
            ? `retry ${event.properties.status.attempt}`
            : event.properties.status.type

        if (lastSessionStatuses.get(sessionID) === nextStatus) continue

        lastSessionStatuses.set(sessionID, nextStatus)
        bus.emit({ kind: "session.status", sessionID, status: nextStatus })
        continue
      }

      if (event.type === "session.error") {
        const sessionID = event.properties.sessionID
        if (!sessionID) continue

        const name = event.properties.error?.name ?? "UnknownError"
        const message =
          typeof event.properties.error?.data?.message === "string" ? event.properties.error.data.message : undefined

        bus.emit({ kind: "session.error", sessionID, name, message })
        continue
      }

      if (event.type === "permission.asked") {
        if (seenPermissionRequests.has(event.properties.id)) continue

        seenPermissionRequests.add(event.properties.id)

        bus.emit({
          kind: "agent.permission",
          permission: event.properties.permission,
          sessionID: event.properties.sessionID,
          messageID: event.properties.tool?.messageID,
          callID: event.properties.tool?.callID,
        })
        continue
      }

      if (event.type === "message.updated") {
        if (event.properties.info.role !== "assistant") continue
        if (seenAssistantMessages.has(event.properties.info.id)) continue

        seenAssistantMessages.add(event.properties.info.id)
        bus.emit({
          kind: "agent.message.start",
          sessionID: event.properties.sessionID,
          messageID: event.properties.info.id,
        })
        continue
      }

      if (event.type === "message.part.delta") {
        if (event.properties.field !== "text") continue

        const sessionID = event.properties.sessionID
        const key = reasoningPartKey(sessionID, event.properties.messageID, event.properties.partID)
        if (!activeReasoningParts.has(key)) continue

        const nextBuffer = `${reasoningBuffers.get(key) ?? ""}${event.properties.delta}`
        reasoningBuffers.set(key, nextBuffer)
        if (!shouldFlushReasoning(nextBuffer)) continue

        const text = takeReasoning(key)
        reasoningBuffers.set(key, "")
        if (text) bus.emit({ kind: "agent.reasoning", sessionID, text })
        continue
      }

      if (event.type !== "message.part.updated") continue

      const part = event.properties.part
      const sessionID = event.properties.sessionID

      if (part.type === "reasoning") {
        const key = reasoningPartKey(sessionID, part.messageID, part.id)
        if (!part.time?.end) {
          activeReasoningParts.add(key)
          if (!reasoningBuffers.has(key)) reasoningBuffers.set(key, "")
          continue
        }

        const text = takeReasoning(key)
        reasoningBuffers.delete(key)
        activeReasoningParts.delete(key)
        if (text) bus.emit({ kind: "agent.reasoning", sessionID, text })
        continue
      }

      if (part.type !== "tool") continue
      if (part.state.status === "pending") continue

      const toolStateKey = `${sessionID}:${part.messageID}:${part.id}:${part.state.status}`
      if (seenToolStates.has(toolStateKey)) continue
      seenToolStates.add(toolStateKey)

      const status: "running" | "completed" | "error" =
        part.state.status === "completed" ? "completed" : part.state.status === "error" ? "error" : "running"
      const errorText =
        part.state.status === "error" && part.state.error ? formatErrorMessage(part.state.error) : undefined
      const partMetadata = "metadata" in part.state && part.state.metadata ? part.state.metadata : undefined
      const output = part.state.status === "completed" && "output" in part.state ? part.state.output : undefined

      bus.emit({
        kind: "agent.tool",
        tool: part.tool,
        status,
        callID: part.callID,
        sessionID,
        messageID: part.messageID,
        partID: part.id,
        input: part.state.input,
        output,
        metadata: partMetadata as Record<string, unknown> | undefined,
        error: errorText,
      })
    }
  }

  return {
    async start() {
      if (streamTask) return

      // Fresh AbortController so a restart after stop() opens a new subscription.
      if (abortController.signal.aborted) {
        abortController = new AbortController()
      }

      streamTask = consumeStream().catch((error) => {
        if (abortController.signal.aborted) return
        // Stream failures cannot be attributed to a specific session here; swallow silently.
        void error
      })
    },
    async stop() {
      abortController.abort()
      const pending = streamTask
      streamTask = undefined
      await pending
      // Final snapshot flush so a clean shutdown captures any unwritten events.
      await persistArtifacts().catch(() => {})
    },
  }
}
