import type { RuntimeConfig } from "./config"
import { normalizeDocumentRequest, DocumentInputError } from "./document-input"
import { loadPromptBundle, type PromptBundle } from "./prompt-assets"
import { ZodError } from "zod"
import { getProviderLifecycle, type ProviderLifecycle, type ProviderLifecycleStatus } from "./providers/lifecycle"
import { configuredAgentRoles, validateProviderPrerequisites } from "./providers/registry"
import type { AgentRole } from "./providers/types"
import {
  createBridgeForRoles,
  createEventBus,
  runResearchPipeline,
  type BridgeFactory,
  type RuntimePrerequisites,
} from "./runner"
import { buildRunDirName, ensureRunDir, writeFailedArtifacts, writeRunJsonArtifact } from "./output"
import type { LiveStatus } from "./live-status"
import { resolveRunDirectory } from "./run-resume"
import type { InputRequest } from "./schema"

export type ActiveRun = {
  runId: string
  abortController: AbortController
  promise: Promise<unknown>
  releaseProviders: () => Promise<void>
}

export type RunManagerStatus = {
  active: { runId: string } | null
  providers: Record<string, ProviderLifecycleStatus>
}

export type RunManager = {
  status: () => RunManagerStatus
  startResearch: (request: InputRequest) => Promise<{ runId: string; runPath: string }>
  resumeResearch: (runId: string) => Promise<{ runId: string }>
  cancel: (runId?: string) => Promise<boolean>
  shutdown: () => Promise<void>
}

export type RunManagerDeps = {
  getConfig: () => Promise<RuntimeConfig> | RuntimeConfig
  lifecycle?: ProviderLifecycle
  loadPromptBundleFn?: typeof loadPromptBundle
  validatePrerequisitesFn?: typeof validateProviderPrerequisites
  runResearchPipelineFn?: typeof runResearchPipeline
}

