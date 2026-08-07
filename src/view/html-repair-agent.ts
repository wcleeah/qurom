import { createAgentRuntime } from "../agent-runtime/runtime"
import { loadRuntimeConfig, type RuntimeConfig } from "../config"
import { loadPromptBundle } from "../prompt-assets"
import { providerForRole } from "../providers/registry"
import type { AgentRunHandle } from "../providers/types"
import { HTML_REPAIR_ROLE } from "../role-registry"
import {
  buildRepairPrompt,
  isHtmlStale,
  NoRepairHtmlError,
  resolveRepairHtml,
  type ResolvedRepairHtml,
} from "./html-repair-context"
import {
  appendHtmlReaderRepairMessage,
  countHtmlReaderRepairMessages,
  createHtmlReaderRepairThread,
  deleteEmptyHtmlReaderRepairThread,
  getHtmlReaderRepairThread,
  resetHtmlReaderRepairThread,
  updateHtmlReaderRepairThread,
  type HtmlReaderRepairThread,
} from "./html-repair-store"

export { HTML_REPAIR_ROLE }

export class RepairThreadBusyError extends Error {
  constructor(threadId: string) {
    super(`Thread ${threadId} already has a message in flight`)
    this.name = "RepairThreadBusyError"
  }
}

export class RepairThreadStaleError extends Error {
  readonly canReset = true
  constructor(threadId: string) {
    super(`Thread ${threadId} provider handle is no longer available`)
    this.name = "RepairThreadStaleError"
  }
}

const handleCache = new Map<string, AgentRunHandle>()
const runningThreads = new Set<string>()

async function ensureRepairRuntime() {
  const config = await loadRuntimeConfig()
  const promptBundle = await loadPromptBundle(config)
  return { config, promptBundle }
}

function threadTitle(threadId: string) {
  return `html-repair:${threadId}`
}

function cacheHandle(threadId: string, handle: AgentRunHandle) {
  handle.keepAlive = true
  handleCache.set(threadId, handle)
}

function getCachedHandle(threadId: string): AgentRunHandle | null {
  return handleCache.get(threadId) ?? null
}

function assertThreadAvailable(thread: HtmlReaderRepairThread): void {
  if (runningThreads.has(thread.id)) {
    throw new RepairThreadBusyError(thread.id)
  }
  if (thread.status === "running") {
    throw new RepairThreadBusyError(thread.id)
  }
}

async function createRepairRuntime(config: RuntimeConfig) {
  return createAgentRuntime(config)
}

async function createProviderHandle(input: {
  config: RuntimeConfig
  threadId: string
}): Promise<AgentRunHandle> {
  const runtime = await createRepairRuntime(input.config)
  return runtime.createHandle(HTML_REPAIR_ROLE, threadTitle(input.threadId))
}

async function resumeProviderHandle(input: {
  config: RuntimeConfig
  threadId: string
  handleId: string
}): Promise<AgentRunHandle> {
  const runtime = await createRepairRuntime(input.config)
  return runtime.resumeHandle(
    HTML_REPAIR_ROLE,
    threadTitle(input.threadId),
    input.handleId,
  )
}

export async function resolveOrCreateRepairThread(input: {
  runName: string
  htmlFile: string
  contextQuote?: string | null
  contextPrefix?: string
  contextSuffix?: string
  threadId?: string | null
}): Promise<{ thread: HtmlReaderRepairThread; created: boolean; html: ResolvedRepairHtml }> {
  const { config } = await ensureRepairRuntime()
  const html = await resolveRepairHtml(input.runName, input.htmlFile)
  const provider = providerForRole(config, HTML_REPAIR_ROLE).id

  if (input.threadId) {
    const existing = await getHtmlReaderRepairThread(input.runName, input.htmlFile, input.threadId)
    if (!existing) {
      throw new Error("Thread not found")
    }
    if (isHtmlStale(existing.htmlMtimeMs, html)) {
      // External edits mark stale; our own repair writes refresh mtime after success.
      await updateHtmlReaderRepairThread({ threadId: existing.id, status: "stale" })
      existing.status = "stale"
    }
    return { thread: existing, created: false, html }
  }

  const thread = await createHtmlReaderRepairThread({
    runName: input.runName,
    htmlFile: input.htmlFile,
    htmlMtimeMs: html.mtimeMs,
    contextQuote: input.contextQuote,
    contextPrefix: input.contextPrefix,
    contextSuffix: input.contextSuffix,
    provider,
  })
  return { thread, created: true, html }
}

export async function ensureRepairThreadHandle(input: {
  thread: HtmlReaderRepairThread
  html: ResolvedRepairHtml
}): Promise<AgentRunHandle> {
  if (input.thread.status === "stale") {
    throw new RepairThreadStaleError(input.thread.id)
  }

  const cached = getCachedHandle(input.thread.id)
  if (cached) return cached

  const { config } = await ensureRepairRuntime()

  if (input.thread.handleId) {
    try {
      const resumed = await resumeProviderHandle({
        config,
        threadId: input.thread.id,
        handleId: input.thread.handleId,
      })
      cacheHandle(input.thread.id, resumed)
      await updateHtmlReaderRepairThread({
        threadId: input.thread.id,
        handleId: resumed.id,
        status: "idle",
        htmlMtimeMs: input.html.mtimeMs,
      })
      input.thread.handleId = resumed.id
      input.thread.status = "idle"
      return resumed
    } catch (error) {
      console.error("Failed to resume repair thread handle:", error)
      await updateHtmlReaderRepairThread({
        threadId: input.thread.id,
        status: "stale",
        handleId: null,
      })
      input.thread.status = "stale"
      input.thread.handleId = null
      throw new RepairThreadStaleError(input.thread.id)
    }
  }

  const handle = await createProviderHandle({
    config,
    threadId: input.thread.id,
  })
  cacheHandle(input.thread.id, handle)
  await updateHtmlReaderRepairThread({
    threadId: input.thread.id,
    handleId: handle.id,
    status: "idle",
    htmlMtimeMs: input.html.mtimeMs,
  })
  input.thread.handleId = handle.id
  input.thread.status = "idle"
  return handle
}

