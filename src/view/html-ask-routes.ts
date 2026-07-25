import { stat } from "node:fs/promises"

import {
  AskThreadBusyError,
  AskThreadStaleError,
  HighlightNotFoundError,
  HTML_READING_COMPANION_ROLE,
  NoSourceMarkdownError,
  preflightAskMessage,
  prepareAskMessage,
  resetAskThread,
} from "./html-ask-agent"
import { streamAskMessage } from "./html-ask-sse"
import {
  deleteHtmlReaderAskThread,
  listHtmlReaderAskMessages,
  listHtmlReaderAskThreads,
  purgeEmptyHtmlReaderAskThreads,
  type AskScope,
} from "./html-ask-store"
import { validateHtmlReaderTarget } from "./html-reader-db"
import { safeFilePath, safeRunPath } from "./paths"

function parseAskScope(value: unknown): AskScope | null {
  return value === "page" || value === "highlight" || value === "selection" ? value : null
}

async function validateHtmlFile(runName: string, file: string): Promise<void> {
  validateHtmlReaderTarget(runName, file)
  const resolved = safeFilePath(runName, file)
  const fileStat = await stat(resolved)
  if (!fileStat.isFile()) {
    throw new Error("Not found")
  }
}

export async function handleListAskThreads(runName: string, file: string): Promise<Response> {
  await validateHtmlFile(runName, file)
  await purgeEmptyHtmlReaderAskThreads(runName, file)
  const threads = await listHtmlReaderAskThreads(runName, file)
  return Response.json({ ok: true, threads })
}

export async function handleListAskMessages(
  runName: string,
  file: string,
  threadId: string,
): Promise<Response> {
  await validateHtmlFile(runName, file)
  const messages = await listHtmlReaderAskMessages(threadId)
  return Response.json({ ok: true, messages })
}

export async function handleDeleteAskThread(
  runName: string,
  file: string,
  threadId: string,
): Promise<Response> {
  await validateHtmlFile(runName, file)
  await resetAskThread({ runName, htmlFile: file, threadId })
  const deleted = await deleteHtmlReaderAskThread(runName, file, threadId)
  if (!deleted) {
    return new Response("Not found", { status: 404 })
  }
  return Response.json({ ok: true })
}

export async function handlePostAskMessage(req: Request, runName: string): Promise<Response> {
  const raw = await req.text()
  let file = ""
  let scope: AskScope | null = null
  let highlightId: string | null = null
  let contextQuote: string | null = null
  let contextPrefix = ""
  let contextSuffix = ""
  let threadId: string | null = null
  let message = ""

  if (raw.trim().startsWith("{")) {
    const parsed = JSON.parse(raw) as {
      file?: unknown
      scope?: unknown
      highlightId?: unknown
      contextQuote?: unknown
      contextPrefix?: unknown
      contextSuffix?: unknown
      threadId?: unknown
      message?: unknown
    }
    file = typeof parsed.file === "string" ? parsed.file : ""
    scope = parseAskScope(parsed.scope)
    highlightId = typeof parsed.highlightId === "string" ? parsed.highlightId : null
    contextQuote = typeof parsed.contextQuote === "string" ? parsed.contextQuote : null
    contextPrefix = typeof parsed.contextPrefix === "string" ? parsed.contextPrefix : ""
    contextSuffix = typeof parsed.contextSuffix === "string" ? parsed.contextSuffix : ""
    threadId = typeof parsed.threadId === "string" ? parsed.threadId : null
    message = typeof parsed.message === "string" ? parsed.message : ""
  } else {
    const params = new URLSearchParams(raw)
    file = params.get("file") ?? ""
    scope = parseAskScope(params.get("scope"))
    highlightId = params.get("highlightId")
    contextQuote = params.get("contextQuote")
    contextPrefix = params.get("contextPrefix") ?? ""
    contextSuffix = params.get("contextSuffix") ?? ""
    threadId = params.get("threadId")
    message = params.get("message") ?? ""
  }

  if (!file || !message.trim()) {
    return new Response("Missing file or message", { status: 400 })
  }
  if (!threadId) {
    if (!scope) {
      return new Response("Missing scope for new chat", { status: 400 })
    }
    if (scope === "highlight" && !highlightId) {
      return new Response("Missing highlightId for highlight bootstrap", { status: 400 })
    }
    if (scope === "selection" && !contextQuote?.trim()) {
      return new Response("Missing contextQuote for selection bootstrap", { status: 400 })
    }
  }

  try {
    safeRunPath(runName)
    await validateHtmlFile(runName, file)
    await preflightAskMessage({
      runName,
      htmlFile: file,
      scope: scope ?? undefined,
      highlightId,
      contextQuote,
      threadId,
    })
  } catch (error) {
    if (error instanceof AskThreadBusyError) {
      return Response.json({ ok: false, code: "thread_busy", message: error.message }, { status: 409 })
    }
    if (error instanceof AskThreadStaleError) {
      return Response.json({ ok: false, code: "thread_stale", canReset: true, message: error.message }, { status: 410 })
    }
    if (error instanceof HighlightNotFoundError) {
      return Response.json({ ok: false, code: "highlight_not_found", message: error.message }, { status: 404 })
    }
    if (error instanceof NoSourceMarkdownError) {
      return Response.json({ ok: false, code: "no_source_markdown", message: error.message }, { status: 400 })
    }
    if (error instanceof Error && (error.message === "Path traversal blocked" || error.message === "Not found")) {
      return new Response("Not found", { status: 404 })
    }
    if (error instanceof Error && error.message === "Only HTML files support reader annotations") {
      return new Response("Not found", { status: 404 })
    }
    console.error("POST /html-ask preflight error:", error)
    return Response.json({
      ok: false,
      code: "provider_unavailable",
      message: error instanceof Error ? error.message : String(error),
    }, { status: 503 })
  }

  const accept = req.headers.get("accept") ?? ""
  if (!accept.includes("text/event-stream")) {
    return new Response("Accept: text/event-stream required", { status: 406 })
  }

  return streamAskMessage({
    runName,
    htmlFile: file,
    scope: scope ?? "page",
    highlightId,
    contextQuote,
    contextPrefix,
    contextSuffix,
    threadId,
    message: message.trim(),
    prepare: prepareAskMessage,
  })
}

export { HTML_READING_COMPANION_ROLE }
