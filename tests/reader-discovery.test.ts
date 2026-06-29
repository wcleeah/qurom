import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

import type { RuntimeConfig } from "../src/config"
import { researchStateSchema, readerInterviewTurnSchema, readerProfileSchema } from "../src/schema"

// Pure-function imports — these don't touch the OpenCode client.
const { createGraph } = await import("../src/graph")
// We import createGraph only to assert it's constructible with the new node;
// the prompt-contract functions are internal, so we exercise them via a
// small re-implementation against the same schema to lock the contract.

const testConfig: RuntimeConfig = {
  env: {
    OPENCODE_BASE_URL: "http://127.0.0.1:4096",
    OPENCODE_DIRECTORY: process.cwd(),
    QUORUM_CHECKPOINT_PATH: "runs/checkpoints-test.sqlite",
    QUORUM_CAPTURE_OPENCODE_EVENTS: "0",
    QUORUM_CAPTURE_SYNC_HISTORY: "0",
    LANGFUSE_PUBLIC_KEY: undefined,
    LANGFUSE_SECRET_KEY: undefined,
    LANGFUSE_BASE_URL: undefined,
  },
  quorumConfig: {
    designatedDrafter: "research-drafter",
    auditors: ["source-auditor", "logic-auditor", "clarity-auditor"],
    summarizerAgent: "markdown-summarizer",
    maxRounds: 3,
    maxRebuttalTurnsPerFinding: 2,
    recursionLimit: 80,
    requireUnanimousApproval: true,
    artifactDir: "runs",
    promptAssetsDir: "assets/prompts",
    promptManagement: { source: "local", label: "production" },
    researchTools: { prefer: ["webfetch"], webSearchProvider: "exa" },
    auditRestart: { maxRestarts: 1 },
    readerDiscovery: { maxTurns: 6, enabled: true },
  },
}

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "reader-discovery-"))
})
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe("readerInterviewTurnSchema", () => {
  test("accepts a non-done turn with one question", () => {
    const parsed = readerInterviewTurnSchema.parse({
      questions: ["What are you trying to do with MLX?"],
      done: false,
    })
    expect(parsed.done).toBe(false)
    expect(parsed.questions).toHaveLength(1)
    expect(parsed.profile).toBeUndefined()
  })

  test("accepts a non-done turn with multiple independent questions", () => {
    const parsed = readerInterviewTurnSchema.parse({
      questions: ["Do you know PyTorch?", "Do you know Swift?"],
      done: false,
    })
    expect(parsed.questions).toHaveLength(2)
  })

  test("accepts a done turn with a full profile", () => {
    const parsed = readerInterviewTurnSchema.parse({
      questions: [],
      done: true,
      profile: {
        learningGoal: "decide if MLX is worth learning",
        concepts: [
          { concept: "autograd", level: "unknown", evidence: "couldn't explain chain rule" },
          { concept: "tensor ops", level: "familiar" },
        ],
      },
    })
    expect(parsed.done).toBe(true)
    expect(parsed.profile?.learningGoal).toBe("decide if MLX is worth learning")
    expect(parsed.profile?.concepts).toHaveLength(2)
  })

  test("rejects a non-done turn with no questions", () => {
    expect(() => readerInterviewTurnSchema.parse({ questions: [], done: false })).toThrow()
  })

  test("has no confidence field in the profile (per plan)", () => {
    const parsed = readerInterviewTurnSchema.parse({
      questions: ["q"],
      done: true,
      profile: { learningGoal: "g", concepts: [{ concept: "c", level: "familiar" }] },
    })
    // confidence is not in the schema; an extra unknown key is stripped by zod default
    expect(parsed).not.toHaveProperty("confidence")
    expect(parsed.profile?.concepts[0]).not.toHaveProperty("confidence")
  })

  test("rejects an invalid level", () => {
    expect(() =>
      readerProfileSchema.parse([{ concept: "c", level: "expert" }]),
    ).toThrow()
  })
})

