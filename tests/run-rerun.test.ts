import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { emptyPromptBundle } from "../src/prompt-assets"
import type { ProviderLifecycle, ProviderLifecycleStatus } from "../src/providers/lifecycle"
import type { AgentProviderId } from "../src/providers/types"
import { createRunManager, resetRunManagerForTests } from "../src/run-manager"
import { loadPriorRunForRerun, parseRerunInterviewMode, RerunLoadError } from "../src/run-rerun"
import type { ReaderCalibrationProfile } from "../src/schema"
import { testRuntimeConfig, unitTestDataDir } from "./test-env"

const sampleProfile: ReaderCalibrationProfile = {
  intent: { goal: "learn the topic", depth: "conceptual" },
  background: { summary: "curious reader" },
  competence: {
    inTopic: { level: "novice", summary: "new to it", evidence: ["said so"] },
    adjacent: { summary: "some coding", evidence: [] },
  },
  inferredGaps: [
    { concept: "basics", treatment: "must-explain", rationale: "needed" },
  ],
}

function createTestLifecycle(): ProviderLifecycle {
  const statuses = new Map<AgentProviderId, ProviderLifecycleStatus>()
  return {
    async acquire(config, providerId) {
      void config
      statuses.set(providerId, "running")
      return async () => {}
    },
    async acquireForRoles(config, roles) {
      void roles
      return this.acquire(config, "opencode")
    },
    status(providerId) {
      return statuses.get(providerId) ?? "idle"
    },
    async shutdown() {},
  }
}

describe("parseRerunInterviewMode", () => {
  test("accepts reuse and fresh", () => {
    expect(parseRerunInterviewMode("reuse")).toBe("reuse")
    expect(parseRerunInterviewMode("fresh")).toBe("fresh")
  })

  test("rejects other values", () => {
    expect(() => parseRerunInterviewMode("skip")).toThrow(RerunLoadError)
  })
})

describe("loadPriorRunForRerun", () => {
  let root = ""

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = ""
  })

  test("loads topic request for fresh interview without profile", async () => {
    root = await mkdtemp(join(tmpdir(), "qurom-rerun-topic-"))
    const runDir = join(root, "my-topic-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, "request.json"), JSON.stringify({
      requestId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      inputMode: "topic",
      topic: "What is MLX?",
    }))

    const loaded = await loadPriorRunForRerun(runDir, "fresh", root)
    expect(loaded.request).toEqual({ inputMode: "topic", topic: "What is MLX?" })
    expect(loaded.readerProfile).toBeUndefined()
  })

  test("loads document text from input.md and reuses validated profile", async () => {
    root = await mkdtemp(join(tmpdir(), "qurom-rerun-doc-"))
    const runDir = join(root, "doc-run-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, "request.json"), JSON.stringify({
      requestId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      inputMode: "document",
      documentPath: join(runDir, "input.md"),
      documentSource: "inline",
    }))
    await writeFile(join(runDir, "input.md"), "# Notes\n\nBody")
    await writeFile(join(runDir, "reader-profile.json"), JSON.stringify(sampleProfile))

    const loaded = await loadPriorRunForRerun(runDir, "reuse", root)
    expect(loaded.request).toEqual({ inputMode: "document", documentText: "# Notes\n\nBody" })
    expect(loaded.readerProfile).toEqual(sampleProfile)
  })

  test("reuse mode requires reader-profile.json", async () => {
    root = await mkdtemp(join(tmpdir(), "qurom-rerun-missing-profile-"))
    const runDir = join(root, "topic-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, "request.json"), JSON.stringify({
      requestId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      inputMode: "topic",
      topic: "What is MLX?",
    }))

    await expect(loadPriorRunForRerun(runDir, "reuse", root)).rejects.toMatchObject({
      name: "RerunLoadError",
      status: 404,
    })
  })
})

describe("run manager rerunResearch", () => {
  let dataDir = ""

  afterEach(async () => {
    resetRunManagerForTests()
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
    dataDir = ""
  })

  test("reuse seeds readerProfile into the pipeline; fresh does not", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "qurom-rerun-manager-"))
    const config = testRuntimeConfig({ dataDir: unitTestDataDir(`rerun-manager-${Date.now()}`) })
    config.env.QUORUM_RUNS_DIR = join(dataDir, "runs")
    await mkdir(config.env.QUORUM_RUNS_DIR, { recursive: true })

    const sourceDir = join(config.env.QUORUM_RUNS_DIR, "source-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    await mkdir(sourceDir, { recursive: true })
    await writeFile(join(sourceDir, "request.json"), JSON.stringify({
      requestId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      inputMode: "topic",
      topic: "What is MLX?",
    }))
    await writeFile(join(sourceDir, "reader-profile.json"), JSON.stringify(sampleProfile))

    async function waitUntil(predicate: () => boolean, timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (predicate()) return
        await Bun.sleep(10)
      }
      throw new Error("timed out waiting for condition")
    }

    const calls: Array<Record<string, unknown>> = []
    const manager = createRunManager({
      getConfig: () => config,
      lifecycle: createTestLifecycle(),
      loadPromptBundleFn: async () => emptyPromptBundle(),
      validatePrerequisitesFn: async () => ({ providers: [] }),
      runResearchPipelineFn: async (args) => {
        calls.push({
          topic: args.request && "topic" in args.request ? args.request.topic : undefined,
          readerProfile: args.readerProfile,
          readerInterviewComplete: args.readerInterviewComplete,
          requestId: args.requestId,
        })
        return {
          requestId: String(args.requestId),
          outcome: "approved",
          raw: {},
        }
      },
    })

    const reused = await manager.rerunResearch(sourceDir, { interview: "reuse" })
    expect(reused.runId).toBeTruthy()
    expect(reused.runPath).not.toContain("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    await waitUntil(() => calls.length === 1 && manager.status().active === null)

    const fresh = await manager.rerunResearch(sourceDir, { interview: "fresh" })
    expect(fresh.runId).toBeTruthy()
    await waitUntil(() => calls.length === 2 && manager.status().active === null)

    expect(calls[0]).toMatchObject({
      topic: "What is MLX?",
      readerInterviewComplete: true,
    })
    expect(calls[0]!.readerProfile).toEqual(sampleProfile)
    expect(calls[1]).toMatchObject({
      topic: "What is MLX?",
    })
    expect(calls[1]!.readerProfile).toBeUndefined()
    expect(calls[1]!.readerInterviewComplete).toBeUndefined()
    expect(calls[0]!.requestId).not.toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
  })
})
