import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { RuntimeConfig } from "../src/config"
import {
  researchStateSchema,
  readerInterviewTurnSchema,
  readerCalibrationProfileSchema,
  type ReaderCalibrationProfile,
  type ResearchState,
} from "../src/schema"
import { ensureConfigInitialized } from "../src/config-store"
import { prepareTestDataDir, testRuntimeConfig } from "./test-env"

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
const { formatReaderProfileForPrompt, readerContextBlock: readerContextFromProfile } = await import("../src/reader-profile")

export function sampleReaderProfile(overrides: Partial<ReaderCalibrationProfile> = {}): ReaderCalibrationProfile {
  return readerCalibrationProfileSchema.parse({
    intent: {
      goal: "decide if MLX is worth learning",
      depth: "evaluation",
    },
    background: {
      summary: "Daily PyTorch user; no Swift or Apple stack experience",
    },
    competence: {
      inTopic: {
        level: "intermediate",
        summary: "Understands training loops; weak on low-level runtime",
        evidence: ["could not explain kernel compilation"],
      },
      adjacent: {
        summary: "Strong PyTorch background",
        evidence: ["uses PyTorch daily for model training"],
      },
    },
    inferredGaps: [
      { concept: "autograd", treatment: "must-explain", rationale: "could not explain how gradients flow" },
      { concept: "Swift", treatment: "brief-recap", rationale: "no Apple stack experience mentioned" },
      { concept: "tensor ops", treatment: "can-assume", rationale: "daily PyTorch use" },
    ],
    ...overrides,
  })
}

let testConfig: RuntimeConfig
let tempDir: string
let workspaceDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "reader-discovery-"))
  workspaceDir = tempDir
  const dataDir = await prepareTestDataDir(workspaceDir)
  testConfig = testRuntimeConfig({
    dataDir,
    workspaceDir,
    quorumOverrides: {
      maxRounds: 3,
      maxRebuttalTurnsPerFinding: 2,
      researchTools: { prefer: ["webfetch"], webSearchProvider: "exa" },
      readerDiscovery: { maxTurns: 6, enabled: true },
    },
  })
  await ensureConfigInitialized(testConfig.env)
})
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe("readerInterviewTurnSchema", () => {
  test("accepts a non-done turn with profile and one question", () => {
    const parsed = readerInterviewTurnSchema.parse({
      newQuestions: ["What are you trying to get out of this topic?"],
      done: false,
      profile: sampleReaderProfile({
        intent: { goal: "not yet clear", depth: "overview" },
        inferredGaps: [],
      }),
    })
    expect(parsed.done).toBe(false)
    expect(parsed.newQuestions).toHaveLength(1)
    expect(parsed.profile.intent.goal).toBe("not yet clear")
  })

  test("accepts unknown enum placeholders on an early interview turn", () => {
    const parsed = readerInterviewTurnSchema.parse({
      newQuestions: ["What's your goal with this document?"],
      done: false,
      profile: {
        intent: {
          goal: "not yet clear",
          depth: "unknown",
        },
        background: {
          summary: "Not yet known — first turn.",
        },
        competence: {
          inTopic: {
            level: "unknown",
            summary: "Not yet known — first turn.",
            evidence: [],
          },
          adjacent: {
            summary: "Not yet known — first turn.",
            evidence: [],
          },
        },
        inferredGaps: [
          {
            concept: "unified memory model on Apple silicon",
            treatment: "must-explain",
            rationale: "MLX's unified memory is central to the framework's value.",
          },
        ],
      },
    })
    expect(parsed.profile.intent.depth).toBe("unknown")
    expect(parsed.profile.competence.inTopic.level).toBe("unknown")
  })

  test("accepts a non-done turn with multiple independent questions", () => {
    const parsed = readerInterviewTurnSchema.parse({
      newQuestions: ["What are you trying to accomplish?", "What is your ML background?"],
      done: false,
      profile: sampleReaderProfile({ inferredGaps: [] }),
    })
    expect(parsed.newQuestions).toHaveLength(2)
  })

  test("accepts a done turn with a full profile and no questions", () => {
    const profile = sampleReaderProfile()
    const parsed = readerInterviewTurnSchema.parse({
      newQuestions: [],
      done: true,
      profile,
    })
    expect(parsed.done).toBe(true)
    expect(parsed.profile.inferredGaps).toHaveLength(3)
  })

  test("rejects a non-done turn with no questions", () => {
    expect(() => readerInterviewTurnSchema.parse({
      newQuestions: [],
      done: false,
      profile: sampleReaderProfile(),
    })).toThrow()
  })

  test("rejects a turn with no profile", () => {
    expect(() => readerInterviewTurnSchema.parse({
      newQuestions: ["q"],
      done: false,
    })).toThrow()
  })

  test("rejects an invalid gap treatment", () => {
    expect(() => readerCalibrationProfileSchema.parse({
      ...sampleReaderProfile(),
      inferredGaps: [{ concept: "x", treatment: "quiz", rationale: "bad" }],
    })).toThrow()
  })
})