export async function resetRepairThread(input: {
  runName: string
  htmlFile: string
  threadId: string
}): Promise<void> {
  const thread = await getHtmlReaderRepairThread(input.runName, input.htmlFile, input.threadId)
  if (!thread) return

  runningThreads.delete(thread.id)

  const cached = handleCache.get(thread.id)
  if (cached) {
    const { config } = await ensureRepairRuntime()
    const runtime = createAgentRuntime(config)
    await runtime.abort(cached).catch(() => {})
    handleCache.delete(thread.id)
  }

  await resetHtmlReaderRepairThread(thread.id)
}

export async function prepareRepairMessage(input: {
  runName: string
  htmlFile: string
  contextQuote?: string | null
  contextPrefix?: string
  contextSuffix?: string
  threadId?: string | null
  message: string
}): Promise<{
  thread: HtmlReaderRepairThread
  created: boolean
  bootstrap: boolean
  html: ResolvedRepairHtml
  handle: AgentRunHandle
  prompt: string
  inputFiles?: Awaited<ReturnType<typeof buildRepairPrompt>>["inputFiles"]
  outputFile: string
  userMessageId: string
}> {
  const { promptBundle } = await ensureRepairRuntime()
  let thread: HtmlReaderRepairThread | undefined
  let created = false
  let reserved = false

  try {
    const resolved = await resolveOrCreateRepairThread(input)
    thread = resolved.thread
    created = resolved.created
    const { html } = resolved

    assertThreadAvailable(thread)

    const messageCount = await countHtmlReaderRepairMessages(thread.id)
    const bootstrap = messageCount === 0

    runningThreads.add(thread.id)
    reserved = true
    await updateHtmlReaderRepairThread({ threadId: thread.id, status: "running" })

    const handle = await ensureRepairThreadHandle({ thread, html })

    const built = await buildRepairPrompt({
      message: input.message,
      bootstrap,
      html,
      contextQuote: thread.contextQuote,
      contextPrefix: thread.contextPrefix,
      contextSuffix: thread.contextSuffix,
      promptAsset: promptBundle.assets.htmlRepairFix,
    })

    const userMessage = await appendHtmlReaderRepairMessage({
      threadId: thread.id,
      role: "user",
      content: input.message,
    })

    return {
      thread,
      created,
      bootstrap,
      html,
      handle,
      prompt: built.prompt,
      inputFiles: built.inputFiles,
      outputFile: built.outputFile,
      userMessageId: userMessage.id,
    }
  } catch (error) {
    if (thread) {
      if (reserved) {
        runningThreads.delete(thread.id)
        await updateHtmlReaderRepairThread({ threadId: thread.id, status: "idle" }).catch(() => {})
      }
      if (created) {
        await deleteEmptyHtmlReaderRepairThread(input.runName, input.htmlFile, thread.id).catch(() => {})
      }
    }
    throw error
  }
}

export function markRepairThreadIdle(threadId: string) {
  runningThreads.delete(threadId)
  void updateHtmlReaderRepairThread({ threadId, status: "idle" })
}

export async function refreshRepairThreadHtmlMtime(threadId: string, html: ResolvedRepairHtml) {
  await updateHtmlReaderRepairThread({
    threadId,
    htmlMtimeMs: html.mtimeMs,
    status: "idle",
  })
}

export function markRepairThreadStale(threadId: string) {
  runningThreads.delete(threadId)
  handleCache.delete(threadId)
  void updateHtmlReaderRepairThread({ threadId, status: "stale", handleId: null })
}

export function isRepairThreadRunning(threadId: string): boolean {
  return runningThreads.has(threadId)
}

async function recoverStaleRunningThread(thread: HtmlReaderRepairThread): Promise<void> {
  if (thread.status === "running" && !runningThreads.has(thread.id)) {
    await updateHtmlReaderRepairThread({ threadId: thread.id, status: "idle" })
    thread.status = "idle"
  }
}

export async function preflightRepairMessage(input: {
  runName: string
  htmlFile: string
  threadId?: string | null
}): Promise<{ thread: HtmlReaderRepairThread | null; html: ResolvedRepairHtml }> {
  const html = await resolveRepairHtml(input.runName, input.htmlFile)
  await ensureRepairRuntime()

  if (!input.threadId) {
    return { thread: null, html }
  }

  const thread = await getHtmlReaderRepairThread(input.runName, input.htmlFile, input.threadId)
  if (!thread) {
    throw new Error("Thread not found")
  }
  if (isHtmlStale(thread.htmlMtimeMs, html)) {
    await updateHtmlReaderRepairThread({ threadId: thread.id, status: "stale" })
    thread.status = "stale"
  }
  await recoverStaleRunningThread(thread)
  assertThreadAvailable(thread)
  if (thread.status === "stale") {
    throw new RepairThreadStaleError(thread.id)
  }

  return { thread, html }
}

export { NoRepairHtmlError }
