import { createOpencodeClient } from "@opencode-ai/sdk/v2"

import type { RuntimeConfig } from "./config"

type RunProgressConsole = {
  enabled: boolean
  trackSession: (sessionID: string, role: string) => void
  trackNodeStart: (node: string) => void
  trackNodeEnd: (node: string) => void
  start: () => Promise<void>
  stop: () => Promise<void>
}

function formatEventLine(role: string | undefined, text: string) {
  if (!role) return `[progress] ${text}`
  return `[${role}] ${text}`
}

function formatErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export function createTelemetryEnrichment(config: RuntimeConfig): RunProgressConsole {
  if (!process.stdout.isTTY) {
    return {
      enabled: false,
      trackSession() {},
      trackNodeStart() {},
      trackNodeEnd() {},
      async start() {},
      async stop() {},
    }
  }

  const client = createOpencodeClient({
    baseUrl: config.env.OPENCODE_BASE_URL,
    directory: config.env.OPENCODE_DIRECTORY,
  })
  const trackedSessions = new Map<string, string>()
  const activeReasoningParts = new Set<string>()
  const reasoningBuffers = new Map<string, string>()
  const seenAssistantMessages = new Set<string>()
  const seenPermissionRequests = new Set<string>()
  const seenToolStates = new Set<string>()
  const lastSessionStatuses = new Map<string, string>()
  const abortController = new AbortController()
  let streamTask: Promise<void> | undefined

  function logProgress(role: string | undefined, text: string) {
    console.log(formatEventLine(role, text))
  }

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

    logProgress(role, `thinking ${normalized}`)
  }

  return {
    enabled: true,
    trackSession(sessionID, role) {
      trackedSessions.set(sessionID, role)
      logProgress(role, `session created ${sessionID}`)
    },
    trackNodeStart(node) {
      logProgress(undefined, `node start ${node}`)
    },
    trackNodeEnd(node) {
      logProgress(undefined, `node end ${node}`)
    },
    async start() {
      if (streamTask) return

      streamTask = (async () => {
        const response = await client.event.subscribe(
          {},
          {
            signal: abortController.signal,
          },
        )

        for await (const event of response.stream) {
          if (event.type === "session.status") {
            const role = trackedSessions.get(event.properties.sessionID)
            if (!role) continue

            const nextStatus =
              event.properties.status.type === "retry"
                ? `retry ${event.properties.status.attempt}`
                : event.properties.status.type

            if (lastSessionStatuses.get(event.properties.sessionID) === nextStatus) continue

            lastSessionStatuses.set(event.properties.sessionID, nextStatus)
            logProgress(role, `session ${nextStatus}`)
            continue
          }

          if (event.type === "session.error") {
            const sessionID = event.properties.sessionID
            const role = sessionID ? trackedSessions.get(sessionID) : undefined
            if (!role) continue

            const name = event.properties.error?.name ?? "UnknownError"
            const detail =
              typeof event.properties.error?.data?.message === "string" ? `: ${event.properties.error.data.message}` : ""

            logProgress(role, `session error ${name}${detail}`)
            continue
          }

          if (event.type === "permission.asked") {
            const role = trackedSessions.get(event.properties.sessionID)
            if (!role) continue
            if (seenPermissionRequests.has(event.properties.id)) continue

            seenPermissionRequests.add(event.properties.id)
            logProgress(role, `permission asked ${event.properties.permission}`)
            continue
          }

          if (event.type === "message.updated") {
            const role = trackedSessions.get(event.properties.sessionID)
            if (!role) continue
            if (event.properties.info.role !== "assistant") continue
            if (seenAssistantMessages.has(event.properties.info.id)) continue

            seenAssistantMessages.add(event.properties.info.id)
            logProgress(role, "assistant started")
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

          const toolStateKey = `${part.messageID}:${part.id}:${part.state.status}`
          if (seenToolStates.has(toolStateKey)) continue

          seenToolStates.add(toolStateKey)
          logProgress(
            role,
            `tool ${part.tool} ${part.state.status === "error" ? "failed" : part.state.status}`,
          )
        }
      })().catch((error) => {
        if (abortController.signal.aborted) return
        logProgress(undefined, `event stream unavailable ${formatErrorMessage(error)}`)
      })
    },
    async stop() {
      abortController.abort()
      await streamTask
    },
  }
}
