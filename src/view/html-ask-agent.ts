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
import { getHtmlReaderHighlight } from "./html-highlights-store"
import {
  appendHtmlReaderAskMessage,
  countHtmlReaderAskMessages,
  createHtmlReaderAskThread,
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

const handleCache = new Map<string, AgentRunHandle>()
const runningThreads = new Set<string>()
let preparedCleanup: (() => Promise<void>) | undefined
let runtimeConfig: RuntimeConfig | undefined
let runtimePromptBundle: Awaited<ReturnType<typeof loadPromptBundle>> | undefined

async function ensureAskRuntime() {
  if (!runtimeConfig) {
    runtimeConfig = await loadRuntimeConfig()
    runtimePromptBundle = await loadPromptBundle(runtimeConfig)
    const provider = providerForRole(runtimeConfig, HTML_READING_COMPANION_ROLE)
    const prepared = await provider.prepare?.({ config: runtimeConfig })
    const previousCleanup = preparedCleanup
    preparedCleanup = async () => {
      await prepared?.cleanup?.()
      await previousCleanup?.()
    }
  }
  return { config: runtimeConfig, promptBundle: runtimePromptBundle! }
}

function threadTitle(threadId: string) {
  return `html-ask:${threadId}`
}

function cacheHandle(threadId: string, handle: AgentRunHandle) {
  handle.keepAlive = true
  handleCache.set(threadId, handle)
}

function getCachedHandle(threadId: string, thread: HtmlReaderAskThread): AgentRunHandle | null {
  const cached = handleCache.get(threadId)
  if (cached) return cached
  if (thread.handleId && thread.status !== "stale") {
    return null
  }
  return null
}

async function createProviderHandle(input: {
  config: RuntimeConfig
  threadId: string
}): Promise<AgentRunHandle> {
  const runtime = createAgentRuntime(input.config, undefined, {
    roleInstructions: (await loadPromptBundle(input.config)).roleInstructions,
  })
  return runtime.createHandle(
    HTML_READING_COMPANION_ROLE,
    threadTitle(input.threadId),
  )
}

export async function resolveOrCreateAskThread(input: {
  runName: string
  htmlFile: string
  scope: AskScope
  highlightId?: string | null
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

  const cached = getCachedHandle(input.thread.id, input.thread)
  if (cached) return cached

  if (input.thread.handleId) {
    await updateHtmlReaderAskThread({ threadId: input.thread.id, status: "stale" })
    throw new AskThreadStaleError(input.thread.id)
  }

  const { config } = await ensureAskRuntime()
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

  const { config, promptBundle } = await ensureAskRuntime()
  const { thread, created, source } = await resolveOrCreateAskThread(input)
  if (runningThreads.has(thread.id)) {
    throw new AskThreadBusyError(thread.id)
  }

  const messageCount = await countHtmlReaderAskMessages(thread.id)
  const bootstrap = messageCount === 0
  const handle = await ensureAskThreadHandle({
    thread,
    source,
    runName: input.runName,
    htmlFile: input.htmlFile,
  })

  let highlight = null
  if (thread.scope === "highlight") {
    highlight = await getHtmlReaderHighlight(input.runName, input.htmlFile, thread.highlightId!)
    if (!highlight) {
      throw new Error("Highlight not found")
    }
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

  runningThreads.add(thread.id)
  await updateHtmlReaderAskThread({ threadId: thread.id, status: "running" })

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

export async function preflightAskMessage(input: {
  runName: string
  htmlFile: string
  scope?: AskScope
  highlightId?: string | null
  threadId?: string | null
}): Promise<{ thread: HtmlReaderAskThread | null; source: ResolvedSourceMarkdown }> {
  const source = await resolveSourceMarkdown(input.runName)
  await ensureAskRuntime()

  if (!input.threadId) {
    if (!input.scope) {
      throw new Error("scope is required when starting a new chat")
    }
    if (input.scope === "highlight" && !input.highlightId) {
      throw new Error("highlightId is required for highlight bootstrap")
    }
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
  if (runningThreads.has(thread.id)) {
    throw new AskThreadBusyError(thread.id)
  }
  if (thread.status === "stale") {
    throw new AskThreadStaleError(thread.id)
  }
  if (thread.handleId && !handleCache.has(thread.id)) {
    await updateHtmlReaderAskThread({ threadId: thread.id, status: "stale", handleId: null })
    thread.status = "stale"
    throw new AskThreadStaleError(thread.id)
  }
  return { thread, source }
}

export { NoSourceMarkdownError }
