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
  intent: { goal: "learn the topic", secondaryGoals: [], depth: "conceptual" },
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
  test("accepts reuse, fresh, and repair", () => {
    expect(parseRerunInterviewMode("reuse")).toBe("reuse")
    expect(parseRerunInterviewMode("fresh")).toBe("fresh")
    expect(parseRerunInterviewMode("repair")).toBe("repair")
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
    expect(loaded.readerProfile).toEqual({
      ...sampleProfile,
      intent: { ...sampleProfile.intent, secondaryGoals: [] },
    })
  })

  test("legacy profile without secondaryGoals still loads for reuse", async () => {
    root = await mkdtemp(join(tmpdir(), "qurom-rerun-legacy-"))
    const runDir = join(root, "legacy-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, "request.json"), JSON.stringify({
      requestId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      inputMode: "topic",
      topic: "Python packages and modules system.",
    }))
    const legacy = {
      intent: {
        goal: "Organize multi-file projects cleanly, diagnose import errors confidently, and understand how Python’s import machinery resolves and loads code",
        depth: "implementation",
        format: "Practical conceptual guide",
      },
      background: { summary: "Already writing multi-file Python" },
      competence: {
        inTopic: { level: "novice", summary: "hitting import friction", evidence: ["said so"] },
        adjacent: { summary: "comfortable with Python", evidence: [] },
      },
      inferredGaps: [
        { concept: "sys.path", treatment: "must-explain", rationale: "central" },
      ],
    }
    await writeFile(join(runDir, "reader-profile.json"), JSON.stringify(legacy))

    const loaded = await loadPriorRunForRerun(runDir, "reuse", root)
    expect(loaded.readerProfile?.intent.goal).toContain("Organize multi-file")
    expect(loaded.readerProfile?.intent.secondaryGoals).toEqual([])
  })

  test("repair mode loads profile and completed transcript", async () => {
    root = await mkdtemp(join(tmpdir(), "qurom-rerun-repair-"))
    const runDir = join(root, "repair-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, "request.json"), JSON.stringify({
      requestId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      inputMode: "topic",
      topic: "Python packages",
    }))
    await writeFile(join(runDir, "reader-profile.json"), JSON.stringify(sampleProfile))
    await writeFile(join(runDir, "question-1.json"), JSON.stringify({
      questions: ["organize, diagnose, or understand?"],
    }))
    await writeFile(join(runDir, "reply-1.json"), JSON.stringify({ reply: "All of the above." }))

    const loaded = await loadPriorRunForRerun(runDir, "repair", root)
    expect(loaded.readerProfile?.intent.goal).toBe("learn the topic")
    expect(loaded.interviewTranscript).toEqual([
      { role: "interviewer", text: "organize, diagnose, or understand?" },
      { role: "reader", text: "All of the above." },
    ])
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

  test("reuse seeds readerProfile into the pipeline; repair seeds repair flag; fresh does not", async () => {
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
    await writeFile(join(sourceDir, "question-1.json"), JSON.stringify({
      questions: ["What do you want?"],
    }))
    await writeFile(join(sourceDir, "reply-1.json"), JSON.stringify({ reply: "All of the above." }))

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
          readerProfileRepair: args.readerProfileRepair,
          interviewTranscript: args.interviewTranscript,
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

    const repaired = await manager.rerunResearch(sourceDir, { interview: "repair" })
    expect(repaired.runId).toBeTruthy()
    await waitUntil(() => calls.length === 2 && manager.status().active === null)

    const fresh = await manager.rerunResearch(sourceDir, { interview: "fresh" })
    expect(fresh.runId).toBeTruthy()
    await waitUntil(() => calls.length === 3 && manager.status().active === null)

    expect(calls[0]).toMatchObject({
      topic: "What is MLX?",
      readerInterviewComplete: true,
    })
    expect(calls[0]!.readerProfile).toEqual(sampleProfile)
    expect(calls[0]!.readerProfileRepair).toBeUndefined()

    expect(calls[1]).toMatchObject({
      topic: "What is MLX?",
      readerInterviewComplete: false,
      readerProfileRepair: true,
    })
    expect(calls[1]!.readerProfile).toEqual(sampleProfile)
    expect(calls[1]!.interviewTranscript).toEqual([
      { role: "interviewer", text: "What do you want?" },
      { role: "reader", text: "All of the above." },
    ])

    expect(calls[2]).toMatchObject({
      topic: "What is MLX?",
    })
    expect(calls[2]!.readerProfile).toBeUndefined()
    expect(calls[2]!.readerInterviewComplete).toBeUndefined()
    expect(calls[0]!.requestId).not.toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
  })
})
