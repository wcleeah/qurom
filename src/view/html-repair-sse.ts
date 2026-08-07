import { createAgentRuntime } from "../agent-runtime/runtime"
import { loadRuntimeConfig } from "../config"
import { getProviderLifecycle } from "../providers/lifecycle"
import { providerForRole } from "../providers/registry"
import { createEventBus, type Bridge, type RunnerEvent } from "../runner"
import { HTML_REPAIR_ROLE } from "../role-registry"
import {
  markRepairThreadIdle,
  markRepairThreadStale,
  refreshRepairThreadHtmlMtime,
} from "./html-repair-agent"
import { resolveRepairHtml } from "./html-repair-context"
import { appendHtmlReaderRepairMessage } from "./html-repair-store"
import { formatSseEvent, type SseEventName } from "./html-ask-sse"

export interface StreamRepairMessageInput {
  runName: string
  htmlFile: string
  contextQuote?: string | null
  contextPrefix?: string
  contextSuffix?: string
  threadId?: string | null
  message: string
  prepare: typeof import("./html-repair-agent").prepareRepairMessage
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

export async function streamRepairMessage(input: StreamRepairMessageInput): Promise<Response> {
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

      controller.enqueue(encoder.encode(": connected\n\n"))
      send("status", { phase: "preparing" })

      let prepared: Awaited<ReturnType<typeof input.prepare>> | undefined
      try {
        const config = await loadRuntimeConfig()
        releaseProvider = await getProviderLifecycle().acquireForRoles(config, [HTML_REPAIR_ROLE])

        prepared = await input.prepare({
          runName: input.runName,
          htmlFile: input.htmlFile,
          contextQuote: input.contextQuote,
          contextPrefix: input.contextPrefix,
          contextSuffix: input.contextSuffix,
          threadId: input.threadId,
          message: input.message,
        })

        send("thread", {
          threadId: prepared.thread.id,
          created: prepared.created,
          bootstrap: prepared.bootstrap,
        })
        send("status", { phase: "running" })

        const bus = createEventBus()
        const provider = providerForRole(config, HTML_REPAIR_ROLE)
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

        const runtime = createAgentRuntime(config, bus)
        prepared.handle.keepAlive = true
        const result = await runtime.prompt({
          role: HTML_REPAIR_ROLE,
          handle: prepared.handle,
          prompt: prepared.prompt,
          inputFiles: prepared.inputFiles,
          outputFile: prepared.outputFile,
        })

        const finalText = (result.text ?? assistantText).trim() || "OK — repair complete."

        const assistantMessage = await appendHtmlReaderRepairMessage({
          threadId: prepared.thread.id,
          role: "assistant",
          content: finalText,
        })

        const html = await resolveRepairHtml(input.runName, input.htmlFile)
        await refreshRepairThreadHtmlMtime(prepared.thread.id, html)
        markRepairThreadIdle(prepared.thread.id)

        send("status", { phase: "done" })
        send("done", {
          userMessageId: prepared.userMessageId,
          assistantMessageId: assistantMessage.id,
          text: finalText,
          reloadHtml: true,
        })
      } catch (error) {
        if (prepared) {
          markRepairThreadIdle(prepared.thread.id)
          if (error instanceof Error && error.name === "RepairThreadStaleError") {
            markRepairThreadStale(prepared.thread.id)
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
