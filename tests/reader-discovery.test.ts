import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

import type { RuntimeConfig } from "../src/config"
import { researchStateSchema, readerInterviewTurnSchema, readerProfileSchema, type ResearchState } from "../src/schema"

// Pure-function imports — these don't touch the OpenCode client.
const {
  createGraph,
  fullDraftPrompt,
  auditPrompt,
  rebuttalPrompt,
  rebuttalReviewPrompt,
  drafterReviewPrompt,
  readerContextBlock,
  repeatsPreviousReaderQuestion,
} = await import("../src/graph")
const { loadPromptBundle } = await import("../src/prompt-assets")
const { promptAssetFiles } = await import("../src/prompt-asset-defs")
const { formatReaderTranscriptForPrompt } = await import("../src/reader-transcript")

const testConfig: RuntimeConfig = {
  env: {
    OPENCODE_BASE_URL: "http://127.0.0.1:4096",
    OPENCODE_DIRECTORY: process.cwd(),
    QUORUM_WORKSPACE_DIRECTORY: process.cwd(),
    QUORUM_CHECKPOINT_PATH: "runs/checkpoints-test.sqlite",
    QUORUM_CONFIG_DB_PATH: "runs/quorum-config.sqlite",
    QUORUM_CAPTURE_OPENCODE_EVENTS: "0",
    QUORUM_CAPTURE_SYNC_HISTORY: "0",
    CURSOR_API_KEY: undefined,
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
      newQuestions: ["What are you trying to do with MLX?"],
      done: false,
    })
    expect(parsed.done).toBe(false)
    expect(parsed.newQuestions).toHaveLength(1)
    expect(parsed.profile).toBeUndefined()
  })

  test("accepts a non-done turn with multiple independent questions", () => {
    const parsed = readerInterviewTurnSchema.parse({
      newQuestions: ["Do you know PyTorch?", "Do you know Swift?"],
      done: false,
    })
    expect(parsed.newQuestions).toHaveLength(2)
  })

  test("accepts a done turn with a full profile", () => {
    const parsed = readerInterviewTurnSchema.parse({
      newQuestions: [],
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
    expect(() => readerInterviewTurnSchema.parse({ newQuestions: [], done: false })).toThrow()
  })

  test("has no confidence field in the profile (per plan)", () => {
    const parsed = readerInterviewTurnSchema.parse({
      newQuestions: ["q"],
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
      pendingNewReaderQuestions: ["What are you trying to do?", "What have you read so far?\nMention file paths if relevant."],
      interviewTranscript: [{ role: "interviewer", text: "q?" }, { role: "reader", text: "a" }],
    })
    expect(withReader.readerProfile).toHaveLength(1)
    expect(withReader.learningGoal).toBe("decide if MLX is worth learning")
    expect(withReader.pendingNewReaderQuestions).toHaveLength(2)
    expect(withReader.pendingNewReaderQuestions?.[1]).toContain("file paths")
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
    expect(parsed.pendingNewReaderQuestions).toBeUndefined()
    expect(parsed.interviewTranscript).toBeUndefined()
  })
})

describe("readerDiscovery config", () => {
  test("the test config carries readerDiscovery with the kill-switch default", () => {
    expect(testConfig.quorumConfig.readerDiscovery).toEqual({ maxTurns: 6, enabled: true })
  })
})