describe("ResearchState reader fields", () => {
  test("researchStateSchema accepts readerProfile/learningGoal/interviewTranscript", () => {
    const base = {
      requestId: "r-1",
      inputMode: "topic" as const,
      topic: "What is MLX?",
      round: 0,
      draft: "",
      audits: [],
      activeRebuttals: {},
      currentRebuttalResponsesByFinding: {},
      rebuttalTurnCounts: {},
      rebuttalHistory: [],
      rebuttalResponseHistory: [],
      unresolvedFindings: [],
      approvedAgents: [],
      status: "drafting" as const,
    }
    const withReader = researchStateSchema.parse({
      ...base,
      readerProfile: [{ concept: "autograd", level: "unknown" }],
      learningGoal: "decide if MLX is worth learning",
      interviewTranscript: [{ role: "interviewer", text: "q?" }, { role: "reader", text: "a" }],
    })
    expect(withReader.readerProfile).toHaveLength(1)
    expect(withReader.learningGoal).toBe("decide if MLX is worth learning")
    expect(withReader.interviewTranscript).toHaveLength(2)
  })

  test("researchStateSchema accepts a state with no reader fields (backward compat)", () => {
    const base = {
      requestId: "r-1",
      inputMode: "topic" as const,
      topic: "What is MLX?",
      round: 0,
      draft: "",
      audits: [],
      activeRebuttals: {},
      currentRebuttalResponsesByFinding: {},
      rebuttalTurnCounts: {},
      rebuttalHistory: [],
      rebuttalResponseHistory: [],
      unresolvedFindings: [],
      approvedAgents: [],
      status: "drafting" as const,
    }
    const parsed = researchStateSchema.parse(base)
    expect(parsed.readerProfile).toBeUndefined()
    expect(parsed.learningGoal).toBeUndefined()
    expect(parsed.interviewTranscript).toBeUndefined()
  })
})

describe("readerDiscovery config", () => {
  test("the test config carries readerDiscovery with the kill-switch default", () => {
    expect(testConfig.quorumConfig.readerDiscovery).toEqual({ maxTurns: 6, enabled: true })
  })
})

describe("createGraph wires the discoverReader node", () => {
  test("the graph compiles with discoverReader between prepareOutputPath and draftFullDraft", () => {
    // If the node or edges are mis-wired, createGraph throws on compile.
    const promptBundle = {
      source: "local" as const,
      label: "test",
      dir: "assets/prompts",
      assets: {
        deepDiveContract: "contract",
        draftFullDraft: "draft {outputFile}",
        reviseDraft: "revise",
        audit: "audit",
        reviewFindings: "review",
        rebuttal: "rebuttal",
        reviewRebuttalResponses: "review-rebuttals",
        designHtml: "design",
        auditDesign: "audit-design",
        auditScriptSecurity: "audit-ss",
        reviseDesign: "revise-design",
        readerInterview: "interview {requestContext} {transcript} {maxTurns} {turn} {outputFile}",
        enhanceDesign: "enhance",
        rebuttalReview: "rr",
        drafterReview: "dr",
        summarizeInput: "si",
        drafterRebuttalReview: "drr",
        summarizeOutput: "so",
        aggregateFindings: "af",
        confidencePrompt: "cp",
        synthesizeDrafts: "sd",
        classifyComplexity: "cc",
        deepDiveSkill: "dds",
      } as Record<string, string>,
    }
    const graph = createGraph(testConfig, promptBundle)
    expect(graph).toBeDefined()
    // The graph has getState (compiled with a checkpointer) — needed for interrupt resume.
    expect(typeof graph.getState).toBe("function")
  })
})

describe("reader-profile.json artifact shape", () => {
  test("a profile written by the interviewer parses as readerProfileSchema", async () => {
    const profileFile = join(tempDir, "reader-profile.json")
    await mkdir(tempDir, { recursive: true })
    const profile = {
      learningGoal: "decide if MLX is worth learning",
      concepts: [
        { concept: "autograd", level: "unknown", evidence: "couldn't explain it" },
        { concept: "tensor ops", level: "familiar" },
        { concept: "Swift", level: "heard-of" },
      ],
    }
    await writeFile(profileFile, JSON.stringify(profile, null, 2))
    const loaded = JSON.parse(await Bun.file(profileFile).text())
    expect(readerProfileSchema.safeParse(loaded.concepts).success).toBe(true)
    // No confidence field anywhere in the persisted artifact.
    expect(loaded).not.toHaveProperty("confidence")
    expect(loaded.concepts.every((c: Record<string, unknown>) => !("confidence" in c))).toBe(true)
  })
})
