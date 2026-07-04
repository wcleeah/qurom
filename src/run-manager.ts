import type { RuntimeConfig } from "./config"
import { loadPromptBundle, type PromptBundle } from "./prompt-assets"
import { getProviderLifecycle, type ProviderLifecycle, type ProviderLifecycleStatus } from "./providers/lifecycle"
import { configuredAgentRoles, validateProviderPrerequisites } from "./providers/registry"
import { DESIGN_QUORUM_ROLES } from "./role-registry"
import {
  createBridgeForRoles,
  createEventBus,
  runDesignPipeline,
  runResearchPipeline,
  type BridgeFactory,
  type RuntimePrerequisites,
} from "./runner"
import { buildRunDirName, ensureRunDir, writeRunJsonArtifact } from "./output"
import type { InputRequest } from "./schema"

export type RunKind = "research" | "design"

export type ActiveRun = {
  runId: string
  kind: RunKind
  abortController: AbortController
  promise: Promise<unknown>
  releaseProviders: () => Promise<void>
}

export type RunManagerStatus = {
  active: { runId: string; kind: RunKind } | null
  providers: Record<string, ProviderLifecycleStatus>
}

export type RunManager = {
  status: () => RunManagerStatus
  startResearch: (request: InputRequest) => Promise<{ runId: string; runPath: string }>
  resumeResearch: (runId: string, node?: string) => Promise<{ runId: string }>
  startDesign: (runId: string) => Promise<{ runId: string }>
  cancel: (runId?: string) => Promise<boolean>
  shutdown: () => Promise<void>
}

export type RunManagerDeps = {
  getConfig: () => Promise<RuntimeConfig> | RuntimeConfig
  lifecycle?: ProviderLifecycle
  loadPromptBundleFn?: typeof loadPromptBundle
}

function designPipelineRoles(): string[] {
  return [...DESIGN_QUORUM_ROLES, "json-fixer"]
}

function parseResumeRunId(raw: string): { runId: string; node?: string } {
  const hashIndex = raw.indexOf("#")
  if (hashIndex < 0) return { runId: raw.trim() }
  return {
    runId: raw.slice(0, hashIndex).trim(),
    node: raw.slice(hashIndex + 1).trim() || undefined,
  }
}

const UUID_SUFFIX =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function requestIdFromRunRef(runRef: string): string | undefined {
  const trimmed = runRef.trim()
  const suffix = trimmed.match(UUID_SUFFIX)?.[0]
  if (!suffix) return undefined
  if (suffix === trimmed) return suffix
  return suffix
}

function runRefsMatch(activeRunId: string, requestedRunRef: string): boolean {
  const active = activeRunId.trim()
  const requested = requestedRunRef.trim()
  if (!requested) return true
  if (active === requested || requested.includes(active) || active.includes(requested)) return true
  const requestedId = requestIdFromRunRef(requested)
  const activeId = requestIdFromRunRef(active)
  return Boolean(requestedId && activeId && requestedId === activeId)
}

/** @internal Exported for unit tests. */
export const __runRefMatching = {
  requestIdFromRunRef,
  runRefsMatch,
}