describe("reader interview prompt assets", () => {
  test("keeps first, follow-up, and duplicate-correction guidance in prompt assets", async () => {
    expect(promptAssetFiles.readerInterview).toBe("reader-interview.md")
    expect(promptAssetFiles.readerInterviewFollowUp).toBe("reader-interview-follow-up.md")
    expect(promptAssetFiles.readerInterviewDuplicateCorrection).toBe("reader-interview-duplicate-correction.md")

    const bundle = await loadPromptBundle(testConfig)
    expect(bundle.assets.readerInterview).toContain("first interview turn")
    expect(bundle.assets.readerInterviewFollowUp).toContain("continuing an existing reader interview")
    expect(bundle.assets.readerInterviewDuplicateCorrection).toContain("previous response repeated")
    expect(bundle.assets.readerInterview).toContain("`newQuestions` array")
    expect(bundle.assets.readerInterviewFollowUp).toContain("`newQuestions` array")
    expect(bundle.assets.readerInterviewDuplicateCorrection).toContain("`newQuestions` array")
    expect(bundle.assets.readerInterviewFollowUp).not.toContain("Follow-up guidance")
  })

  test("formats batched reader questions and answers as numbered pairs", () => {
    const transcript = [
      { role: "interviewer" as const, text: "What are you trying to accomplish?\nHow familiar are you with ML?" },
      { role: "reader" as const, text: "Answer 1: Pure curiosity.\n\nAnswer 2: Quite new." },
    ]

    const formatted = formatReaderTranscriptForPrompt(transcript)
    expect(formatted).toContain("Question 1: What are you trying to accomplish?")
    expect(formatted).toContain("Answer 1: Pure curiosity.")
    expect(formatted).toContain("Question 2: How familiar are you with ML?")
    expect(formatted).toContain("Answer 2: Quite new.")
  })

  test("detects repeated interviewer questions", () => {
    const transcript = [
      { role: "interviewer" as const, text: "What are you trying to learn or build with MLX?" },
      { role: "reader" as const, text: "I am curious and trying to catch up." },
    ]

    expect(repeatsPreviousReaderQuestion(["What are you trying to learn or build with MLX?"], transcript)).toBe(true)
    expect(repeatsPreviousReaderQuestion(["Have you used PyTorch or NumPy before?"], transcript)).toBe(false)
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
        readerInterviewFollowUp: "interview follow-up {requestContext} {transcript} {maxTurns} {turn} {outputFile}",
        readerInterviewDuplicateCorrection: "interview correction {requestContext} {transcript} {maxTurns} {turn} {outputFile}",
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

describe("reader-profile-N.json artifact shape", () => {
  test("a profile written by the interviewer parses as readerProfileSchema", async () => {
    const profileFile = join(tempDir, "reader-profile-1.json")
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

describe("Phase 2 — reader profile threaded to prompt-contract functions", () => {
  const profileState = (overrides: Partial<ResearchState> = {}) =>
    researchStateSchema.parse({
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
      status: "auditing" as const,
      readerProfile: [
        { concept: "autograd", level: "unknown", evidence: "couldn't explain it" },
        { concept: "tensor ops", level: "familiar" },
      ],
      learningGoal: "decide if MLX is worth learning",
      ...overrides,
    }) as ResearchState

  let promptBundle: Awaited<ReturnType<typeof loadPromptBundle>>
  beforeEach(async () => {
    promptBundle = await loadPromptBundle(testConfig)
  })

  test("readerContextBlock lists familiar concepts, lacks, and the Prerequisites instruction", () => {
    const block = readerContextBlock(profileState())
    expect(block).toContain("Reader goal: decide if MLX is worth learning")
    expect(block).toContain("Reader already knows: tensor ops")
    expect(block).toContain("Reader does NOT know: autograd")
    expect(block).toContain("Include a Prerequisites section covering: autograd")
  })

  test("readerContextBlock returns empty when no profile and no goal (default-reader fallback)", () => {
    const block = readerContextBlock(profileState({ readerProfile: undefined, learningGoal: undefined }))
    expect(block).toBe("")
  })

  test("fullDraftPrompt includes the reader context block when a profile is set", () => {
    const prompt = fullDraftPrompt(testConfig, promptBundle, profileState(), "out.md")
    expect(prompt).toContain("Reader does NOT know: autograd")
    expect(prompt).toContain("Include a Prerequisites section covering: autograd")
  })

  test("fullDraftPrompt omits reader context when no profile is set", () => {
    const prompt = fullDraftPrompt(testConfig, promptBundle, profileState({ readerProfile: undefined, learningGoal: undefined }), "out.md")
    expect(prompt).not.toContain("Prerequisites section")
    expect(prompt).not.toContain("Reader does NOT know")
  })

  test("auditPrompt includes the reader context block when a profile is set", () => {
    const prompt = auditPrompt(testConfig, promptBundle, "source-auditor", profileState(), "audit.json")
    expect(prompt).toContain("Reader does NOT know: autograd")
  })

  test("auditPrompt includes the explanation-depth-vs-factual-rigor instruction", () => {
    const prompt = auditPrompt(testConfig, promptBundle, "source-auditor", profileState(), "audit.json")
    expect(prompt).toContain("Judge clarity")
    expect(prompt).toContain("factual rigor")
  })

  test("auditPrompt omits reader context when no profile is set (and notes the default)", () => {
    const prompt = auditPrompt(testConfig, promptBundle, "source-auditor", profileState({ readerProfile: undefined, learningGoal: undefined }), "audit.json")
    expect(prompt).not.toContain("Reader does NOT know")
    expect(prompt).toContain("no reader profile provided")
  })

  test("rebuttalPrompt includes the reader context block when a profile is set", () => {
    const prompt = rebuttalPrompt(testConfig, promptBundle, profileState(), "rebuttal.json")
    expect(prompt).toContain("Reader does NOT know: autograd")
  })

  test("rebuttalReviewPrompt includes the reader context block when a profile is set", () => {
    const prompt = rebuttalReviewPrompt(testConfig, promptBundle, profileState(), "review.json", 2)
    expect(prompt).toContain("Reader does NOT know: autograd")
  })

  test("drafterReviewPrompt includes the reader context block when a profile is set", () => {
    const prompt = drafterReviewPrompt(testConfig, promptBundle, profileState(), "review.json")
    expect(prompt).toContain("Reader does NOT know: autograd")
  })
})