function parseResumeRunId(raw: string): string {
  const hashIndex = raw.indexOf("#")
  if (hashIndex < 0) return raw.trim()
  // Ignore legacy #nodeName suffix — resume is latest-only.
  return raw.slice(0, hashIndex).trim()
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

async function writeBootstrapLiveStatus(runDir: string, maxRounds: number) {
  const status: LiveStatus = {
    phase: "running",
    node: "starting",
    runStartedAt: Date.now(),
    round: 0,
    maxRounds,
    agents: {},
    nodeHistory: [],
  }
  await writeRunJsonArtifact(runDir, "live-status.json", status)
}

async function writeStartupFailureStatus(runDir: string, error: unknown, maxRounds: number) {
  const message = error instanceof Error ? error.message : String(error)
  await writeFailedArtifacts(runDir, {
    draft: "",
    summary: { error: message, phase: "startup" },
  })
  const status: LiveStatus = {
    phase: "error",
    node: "starting",
    runStartedAt: Date.now(),
    round: 0,
    maxRounds,
    agents: {},
    nodeHistory: [],
    error: message,
  }
  await writeRunJsonArtifact(runDir, "live-status.json", status)
}

export function createRunManager(deps: RunManagerDeps): RunManager {
  const lifecycle = deps.lifecycle ?? getProviderLifecycle()
  const loadBundle = deps.loadPromptBundleFn ?? loadPromptBundle
  const validatePrereqs = deps.validatePrerequisitesFn ?? validateProviderPrerequisites
  const runPipelineFn = deps.runResearchPipelineFn ?? runResearchPipeline

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
    runId: string
    roles: AgentRole[]
    runDir?: string
    maxRounds: number
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

    const abortController = new AbortController()
    const signal = abortController.signal

    if (input.runDir) {
      await writeBootstrapLiveStatus(input.runDir, input.maxRounds)
    }

    let releaseProviders: (() => Promise<void>) | undefined

    let runPromise!: Promise<unknown>
    runPromise = (async () => {
      try {
        if (signal.aborted) return

        const cfg = await config()
        const bundle = await promptBundle(cfg)
        if (signal.aborted) return

        releaseProviders = await lifecycle.acquireForRoles(cfg, input.roles)
        if (signal.aborted) return

        let prereqs: RuntimePrerequisites
        try {
          prereqs = await validatePrereqs(cfg)
        } catch (error) {
          if (!signal.aborted && input.runDir) {
            await writeStartupFailureStatus(input.runDir, error, input.maxRounds)
          }
          return
        }

        const bus = createEventBus()
        const bridgeFactory = (
          pipelineConfig: RuntimeConfig,
          opts: Parameters<typeof createBridgeForRoles>[2],
        ) => createBridgeForRoles(pipelineConfig, input.roles, opts)

        await input
          .execute({
            bus,
            signal,
            bridgeFactory,
            prerequisites: prereqs,
            promptBundle: bundle,
            config: cfg,
          })
          .catch(() => {})
      } catch (error) {
        if (!signal.aborted && input.runDir) {
          await writeStartupFailureStatus(input.runDir, error, input.maxRounds)
        }
      } finally {
        if (active?.promise === runPromise) {
          active = undefined
        }
        if (releaseProviders) {
          await releaseProviders().catch(() => {})
          releaseProviders = undefined
        }
      }
    })()

    active = {
      runId: input.runId,
      abortController,
      promise: runPromise,
      releaseProviders: async () => {
        if (releaseProviders) {
          await releaseProviders()
          releaseProviders = undefined
        }
      },
    }

    return { runId: input.runId }
  }

  return {
    status() {
      return {
        active: active ? { runId: active.runId } : null,
        providers: {
          opencode: lifecycle.status("opencode"),
          cursor: lifecycle.status("cursor"),
        },
      }
    },

    async startResearch(request) {
      const runId = crypto.randomUUID()
      const cfg = await config()

      let pipelineRequest = request
      const runDirInput = {
        requestId: runId,
        inputMode: request.inputMode,
        topic: request.inputMode === "topic" ? request.topic : undefined,
        documentPath: request.inputMode === "document" ? request.documentPath : undefined,
        documentText: request.inputMode === "document" ? request.documentText : undefined,
      }
      const runPath = buildRunDirName(runDirInput)
      const runDir = await ensureRunDir(cfg.env.QUORUM_RUNS_DIR, runDirInput)

      if (request.inputMode === "document") {
        pipelineRequest = await normalizeDocumentRequest(request, runDir)
      }

      await writeRunJsonArtifact(runDir, "request.json", {
        requestId: runId,
        inputMode: pipelineRequest.inputMode,
        topic: pipelineRequest.inputMode === "topic" ? pipelineRequest.topic : undefined,
        documentPath: pipelineRequest.inputMode === "document" ? pipelineRequest.documentPath : undefined,
        documentSource: pipelineRequest.inputMode === "document" ? pipelineRequest.documentSource : undefined,
        originalDocumentPath:
          pipelineRequest.inputMode === "document" ? pipelineRequest.originalDocumentPath : undefined,
      })

      const roles = configuredAgentRoles(cfg)
      await runPipeline({
        runId,
        roles,
        runDir,
        maxRounds: cfg.quorumConfig.maxRounds,
        execute: ({ bus, signal, bridgeFactory, prerequisites: prereqs, promptBundle: bundle, config: pipelineCfg }) =>
          runPipelineFn({
            config: pipelineCfg,
            prerequisites: prereqs,
            promptBundle: bundle,
            request: pipelineRequest,
            requestId: runId,
            bus,
            signal,
            bridgeFactory,
          }),
      })
      return { runId, runPath }
    },

    async resumeResearch(rawRunId) {
      const runId = parseResumeRunId(rawRunId)
      const cfg = await config()
      const roles = configuredAgentRoles(cfg)
      let runDir: string | undefined
      try {
        runDir = await resolveRunDirectory(runId, cfg.env.QUORUM_RUNS_DIR)
      } catch {
        // Pipeline will surface the missing-run error after return.
      }
      return runPipeline({
        runId,
        roles,
        runDir,
        maxRounds: cfg.quorumConfig.maxRounds,
        execute: ({ bus, signal, bridgeFactory, prerequisites: prereqs, promptBundle: bundle, config: pipelineCfg }) =>
          runPipelineFn({
            config: pipelineCfg,
            prerequisites: prereqs,
            promptBundle: bundle,
            resume: { runId },
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

export function toRunManagerError(error: unknown): RunManagerError {
  if (error instanceof RunManagerError) return error
  if (error instanceof DocumentInputError) return new RunManagerError(error.message, 400)
  if (error instanceof ZodError) {
    const message = error.issues[0]?.message ?? "Invalid request"
    return new RunManagerError(message, 400)
  }
  const message = error instanceof Error ? error.message : String(error)
  return new RunManagerError(message, 500)
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

/** True when the run manager is executing this run (by slug or request id). */
export function isRunManagedActive(runRef: string): boolean {
  const active = defaultManager?.status().active
  if (!active) return false
  return runRefsMatch(active.runId, runRef)
}

export function resetRunManagerForTests() {
  defaultManager = undefined
}
