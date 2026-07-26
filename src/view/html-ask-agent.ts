import { createAgentRuntime } from "../agent-runtime/runtime"
import { loadRuntimeConfig, type RuntimeConfig } from "../config"
import { loadPromptBundle } from "../prompt-assets"
import { providerForRole } from "../providers/registry"
import type { AgentRunHandle } from "../providers/types"
import {
  buildAskPrompt,
  isMdStale,
  NoSourceMarkdownError,
  resolveSourceMarkdown,
  type ResolvedSourceMarkdown,
} from "./html-ask-context"
import { getHtmlReaderHighlight, type HtmlReaderHighlight } from "./html-highlights-store"
import {
  appendHtmlReaderAskMessage,
  countHtmlReaderAskMessages,
  createHtmlReaderAskThread,
  deleteEmptyHtmlReaderAskThread,
  getHtmlReaderAskThread,
  resetHtmlReaderAskThread,
  updateHtmlReaderAskThread,
  type AskScope,
  type HtmlReaderAskThread,
} from "./html-ask-store"

export const HTML_READING_COMPANION_ROLE = "html-reading-companion"

export class AskThreadBusyError extends Error {
  constructor(threadId: string) {
    super(`Thread ${threadId} already has a message in flight`)
    this.name = "AskThreadBusyError"
  }
}

export class AskThreadStaleError extends Error {
  readonly canReset = true
  constructor(threadId: string) {
    super(`Thread ${threadId} provider handle is no longer available`)
    this.name = "AskThreadStaleError"
  }
}

export class HighlightNotFoundError extends Error {
  readonly highlightId: string
  constructor(highlightId: string) {
    super("Highlight not found")
    this.name = "HighlightNotFoundError"
    this.highlightId = highlightId
  }
}

const handleCache = new Map<string, AgentRunHandle>()
const runningThreads = new Set<string>()

async function ensureAskRuntime() {
  const config = await loadRuntimeConfig()
  const promptBundle = await loadPromptBundle(config)
  return { config, promptBundle }
}

function threadTitle(threadId: string) {
  return `html-ask:${threadId}`
}

function cacheHandle(threadId: string, handle: AgentRunHandle) {
  handle.keepAlive = true
  handleCache.set(threadId, handle)
}

function getCachedHandle(threadId: string): AgentRunHandle | null {
  return handleCache.get(threadId) ?? null
}

function assertThreadAvailable(thread: HtmlReaderAskThread): void {
  if (runningThreads.has(thread.id)) {
    throw new AskThreadBusyError(thread.id)
  }
  if (thread.status === "running") {
    throw new AskThreadBusyError(thread.id)
  }
}

async function createAskRuntime(config: RuntimeConfig) {
  return createAgentRuntime(config, undefined, {
    roleInstructions: (await loadPromptBundle(config)).roleInstructions,
  })
}

async function createProviderHandle(input: {
  config: RuntimeConfig
  threadId: string
}): Promise<AgentRunHandle> {
  const runtime = await createAskRuntime(input.config)
  return runtime.createHandle(
    HTML_READING_COMPANION_ROLE,
    threadTitle(input.threadId),
  )
}

async function resumeProviderHandle(input: {
  config: RuntimeConfig
  threadId: string
  handleId: string
}): Promise<AgentRunHandle> {
  const runtime = await createAskRuntime(input.config)
  return runtime.resumeHandle(
    HTML_READING_COMPANION_ROLE,
    threadTitle(input.threadId),
    input.handleId,
  )
}

async function loadHighlightForBootstrap(
  runName: string,
  htmlFile: string,
  highlightId: string,
): Promise<HtmlReaderHighlight> {
  const highlight = await getHtmlReaderHighlight(runName, htmlFile, highlightId)
  if (!highlight) {
    throw new HighlightNotFoundError(highlightId)
  }
  return highlight
}

export async function resolveOrCreateAskThread(input: {
  runName: string
  htmlFile: string
  scope: AskScope
  highlightId?: string | null
  contextQuote?: string | null
  contextPrefix?: string
  contextSuffix?: string
  threadId?: string | null
}): Promise<{ thread: HtmlReaderAskThread; created: boolean; source: ResolvedSourceMarkdown }> {
  const { config } = await ensureAskRuntime()
  const source = await resolveSourceMarkdown(input.runName)
  const provider = providerForRole(config, HTML_READING_COMPANION_ROLE).id

  if (input.threadId) {
    const existing = await getHtmlReaderAskThread(input.runName, input.htmlFile, input.threadId)
    if (!existing) {
      throw new Error("Thread not found")
    }
    if (isMdStale(existing.mdMtimeMs, source)) {
      await updateHtmlReaderAskThread({ threadId: existing.id, status: "stale" })
      existing.status = "stale"
    }
    return { thread: existing, created: false, source }
  }

  const thread = await createHtmlReaderAskThread({
    runName: input.runName,
    htmlFile: input.htmlFile,
    mdFile: source.mdFile,
    mdMtimeMs: source.mtimeMs,
    scope: input.scope,
    highlightId: input.highlightId,
    contextQuote: input.contextQuote,
    contextPrefix: input.contextPrefix,
    contextSuffix: input.contextSuffix,
    provider,
  })
  return { thread, created: true, source }
}

