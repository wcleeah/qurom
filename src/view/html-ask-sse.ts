import { createAgentRuntime } from "../agent-runtime/runtime"
import { loadRuntimeConfig } from "../config"
import { loadPromptBundle } from "../prompt-assets"
import { getProviderLifecycle } from "../providers/lifecycle"
import { providerForRole } from "../providers/registry"
import { createEventBus, type Bridge, type RunnerEvent } from "../runner"
import { HTML_READING_COMPANION_ROLE, markAskThreadIdle, markAskThreadStale } from "./html-ask-agent"
import { appendHtmlReaderAskMessage } from "./html-ask-store"

export type SseEventName = "thread" | "status" | "delta" | "done" | "error"

export function formatSseEvent(event: SseEventName, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export interface StreamAskMessageInput {
  runName: string
  htmlFile: string
  scope: "page" | "highlight"
  highlightId?: string | null
  threadId?: string | null
  message: string
  prepare: typeof import("./html-ask-agent").prepareAskMessage
}

function encodeSseStream(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}

export async function streamAskMessage(input: StreamAskMessageInput): Promise<Response> {
  const encoder = new TextEncoder()
  let bridge: Bridge | undefined
  let unsubscribe: (() => void) | undefined
  let releaseProvider: (() => Promise<void>) | undefined
  let assistantText = ""

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SseEventName, data: unknown) => {
        controller.enqueue(encoder.encode(formatSseEvent(event, data)))
      }

      // Flush bytes immediately so Bun does not treat the connection as idle during setup.
      controller.enqueue(encoder.encode(": connected\n\n"))
      send("status", { phase: "preparing" })

      let prepared: Awaited<ReturnType<typeof input.prepare>> | undefined
      try {
        prepared = await input.prepare({
          runName: input.runName,
          htmlFile: input.htmlFile,
          scope: input.scope,
          highlightId: input.highlightId,
          threadId: input.threadId,
          message: input.message,
        })

        send("thread", {
          threadId: prepared.thread.id,
          scope: prepared.thread.scope,
          highlightId: prepared.thread.highlightId,
          created: prepared.created,
          bootstrap: prepared.bootstrap,
        })
        send("status", { phase: "running" })

        const config = await loadRuntimeConfig()
        const promptBundle = await loadPromptBundle(config)
        const bus = createEventBus()
        const provider = providerForRole(config, HTML_READING_COMPANION_ROLE)
        releaseProvider = await getProviderLifecycle().acquireForRoles(config, [HTML_READING_COMPANION_ROLE])
        if (provider.createEventBridge) {
          bridge = provider.createEventBridge({
            config,
            bus,
            getRunDir: () => undefined,
          })
          await bridge.start()
        }

        unsubscribe = bus.on((event: RunnerEvent) => {
          if (!prepared || event.kind === "lifecycle" || event.kind === "graph.node" || event.kind === "result" || event.kind === "design.phase") {
            return
          }
          if ("sessionID" in event && event.sessionID !== prepared.handle.id) {
            return
          }
          if (event.kind === "agent.message.text" && event.text) {
            if (!event.done) {
              assistantText += event.text
              send("delta", { text: event.text })
            }
          }
          if (event.kind === "session.error") {
            send("error", { code: "provider_error", message: event.message ?? event.name })
          }
        })

        const runtime = createAgentRuntime(config, bus, {
          roleInstructions: promptBundle.roleInstructions,
        })
        prepared.handle.keepAlive = true
        const result = await runtime.prompt({
          role: HTML_READING_COMPANION_ROLE,
          handle: prepared.handle,
          prompt: prepared.prompt,
          inputFiles: prepared.inputFiles,
        })

        const finalText = (result.text ?? assistantText).trim()
        if (!finalText) {
          throw new Error("Provider returned an empty response")
        }

        const assistantMessage = await appendHtmlReaderAskMessage({
          threadId: prepared.thread.id,
          role: "assistant",
          content: finalText,
        })

        send("status", { phase: "done" })
        send("done", {
          userMessageId: prepared.userMessageId,
          assistantMessageId: assistantMessage.id,
          text: finalText,
        })
        markAskThreadIdle(prepared.thread.id)
      } catch (error) {
        if (prepared) {
          markAskThreadIdle(prepared.thread.id)
          if (error instanceof Error && error.name === "AskThreadStaleError") {
            markAskThreadStale(prepared.thread.id)
          }
        }
        const message = error instanceof Error ? error.message : String(error)
        send("error", { code: error instanceof Error ? error.name : "error", message })
        send("status", { phase: "error" })
      } finally {
        unsubscribe?.()
        await bridge?.stop().catch(() => {})
        if (releaseProvider) await releaseProvider().catch(() => {})
        controller.close()
      }
    },
  })

  return encodeSseStream(stream)
}