export function createRunManager(deps: RunManagerDeps): RunManager {
  const lifecycle = deps.lifecycle ?? getProviderLifecycle()
  const loadBundle = deps.loadPromptBundleFn ?? loadPromptBundle

  let active: ActiveRun | undefined

  async function config(): Promise<RuntimeConfig> {
    return await Promise.resolve(deps.getConfig())
  }

  async function promptBundle(cfg: RuntimeConfig): Promise<PromptBundle> {
    return await loadBundle(cfg)
  }

  function assertNotActive() {
    if (active) {
      throw new RunManagerError("A run is already active", 409)
    }
  }

  async function runPipeline(input: {
    kind: RunKind
    runId: string
    roles: string[]
    execute: (args: {
      bus: ReturnType<typeof createEventBus>
      signal: AbortSignal
      bridgeFactory: BridgeFactory
      prerequisites: RuntimePrerequisites
      promptBundle: PromptBundle
      config: RuntimeConfig
    }) => Promise<unknown>
  }): Promise<{ runId: string }> {
    assertNotActive()

    const cfg = await config()
    const bundle = await promptBundle(cfg)
    const releaseProviders = await lifecycle.acquireForRoles(cfg, input.roles)

    let prereqs: RuntimePrerequisites
    try {
      prereqs = await validateProviderPrerequisites(cfg)
    } catch (error) {
      await releaseProviders()
      throw error
    }

    const bus = createEventBus()
    const abortController = new AbortController()

    const bridgeFactory = (
      config: RuntimeConfig,
      opts: Parameters<typeof createBridgeForRoles>[2],
    ) => createBridgeForRoles(config, input.roles, opts)

    let runPromise!: Promise<unknown>
    runPromise = input
      .execute({
        bus,
        signal: abortController.signal,
        bridgeFactory,
        prerequisites: prereqs,
        promptBundle: bundle,
        config: cfg,
      })
      .catch(() => {})
      .finally(async () => {
        if (active?.promise === runPromise) {
          active = undefined
        }
        await releaseProviders()
      })

    active = {
      runId: input.runId,
      kind: input.kind,
      abortController,
      promise: runPromise,
      releaseProviders,
    }

    return { runId: input.runId }
  }

  return {
    status() {
      return {
        active: active ? { runId: active.runId, kind: active.kind } : null,
        providers: {
          opencode: lifecycle.status("opencode"),
          cursor: lifecycle.status("cursor"),
        },
      }
    },

    async startResearch(request) {
      const runId = crypto.randomUUID()
      const cfg = await config()
      const runDirInput = {
        requestId: runId,
        inputMode: request.inputMode,
        topic: request.inputMode === "topic" ? request.topic : undefined,
        documentPath: request.inputMode === "document" ? request.documentPath : undefined,
        documentText: request.inputMode === "document" ? request.documentText : undefined,
      }
      const runPath = buildRunDirName(runDirInput)
      const runDir = await ensureRunDir(cfg.env.QUORUM_RUNS_DIR, runDirInput)
      await writeRunJsonArtifact(runDir, "request.json", {
        requestId: runId,
        inputMode: request.inputMode,
        topic: request.inputMode === "topic" ? request.topic : undefined,
        documentPath: request.inputMode === "document" ? request.documentPath : undefined,
      })

      const roles = configuredAgentRoles(cfg)
      await runPipeline({
        kind: "research",
        runId,
        roles,
        execute: ({ bus, signal, bridgeFactory, prerequisites: prereqs, promptBundle: bundle, config: pipelineCfg }) =>
          runResearchPipeline({
            config: pipelineCfg,
            prerequisites: prereqs,
            promptBundle: bundle,
            request,
            requestId: runId,
            bus,
            signal,
            bridgeFactory,
          }),
      })
      return { runId, runPath }
    },

    async resumeResearch(rawRunId, node) {
      const parsed = parseResumeRunId(rawRunId)
      const roles = configuredAgentRoles(await config())
      return runPipeline({
        kind: "research",
        runId: parsed.runId,
        roles,
        execute: ({ bus, signal, bridgeFactory, prerequisites: prereqs, promptBundle: bundle, config: cfg }) =>
          runResearchPipeline({
            config: cfg,
            prerequisites: prereqs,
            promptBundle: bundle,
            resume: { runId: parsed.runId, node: node ?? parsed.node },
            bus,
            signal,
            bridgeFactory,
          }),
      })
    },

    async startDesign(runId) {
      const trimmed = runId.trim()
      const roles = designPipelineRoles()
      return runPipeline({
        kind: "design",
        runId: trimmed,
        roles,
        execute: ({ bus, signal, bridgeFactory, promptBundle: bundle, config: cfg }) =>
          runDesignPipeline({
            config: cfg,
            promptBundle: bundle,
            runId: trimmed,
            bus,
            signal,
            bridgeFactory,
          }),
      })
    },

    async cancel(runId) {
      if (!active) return false
      if (runId && !runRefsMatch(active.runId, runId)) {
        return false
      }
      active.abortController.abort()
      await active.promise.catch(() => {})
      return true
    },

    async shutdown() {
      if (active) {
        active.abortController.abort()
        await active.promise.catch(() => {})
      }
      await lifecycle.shutdown()
    },
  }
}

export class RunManagerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "RunManagerError"
  }
}

let defaultManager: RunManager | undefined

export function getRunManager(): RunManager {
  if (!defaultManager) {
    throw new Error("Run manager not initialized — call initRunManager first")
  }
  return defaultManager
}

export function initRunManager(deps: RunManagerDeps): RunManager {
  defaultManager = createRunManager(deps)
  return defaultManager
}

export function tryGetRunManager(): RunManager | undefined {
  return defaultManager
}

export function resetRunManagerForTests() {
  defaultManager = undefined
}
