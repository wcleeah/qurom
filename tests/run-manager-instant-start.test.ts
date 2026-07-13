import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"

import type { PromptBundle } from "../src/prompt-assets"
import type { ProviderLifecycle, ProviderLifecycleStatus } from "../src/providers/lifecycle"
import type { AgentProviderId } from "../src/providers/types"
import {
  createRunManager,
  resetRunManagerForTests,
} from "../src/run-manager"
import { testRuntimeConfig, unitTestDataDir } from "./test-env"

const emptyPromptBundle: PromptBundle = {
  source: "sqlite",
  roleInstructions: {},
  assets: {
    deepDiveContract: "",
    draftFullDraft: "",
    reviseDraft: "",
    audit: "",
    reviewFindings: "",
    rebuttal: "",
    reviewRebuttalResponses: "",
    designHtml: "",
    readerInterview: "",
    readerInterviewFollowUp: "",
    readerInterviewDuplicateCorrection: "",
    enhanceDesign: "",
    htmlAskPage: "",
    htmlAskHighlight: "",
  },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error("timed out waiting for condition")
}

function createTestLifecycle(opts?: {
  acquire?: () => Promise<() => Promise<void>>
}): ProviderLifecycle {
  const statuses = new Map<AgentProviderId, ProviderLifecycleStatus>()
  return {
    async acquire(config, providerId) {
      void config
      statuses.set(providerId, "starting")
      const release = opts?.acquire
        ? await opts.acquire()
        : async () => {}
      statuses.set(providerId, "running")
      return release
    },
    async acquireForRoles(config, roles) {
      const unique = new Set<AgentProviderId>()
      for (const _role of roles) {
        unique.add("opencode")
      }
      if (unique.size === 0) unique.add("opencode")
      const releases: Array<() => Promise<void>> = []
      for (const providerId of unique) {
        releases.push(await this.acquire(config, providerId))
      }
      return async () => {
        for (const release of releases.reverse()) {
          await release()
        }
      }
    },
    status(providerId) {
      return statuses.get(providerId) ?? "idle"
    },
    async shutdown() {},
  }
}

describe("run manager instant start", () => {
  let dataDir = ""

  afterEach(async () => {
    resetRunManagerForTests()
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
      dataDir = ""
    }
  })

  test("startResearch resolves before slow provider acquire completes", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "qurom-instant-start-"))
    const config = testRuntimeConfig({ dataDir: unitTestDataDir(`instant-start-${Date.now()}`) })
    config.env.QUORUM_RUNS_DIR = join(dataDir, "runs")
    await mkdir(config.env.QUORUM_RUNS_DIR, { recursive: true })

    const gate = deferred<() => Promise<void>>()
    let acquireStarted = false
    const lifecycle = createTestLifecycle({
      acquire: async () => {
        acquireStarted = true
        return gate.promise
      },
    })

    let pipelineStarted = false
    const manager = createRunManager({
      getConfig: () => config,
      lifecycle,
      loadPromptBundleFn: async () => emptyPromptBundle,
      validatePrerequisitesFn: async () => ({ providers: [] }),
      runResearchPipelineFn: async () => {
        pipelineStarted = true
        return { outcome: "completed" as const }
      },
    })

    const started = await manager.startResearch({ inputMode: "topic", topic: "instant start" })
    expect(started.runId).toBeTruthy()
    expect(started.runPath).toContain(started.runId)
    expect(manager.status().active?.runId).toBe(started.runId)

    const liveStatus = await Bun.file(join(config.env.QUORUM_RUNS_DIR, started.runPath, "live-status.json")).json()
    expect(liveStatus.phase).toBe("running")
    expect(liveStatus.node).toBe("starting")

    await waitUntil(() => acquireStarted)
    expect(pipelineStarted).toBe(false)

    gate.resolve(async () => {})
    await waitUntil(() => pipelineStarted && manager.status().active === null)
    expect(pipelineStarted).toBe(true)
    expect(manager.status().active).toBeNull()
  })

  test("acquire failure after return clears active and writes error artifacts", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "qurom-instant-fail-"))
    const config = testRuntimeConfig({ dataDir: unitTestDataDir(`instant-fail-${Date.now()}`) })
    config.env.QUORUM_RUNS_DIR = join(dataDir, "runs")
    await mkdir(config.env.QUORUM_RUNS_DIR, { recursive: true })

    const lifecycle = createTestLifecycle({
      acquire: async () => {
        throw new Error("provider failed to start")
      },
    })

    let pipelineStarted = false
    const manager = createRunManager({
      getConfig: () => config,
      lifecycle,
      loadPromptBundleFn: async () => emptyPromptBundle,
      validatePrerequisitesFn: async () => ({ providers: [] }),
      runResearchPipelineFn: async () => {
        pipelineStarted = true
        return { outcome: "completed" as const }
      },
    })

    const started = await manager.startResearch({ inputMode: "topic", topic: "failing start" })
    expect(started.runPath).toBeTruthy()

    await waitUntil(() => manager.status().active === null)
    expect(pipelineStarted).toBe(false)

    const runDir = join(config.env.QUORUM_RUNS_DIR, started.runPath)
    const liveStatus = await Bun.file(join(runDir, "live-status.json")).json()
    expect(liveStatus.phase).toBe("error")
    expect(liveStatus.error).toContain("provider failed to start")

    const failure = await Bun.file(join(runDir, "failure.json")).json()
    expect(failure.error).toContain("provider failed to start")
    expect(failure.phase).toBe("startup")
  })

  test("resumeResearch resolves before slow provider acquire completes", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "qurom-instant-resume-"))
    const config = testRuntimeConfig({ dataDir: unitTestDataDir(`instant-resume-${Date.now()}`) })
    config.env.QUORUM_RUNS_DIR = join(dataDir, "runs")

    const runId = crypto.randomUUID()
    const runPath = `resume-topic-${runId}`
    const runDir = join(config.env.QUORUM_RUNS_DIR, runPath)
    await mkdir(runDir, { recursive: true })
    await Bun.write(join(runDir, "request.json"), JSON.stringify({
      requestId: runId,
      inputMode: "topic",
      topic: "resume me",
    }))

    const gate = deferred<() => Promise<void>>()
    let acquireStarted = false
    const lifecycle = createTestLifecycle({
      acquire: async () => {
        acquireStarted = true
        return gate.promise
      },
    })

    let pipelineStarted = false
    const manager = createRunManager({
      getConfig: () => config,
      lifecycle,
      loadPromptBundleFn: async () => emptyPromptBundle,
      validatePrerequisitesFn: async () => ({ providers: [] }),
      runResearchPipelineFn: async () => {
        pipelineStarted = true
        return { outcome: "completed" as const }
      },
    })

    const resumed = await manager.resumeResearch(runPath)
    expect(resumed.runId).toBe(runPath)
    expect(manager.status().active?.runId).toBe(runPath)

    const liveStatus = await Bun.file(join(runDir, "live-status.json")).json()
    expect(liveStatus.phase).toBe("running")
    expect(liveStatus.node).toBe("starting")

    await waitUntil(() => acquireStarted)
    expect(pipelineStarted).toBe(false)

    gate.resolve(async () => {})
    await waitUntil(() => pipelineStarted && manager.status().active === null)
    expect(pipelineStarted).toBe(true)
  })
})