export async function ensureAskThreadHandle(input: {
  thread: HtmlReaderAskThread
  source: ResolvedSourceMarkdown
  runName: string
  htmlFile: string
}): Promise<AgentRunHandle> {
  if (input.thread.status === "stale") {
    throw new AskThreadStaleError(input.thread.id)
  }

  const cached = getCachedHandle(input.thread.id)
  if (cached) return cached

  const { config } = await ensureAskRuntime()

  if (input.thread.handleId) {
    try {
      const resumed = await resumeProviderHandle({
        config,
        threadId: input.thread.id,
        handleId: input.thread.handleId,
      })
      cacheHandle(input.thread.id, resumed)
      await updateHtmlReaderAskThread({
        threadId: input.thread.id,
        handleId: resumed.id,
        status: "idle",
        mdMtimeMs: input.source.mtimeMs,
      })
      input.thread.handleId = resumed.id
      input.thread.status = "idle"
      return resumed
    } catch (error) {
      console.error("Failed to resume ask thread handle:", error)
      await updateHtmlReaderAskThread({
        threadId: input.thread.id,
        status: "stale",
        handleId: null,
      })
      input.thread.status = "stale"
      input.thread.handleId = null
      throw new AskThreadStaleError(input.thread.id)
    }
  }

  const handle = await createProviderHandle({
    config,
    threadId: input.thread.id,
  })
  cacheHandle(input.thread.id, handle)
  await updateHtmlReaderAskThread({
    threadId: input.thread.id,
    handleId: handle.id,
    status: "idle",
    mdMtimeMs: input.source.mtimeMs,
  })
  input.thread.handleId = handle.id
  input.thread.status = "idle"
  return handle
}

export async function resetAskThread(input: {
  runName: string
  htmlFile: string
  threadId: string
}): Promise<void> {
  const thread = await getHtmlReaderAskThread(input.runName, input.htmlFile, input.threadId)
  if (!thread) return

  runningThreads.delete(thread.id)

  const cached = handleCache.get(thread.id)
  if (cached) {
    const { config } = await ensureAskRuntime()
    const runtime = createAgentRuntime(config)
    await runtime.abort(cached).catch(() => {})
    handleCache.delete(thread.id)
  }

  await resetHtmlReaderAskThread(thread.id)
}

