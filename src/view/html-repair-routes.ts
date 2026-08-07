import { stat } from "node:fs/promises"

import {
  HTML_REPAIR_ROLE,
  NoRepairHtmlError,
  preflightRepairMessage,
  prepareRepairMessage,
  RepairThreadBusyError,
  RepairThreadStaleError,
  resetRepairThread,
} from "./html-repair-agent"
import { streamRepairMessage } from "./html-repair-sse"
import {
  deleteHtmlReaderRepairThread,
  listHtmlReaderRepairMessages,
  listHtmlReaderRepairThreads,
  purgeEmptyHtmlReaderRepairThreads,
} from "./html-repair-store"
import { validateHtmlReaderTarget } from "./html-reader-db"
import { safeFilePath, safeRunPath } from "./paths"

async function validateHtmlFile(runName: string, file: string): Promise<void> {
  validateHtmlReaderTarget(runName, file)
  const resolved = safeFilePath(runName, file)
  const fileStat = await stat(resolved)
  if (!fileStat.isFile()) {
    throw new Error("Not found")
  }
}

export async function handleListRepairThreads(runName: string, file: string): Promise<Response> {
  await validateHtmlFile(runName, file)
  await purgeEmptyHtmlReaderRepairThreads(runName, file)
  const threads = await listHtmlReaderRepairThreads(runName, file)
  return Response.json({ ok: true, threads })
}

export async function handleListRepairMessages(
  runName: string,
  file: string,
  threadId: string,
): Promise<Response> {
  await validateHtmlFile(runName, file)
  const messages = await listHtmlReaderRepairMessages(threadId)
  return Response.json({ ok: true, messages })
}

export async function handleDeleteRepairThread(
  runName: string,
  file: string,
  threadId: string,
): Promise<Response> {
  await validateHtmlFile(runName, file)
  await resetRepairThread({ runName, htmlFile: file, threadId })
  const deleted = await deleteHtmlReaderRepairThread(runName, file, threadId)
  if (!deleted) {
    return new Response("Not found", { status: 404 })
  }
  return Response.json({ ok: true })
}

export async function handlePostRepairMessage(req: Request, runName: string): Promise<Response> {
  const raw = await req.text()
  let file = ""
  let contextQuote: string | null = null
  let contextPrefix = ""
  let contextSuffix = ""
  let threadId: string | null = null
  let message = ""

  if (raw.trim().startsWith("{")) {
    const parsed = JSON.parse(raw) as {
      file?: unknown
      contextQuote?: unknown
      contextPrefix?: unknown
      contextSuffix?: unknown
      threadId?: unknown
      message?: unknown
    }
    file = typeof parsed.file === "string" ? parsed.file : ""
    contextQuote = typeof parsed.contextQuote === "string" ? parsed.contextQuote : null
    contextPrefix = typeof parsed.contextPrefix === "string" ? parsed.contextPrefix : ""
    contextSuffix = typeof parsed.contextSuffix === "string" ? parsed.contextSuffix : ""
    threadId = typeof parsed.threadId === "string" ? parsed.threadId : null
    message = typeof parsed.message === "string" ? parsed.message : ""
  } else {
    const params = new URLSearchParams(raw)
    file = params.get("file") ?? ""
    contextQuote = params.get("contextQuote")
    contextPrefix = params.get("contextPrefix") ?? ""
    contextSuffix = params.get("contextSuffix") ?? ""
    threadId = params.get("threadId")
    message = params.get("message") ?? ""
  }

  if (!file || !message.trim()) {
    return new Response("Missing file or message", { status: 400 })
  }

  try {
    safeRunPath(runName)
    await validateHtmlFile(runName, file)
    await preflightRepairMessage({
      runName,
      htmlFile: file,
      threadId,
    })
  } catch (error) {
    if (error instanceof RepairThreadBusyError) {
      return Response.json({ ok: false, code: "thread_busy", message: error.message }, { status: 409 })
    }
    if (error instanceof RepairThreadStaleError) {
      return Response.json({ ok: false, code: "thread_stale", canReset: true, message: error.message }, { status: 410 })
    }
    if (error instanceof NoRepairHtmlError) {
      return Response.json({ ok: false, code: "no_html", message: error.message }, { status: 400 })
    }
    if (error instanceof Error && (error.message === "Path traversal blocked" || error.message === "Not found")) {
      return new Response("Not found", { status: 404 })
    }
    if (error instanceof Error && error.message === "Only HTML files support reader annotations") {
      return new Response("Not found", { status: 404 })
    }
    console.error("POST /html-repair preflight error:", error)
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

  return streamRepairMessage({
    runName,
    htmlFile: file,
    contextQuote,
    contextPrefix,
    contextSuffix,
    threadId,
    message: message.trim(),
    prepare: prepareRepairMessage,
  })
}

export { HTML_REPAIR_ROLE }