describe("ResearchState reader fields", () => {
  test("researchStateSchema accepts readerProfile, interview completion, and transcript", () => {
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
      readerProfile: sampleReaderProfile(),
      readerInterviewComplete: false,
      pendingNewReaderQuestions: ["What are you trying to do?"],
      interviewTranscript: [{ role: "interviewer", text: "q?" }, { role: "reader", text: "a" }],
    })
    expect(withReader.readerProfile?.intent.goal).toContain("MLX")
    expect(withReader.readerInterviewComplete).toBe(false)
    expect(withReader.pendingNewReaderQuestions).toHaveLength(1)
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
    expect(parsed.readerInterviewComplete).toBeUndefined()
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
    expect(promptAssetFiles.readerInterviewerInterview).toBe("reader-interviewer.interview.md")
    expect(promptAssetFiles.readerInterviewerFollowUp).toBe("reader-interviewer.follow-up.md")
    expect(promptAssetFiles.readerInterviewerDuplicateCorrection).toBe("reader-interviewer.duplicate-correction.md")

    const bundle = await loadPromptBundle(testConfig)
    expect(bundle.assets.readerInterviewerInterview).toContain("turn {turn}")
    expect(bundle.assets.readerInterviewerInterview).toContain("do not quiz them on terminology")
    expect(bundle.assets.readerInterviewerInterview).toContain("do not force prerequisites")
    expect(bundle.assets.readerInterviewerFollowUp).toContain("Continue the reader interview")
    expect(bundle.assets.readerInterviewerFollowUp).toContain("{profileSoFar}")
    expect(bundle.assets.readerInterviewerFollowUp).toContain("do not force prerequisites")
    expect(bundle.assets.readerInterviewerDuplicateCorrection).toContain("previous response repeated")
    expect(bundle.assets.readerInterviewerInterview).toContain("`newQuestions`")
    expect(bundle.assets.readerInterviewerFollowUp).toContain("`newQuestions`")
    expect(bundle.assets.readerInterviewerDuplicateCorrection).toContain("`newQuestions`")
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

  test("formats partial profile for follow-up prompts", () => {
    const formatted = formatReaderProfileForPrompt(sampleReaderProfile())
    expect(formatted).toContain("Goal: decide if MLX is worth learning")
    expect(formatted).toContain("In-topic (intermediate)")
    expect(formatted).toContain("autograd (must-explain)")
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
  test("the graph compiles with discoverReader between prepareOutputPath and draftFullDraft", async () => {
    const { emptyPromptBundle } = await import("../src/prompt-assets")
    const promptBundle = emptyPromptBundle({
      researchDrafterDraft: "draft {outputFile}",
      readerInterviewerInterview: "interview {requestContext} {profileSoFar} {transcript} {maxTurns} {turn}",
      readerInterviewerFollowUp: "interview follow-up {requestContext} {profileSoFar} {transcript} {maxTurns} {turn}",
      readerInterviewerDuplicateCorrection: "interview correction {requestContext} {profileSoFar} {transcript} {maxTurns} {turn}",
    })
    const graph = createGraph(testConfig, promptBundle)
    expect(graph).toBeDefined()
    expect(typeof graph.getState).toBe("function")
  })
})

describe("reader-profile.json artifact shape", () => {
  test("an accepted profile parses as readerCalibrationProfileSchema", async () => {
    const profileFile = join(tempDir, "reader-profile.json")
    await mkdir(tempDir, { recursive: true })
    const profile = sampleReaderProfile({ inferredGaps: [] })
    await writeFile(profileFile, JSON.stringify(profile, null, 2))
    const loaded = JSON.parse(await Bun.file(profileFile).text())
    expect(readerCalibrationProfileSchema.safeParse(loaded).success).toBe(true)
  })
})

describe("reader profile threaded to prompt-contract functions", () => {
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
      readerProfile: sampleReaderProfile(),
      readerInterviewComplete: true,
      ...overrides,
    }) as ResearchState

  let promptBundle: Awaited<ReturnType<typeof loadPromptBundle>>
  beforeEach(async () => {
    promptBundle = await loadPromptBundle(testConfig)
  })

  test("readerContextBlock lists intent, competence, and prerequisites from inferred gaps", () => {
    const block = readerContextBlock(profileState())
    expect(block).toContain("Reader goal: decide if MLX is worth learning")
    expect(block).toContain("Desired depth: evaluation")
    expect(block).toContain("In-topic level (intermediate)")
    expect(block).toContain("Reader already knows (do not re-teach): tensor ops")
    expect(block).toContain("Include a Prerequisites section covering: autograd, Swift")
    expect(block).toContain("Explain fully before the main topic: autograd")
    expect(block).toContain("Brief recap only in Prerequisites: Swift")
  })

  test("readerContextBlock returns empty when no profile (default-reader fallback)", () => {
    const block = readerContextBlock(profileState({ readerProfile: undefined }))
    expect(block).toBe("")
    expect(readerContextFromProfile(undefined)).toBe("")
  })

  test("fullDraftPrompt includes the reader context block when a profile is set", () => {
    const prompt = fullDraftPrompt(testConfig, promptBundle, profileState())
    expect(prompt).toContain("Include a Prerequisites section covering: autograd, Swift")
    expect(prompt).toContain("Desired depth: evaluation")
  })

  test("fullDraftPrompt omits reader context when no profile is set", () => {
    const prompt = fullDraftPrompt(testConfig, promptBundle, profileState({ readerProfile: undefined }))
    expect(prompt).not.toContain("Prerequisites section")
    expect(prompt).not.toContain("Reader goal")
  })

  test("fullDraftPrompt includes pasted document text for document-mode runs", () => {
    const state = profileState({
      inputMode: "document" as const,
      topic: undefined,
      documentPath: "/runs/example/input.md",
      documentText: "# My pasted notes\n\nContent about MLX.",
    })
    const prompt = fullDraftPrompt(testConfig, promptBundle, state)
    expect(prompt).toContain("My pasted notes")
    expect(prompt).toContain("Content about MLX.")
  })

  test("auditPrompt includes the reader context block when a profile is set", () => {
    const prompt = auditPrompt(testConfig, promptBundle, "source-auditor", profileState(), "audit.json")
    expect(prompt).toContain("Include a Prerequisites section covering: autograd, Swift")
  })

  test("auditPrompt scopes reader calibration per auditor", () => {
    const source = auditPrompt(testConfig, promptBundle, "source-auditor", profileState(), "audit.json")
    expect(source).toContain("does not change evidence standards")
    expect(source).not.toContain("judge for this reader")

    const clarity = auditPrompt(testConfig, promptBundle, "clarity-auditor", profileState(), "audit.json")
    expect(clarity).toContain("judge for this reader")
    expect(clarity).toContain("Do not use this profile to invent source or logic findings")
  })

  test("auditPrompt omits reader context when no profile is set (and notes the default)", () => {
    const prompt = auditPrompt(testConfig, promptBundle, "source-auditor", profileState({ readerProfile: undefined }), "audit.json")
    expect(prompt).not.toContain("Reader goal")
    expect(prompt).toContain("no reader profile provided")
  })

  test("rebuttalPrompt includes the reader context block when a profile is set", () => {
    const prompt = rebuttalPrompt(testConfig, promptBundle, "source-auditor", profileState())
    expect(prompt).toContain("Desired depth: evaluation")
  })

  test("rebuttalReviewPrompt includes the reader context block when a profile is set", () => {
    const prompt = rebuttalReviewPrompt(testConfig, promptBundle, profileState(), 2)
    expect(prompt).toContain("Desired depth: evaluation")
  })

  test("drafterReviewPrompt includes the reader context block when a profile is set", () => {
    const prompt = drafterReviewPrompt(testConfig, promptBundle, profileState())
    expect(prompt).toContain("Desired depth: evaluation")
  })
})