export async function prepareAskMessage(input: {
  runName: string
  htmlFile: string
  scope: AskScope
  highlightId?: string | null
  contextQuote?: string | null
  contextPrefix?: string
  contextSuffix?: string
  threadId?: string | null
  message: string
}): Promise<{
  thread: HtmlReaderAskThread
  created: boolean
  bootstrap: boolean
  source: ResolvedSourceMarkdown
  handle: AgentRunHandle
  prompt: string
  inputFiles?: Awaited<ReturnType<typeof buildAskPrompt>>["inputFiles"]
  userMessageId: string
}> {
  if (input.scope === "highlight" && !input.highlightId && !input.threadId) {
    throw new Error("highlightId is required for highlight bootstrap")
  }
  if (input.scope === "selection" && !input.contextQuote?.trim() && !input.threadId) {
    throw new Error("contextQuote is required for selection bootstrap")
  }

  if (!input.threadId && input.scope === "highlight" && input.highlightId) {
    await loadHighlightForBootstrap(input.runName, input.htmlFile, input.highlightId)
  }

  const { config, promptBundle } = await ensureAskRuntime()
  let thread: HtmlReaderAskThread | undefined
  let created = false
  let reserved = false

  try {
    const resolved = await resolveOrCreateAskThread(input)
    thread = resolved.thread
    created = resolved.created
    const { source } = resolved

    assertThreadAvailable(thread)

    const messageCount = await countHtmlReaderAskMessages(thread.id)
    const bootstrap = messageCount === 0

    if (bootstrap && thread.scope === "highlight" && thread.highlightId) {
      await loadHighlightForBootstrap(input.runName, input.htmlFile, thread.highlightId)
    }

    runningThreads.add(thread.id)
    reserved = true
    await updateHtmlReaderAskThread({ threadId: thread.id, status: "running" })

    const handle = await ensureAskThreadHandle({
      thread,
      source,
      runName: input.runName,
      htmlFile: input.htmlFile,
    })

    let highlight: HtmlReaderHighlight | null = null
    if (bootstrap && thread.scope === "highlight" && thread.highlightId) {
      highlight = await loadHighlightForBootstrap(input.runName, input.htmlFile, thread.highlightId)
    } else if (bootstrap && thread.scope === "selection" && thread.contextQuote) {
      highlight = {
        quote: thread.contextQuote,
        prefix: thread.contextPrefix,
        suffix: thread.contextSuffix,
      } as HtmlReaderHighlight
    }

    const built = await buildAskPrompt({
      scope: thread.scope,
      message: input.message,
      highlight,
      bootstrap,
      source,
      config,
      promptAssets: {
        htmlAskPage: promptBundle.assets.htmlAskPage,
        htmlAskHighlight: promptBundle.assets.htmlAskHighlight,
      },
    })

    const userMessage = await appendHtmlReaderAskMessage({
      threadId: thread.id,
      role: "user",
      content: input.message,
    })

    return {
      thread,
      created,
      bootstrap,
      source,
      handle,
      prompt: built.prompt,
      inputFiles: built.inputFiles,
      userMessageId: userMessage.id,
    }
  } catch (error) {
    if (thread) {
      if (reserved) {
        runningThreads.delete(thread.id)
        await updateHtmlReaderAskThread({ threadId: thread.id, status: "idle" }).catch(() => {})
      }
      if (created) {
        await deleteEmptyHtmlReaderAskThread(input.runName, input.htmlFile, thread.id).catch(() => {})
      }
    }
    throw error
  }
}

export function markAskThreadIdle(threadId: string) {
  runningThreads.delete(threadId)
  void updateHtmlReaderAskThread({ threadId, status: "idle" })
}

export function markAskThreadStale(threadId: string) {
  runningThreads.delete(threadId)
  handleCache.delete(threadId)
  void updateHtmlReaderAskThread({ threadId, status: "stale", handleId: null })
}

export function isAskThreadRunning(threadId: string): boolean {
  return runningThreads.has(threadId)
}

async function recoverStaleRunningThread(thread: HtmlReaderAskThread): Promise<void> {
  if (thread.status === "running" && !runningThreads.has(thread.id)) {
    await updateHtmlReaderAskThread({ threadId: thread.id, status: "idle" })
    thread.status = "idle"
  }
}

export async function preflightAskMessage(input: {
  runName: string
  htmlFile: string
  scope?: AskScope
  highlightId?: string | null
  contextQuote?: string | null
  threadId?: string | null
}): Promise<{ thread: HtmlReaderAskThread | null; source: ResolvedSourceMarkdown }> {
  if (!input.threadId) {
    if (!input.scope) {
      throw new Error("scope is required when starting a new chat")
    }
    if (input.scope === "highlight" && !input.highlightId) {
      throw new Error("highlightId is required for highlight bootstrap")
    }
    if (input.scope === "highlight" && input.highlightId) {
      await loadHighlightForBootstrap(input.runName, input.htmlFile, input.highlightId)
    }
    if (input.scope === "selection" && !input.contextQuote?.trim()) {
      throw new Error("contextQuote is required for selection bootstrap")
    }
  }

  const source = await resolveSourceMarkdown(input.runName)
  await ensureAskRuntime()

  if (!input.threadId) {
    return { thread: null, source }
  }

  const thread = await getHtmlReaderAskThread(input.runName, input.htmlFile, input.threadId)
  if (!thread) {
    throw new Error("Thread not found")
  }
  if (isMdStale(thread.mdMtimeMs, source)) {
    await updateHtmlReaderAskThread({ threadId: thread.id, status: "stale" })
    thread.status = "stale"
  }
  await recoverStaleRunningThread(thread)
  assertThreadAvailable(thread)
  if (thread.status === "stale") {
    throw new AskThreadStaleError(thread.id)
  }
  // Missing in-memory handles are recovered later via provider resume in
  // ensureAskThreadHandle (Cursor Agent.resume). Do not expire them here.

  const messageCount = await countHtmlReaderAskMessages(thread.id)
  if (messageCount === 0 && thread.scope === "highlight" && thread.highlightId) {
    await loadHighlightForBootstrap(input.runName, input.htmlFile, thread.highlightId)
  }

  return { thread, source }
}

export { NoSourceMarkdownError }
