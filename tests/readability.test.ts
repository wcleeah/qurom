import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { SystemOneResult } from "@typesafe-ai/sdk"

import type { AgentRuntime } from "../src/agent-runtime/runtime"
import { formatReadabilityHints } from "../src/readability/hints"
import { deriveHotspots, scoreDraftReadability, takeUnchangedPassedUnit } from "../src/readability/score"
import { segmentDraft } from "../src/readability/segment"
import { readabilityReportSchema, POSTHOC_RAW_FILENAME, POSTHOC_REPORT_FILENAME, type ReadabilityHotspot, type ReadabilityReport, type ReadabilityUnit } from "../src/readability/schema"
import {
  hasReviewableMarkdown,
  pickReviewableMarkdownFilename,
  PosthocReviewError,
  scoreCompletedRun,
} from "../src/readability/posthoc"
import { DEFAULT_READABILITY_THRESHOLDS, READABILITY_AUDIENCE, READABILITY_REGISTER, buildReadabilityQuestions, type ReadabilityQuestions } from "../src/readability/criteria"
import {
  disposeDrafterWritingSession,
  readabilityReviewPrompt,
  reviseReadability,
  routeAfterReadabilityScore,
  scoreReadability,
  type ReadabilityGraphDeps,
} from "../src/graph"
import { promptAssetFiles } from "../src/prompt-asset-defs"
import { emptyPromptBundle } from "../src/prompt-assets"
import { AUDITOR_ROLES } from "../src/role-registry"
import type { ResearchState } from "../src/schema"
import { testRuntimeConfig } from "./test-env"

function scoreAnswer(score: number, confidence = 0.85) {
  return {
    type: "score" as const,
    score,
    confidence,
    legend: { 0: "low", 1: "mid", 2: "high" },
    probabilities: { 0: 0.05, 1: 0.1, 2: 0.85 },
  }
}

function unit(overrides: Partial<ReadabilityUnit> = {}): ReadabilityUnit {
  const baseScore = scoreAnswer(0.4, 0.9)
  return {
    id: "s1-p1",
    section: "Wire format",
    quote: "The framing bit chooses the decoder before any payload is interpreted.",
    scores: {
      convolution: baseScore,
      inversion: baseScore,
      diction: baseScore,
      formality: baseScore,
      density: baseScore,
    },
    gates: {
      inversionEarned: 0.1,
      densityIsOneMove: 0.1,
      dictionIsDomainTerm: 0.1,
    },
    remedy: {
      choice: "unnest",
      confidence: 0.8,
      probabilities: { unnest: 0.8, keep: 0.2 },
    },
    ...overrides,
  }
}

function mockSystemOne(score: number): ReadabilityGraphDeps["systemOne"] {
  return async (request) => {
    const questions = request.questions as ReadabilityQuestions
    return {
      model: "jev-latest",
      usage: { input_tokens: 10, output_tokens: 4 },
      answers: {
        convolution: scoreAnswer(score),
        inversion: scoreAnswer(0.2),
        diction: scoreAnswer(0.2),
        formality: scoreAnswer(0.2),
        density: scoreAnswer(0.2),
        inversionEarned: { type: "noul", noul: 0.1 },
        densityIsOneMove: { type: "noul", noul: 0.1 },
        dictionIsDomainTerm: { type: "noul", noul: 0.1 },
        remedy: {
          type: "choice",
          choice: score >= 1.3 ? "unnest" : "keep",
          confidence: 0.8,
          probabilities: { unnest: score >= 1.3 ? 0.8 : 0.1, keep: score >= 1.3 ? 0.2 : 0.9 },
        },
      },
    } as SystemOneResult<typeof questions>
  }
}

describe("segmentDraft", () => {
  test("skips sources, fences, tables, and short labels", () => {
    const units = segmentDraft(`# Title

This opening paragraph is long enough to count as prose for the readability reviewer.

## Details

Another substantial paragraph that should be scored because it carries a complete idea.

\`\`\`
code should be ignored entirely
\`\`\`

| col | col |
| --- | --- |
| a | b |

## Sources

This bibliographic paragraph must not be scored even though it is long enough.
`)
    expect(units.map((unit) => unit.id)).toEqual(["s1-p1", "s2-p1"])
    expect(units[0]?.section).toBe("Title")
    expect(units[1]?.section).toBe("Details")
  })
})

describe("deriveHotspots", () => {
  test("requires a tripped score, failed noul, and a non-keep remedy", () => {
    const tripped = unit({
      scores: {
        ...unit().scores,
        convolution: scoreAnswer(1.8),
      },
    })
    expect(deriveHotspots([tripped], DEFAULT_READABILITY_THRESHOLDS)).toHaveLength(1)

    const saved = unit({
      scores: { ...unit().scores, inversion: scoreAnswer(1.8) },
      gates: { ...unit().gates, inversionEarned: 0.7 },
    })
    expect(deriveHotspots([saved], DEFAULT_READABILITY_THRESHOLDS)).toHaveLength(0)

    const kept = unit({
      scores: { ...unit().scores, convolution: scoreAnswer(1.8) },
      remedy: { ...unit().remedy, choice: "keep" },
    })
    expect(deriveHotspots([kept], DEFAULT_READABILITY_THRESHOLDS)).toHaveLength(0)
  })

  test("uses a higher bar for formality", () => {
    const stiff = unit({
      scores: { ...unit().scores, formality: scoreAnswer(1.4) },
    })
    expect(deriveHotspots([stiff], DEFAULT_READABILITY_THRESHOLDS)).toHaveLength(0)
    const ornate = unit({
      scores: { ...unit().scores, formality: scoreAnswer(1.7) },
    })
    expect(deriveHotspots([ornate], DEFAULT_READABILITY_THRESHOLDS)).toHaveLength(1)
  })

  test("ignores a tripped score below the confidence floor", () => {
    const quiet = unit({
      scores: { ...unit().scores, convolution: scoreAnswer(1.8, 0.2) },
    })
    expect(deriveHotspots([quiet], DEFAULT_READABILITY_THRESHOLDS)).toHaveLength(0)
  })
})

describe("formatReadabilityHints", () => {
  test("includes every hotspot and no cap", () => {
    const hotspots = Array.from({ length: 10 }, (_, i) => ({
      unitId: `s1-p${i + 1}`,
      section: "Wire format",
      quote: `Paragraph ${i + 1} is long enough to quote in the readability review notes.`,
      criterion: "convolution" as const,
      score: 1.8,
      confidence: 0.74,
      remedy: "unnest" as const,
    }))
    const hints = formatReadabilityHints(hotspots)
    expect(hints).toContain("## Readability review")
    expect(hints.match(/^\- \[/gm)?.length).toBe(10)
    expect(hints).not.toContain("auditor")
  })
})

describe("scoreDraftReadability", () => {
  test("marks a draft clean when scores stay below the trip", async () => {
    const { report } = await scoreDraftReadability({
      units: [{
        id: "s1-p1",
        section: "Intro",
        quote: "A substantial paragraph about the framing bit and how the decoder is chosen.",
        before: "",
        after: "",
      }],
      context: { articleJob: "Explain framing", reader: { familiar: [], unfamiliar: [] } },
      model: "jev-latest",
      thresholds: DEFAULT_READABILITY_THRESHOLDS,
      systemOne: mockSystemOne(0.4)!,
      round: 0,
      tryIndex: 0,
    })
    expect(report.passed).toBe(true)
    expect(report.hotspots).toEqual([])
  })

  test("tells Jev the reader is fluent but not a native English speaker", async () => {
    const seen: Array<Record<string, unknown>> = []
    const inner = mockSystemOne(0.4)!
    const { raw } = await scoreDraftReadability({
      units: [{
        id: "s1-p1",
        section: "Intro",
        quote: "A substantial paragraph about the framing bit and how the decoder is chosen.",
        before: "",
        after: "",
      }],
      context: { articleJob: "Explain framing", reader: { familiar: ["framing"], unfamiliar: [] } },
      model: "jev-latest",
      thresholds: DEFAULT_READABILITY_THRESHOLDS,
      systemOne: async (request) => {
        seen.push(request.state)
        return inner(request)
      },
      round: 0,
      tryIndex: 0,
    })
    expect(seen[0]?.audience).toBe(READABILITY_AUDIENCE)
    expect(seen[0]?.register).toBe(READABILITY_REGISTER)
    expect(String(seen[0]?.audience)).toContain("not a native English speaker")
    expect(String(seen[0]?.register)).toContain("non-native English reader")
    expect(raw[0]?.state.audience).toBe(READABILITY_AUDIENCE)
  })

  test("reuses unchanged passed units and only scores the rest", async () => {
    const passedQuote = "This opening paragraph is long enough to count as prose for the readability reviewer."
    const hotspotQuote = "Another substantial paragraph that should be scored because it carries a complete idea."
    const rewritten = "The framing bit chooses the decoder before any payload is interpreted in this rewrite."
    const previousUnits = [
      unit({
        id: "s1-p1",
        quote: passedQuote,
        remedy: { choice: "keep", confidence: 0.9, probabilities: { keep: 0.9 } },
      }),
      unit({
        id: "s1-p2",
        quote: hotspotQuote,
        scores: { ...unit().scores, convolution: scoreAnswer(1.8) },
      }),
    ]
    const previous = readabilityReportSchema.parse({
      round: 0,
      try: 0,
      model: "jev-latest",
      passed: false,
      thresholds: DEFAULT_READABILITY_THRESHOLDS,
      units: previousUnits,
      hotspots: deriveHotspots(previousUnits, DEFAULT_READABILITY_THRESHOLDS),
    })
    const seen: string[] = []
    const inner = mockSystemOne(0.2)!
    const { report, raw } = await scoreDraftReadability({
      units: [
        { id: "s1-p1", section: "Intro", quote: passedQuote, before: "", after: rewritten },
        { id: "s1-p2", section: "Intro", quote: rewritten, before: passedQuote, after: "" },
      ],
      context: { articleJob: "Explain framing", reader: { familiar: [], unfamiliar: [] } },
      model: "jev-latest",
      thresholds: DEFAULT_READABILITY_THRESHOLDS,
      systemOne: async (request) => {
        seen.push(String(request.state.unit))
        return inner(request)
      },
      round: 0,
      tryIndex: 1,
      previous,
    })
    expect(seen).toEqual([rewritten])
    expect(raw).toHaveLength(1)
    expect(report.units[0]?.cached).toBe(true)
    expect(report.units[0]?.quote).toBe(passedQuote)
    expect(report.units[0]?.id).toBe("s1-p1")
    expect(report.units[1]?.cached).toBeUndefined()
    expect(report.units[1]?.quote).toBe(rewritten)
  })

  test("re-scores a previous hotspot even when the quote did not change", async () => {
    const quote = "Another substantial paragraph that should be scored because it carries a complete idea."
    const previousUnits = [
      unit({
        id: "s1-p1",
        quote,
        scores: { ...unit().scores, convolution: scoreAnswer(1.8) },
      }),
    ]
    const previous = readabilityReportSchema.parse({
      round: 0,
      try: 0,
      model: "jev-latest",
      passed: false,
      thresholds: DEFAULT_READABILITY_THRESHOLDS,
      units: previousUnits,
      hotspots: deriveHotspots(previousUnits, DEFAULT_READABILITY_THRESHOLDS),
    })
    let calls = 0
    const { report } = await scoreDraftReadability({
      units: [{ id: "s1-p1", section: "Intro", quote, before: "", after: "" }],
      context: { articleJob: "Explain framing", reader: { familiar: [], unfamiliar: [] } },
      model: "jev-latest",
      thresholds: DEFAULT_READABILITY_THRESHOLDS,
      systemOne: async (request) => {
        calls += 1
        return mockSystemOne(0.2)!(request)
      },
      round: 0,
      tryIndex: 1,
      previous,
    })
    expect(calls).toBe(1)
    expect(report.units[0]?.cached).toBeUndefined()
    expect(report.passed).toBe(true)
  })

  test("consumes duplicate passed quotes one at a time", async () => {
    const quote = "This opening paragraph is long enough to count as prose for the readability reviewer."
    const previousUnits = [
      unit({
        id: "s1-p1",
        quote,
        remedy: { choice: "keep", confidence: 0.9, probabilities: { keep: 0.9 } },
      }),
    ]
    const previous = readabilityReportSchema.parse({
      round: 0,
      try: 0,
      model: "jev-latest",
      passed: true,
      thresholds: DEFAULT_READABILITY_THRESHOLDS,
      units: previousUnits,
      hotspots: [],
    })
    let calls = 0
    const { report } = await scoreDraftReadability({
      units: [
        { id: "s1-p1", section: "Intro", quote, before: "", after: quote },
        { id: "s1-p2", section: "Intro", quote, before: quote, after: "" },
      ],
      context: { articleJob: "Explain framing", reader: { familiar: [], unfamiliar: [] } },
      model: "jev-latest",
      thresholds: DEFAULT_READABILITY_THRESHOLDS,
      systemOne: async (request) => {
        calls += 1
        return mockSystemOne(0.2)!(request)
      },
      round: 0,
      tryIndex: 1,
      previous,
    })
    expect(calls).toBe(1)
    expect(report.units[0]?.cached).toBe(true)
    expect(report.units[1]?.cached).toBeUndefined()
  })
})

describe("takeUnchangedPassedUnit", () => {
  test("skips hotspot units and already consumed ids", () => {
    const passed = unit({
      id: "s1-p1",
      quote: "same quote",
      remedy: { choice: "keep", confidence: 0.9, probabilities: { keep: 0.9 } },
    })
    const hotspot = unit({
      id: "s1-p2",
      quote: "same quote",
      scores: { ...unit().scores, convolution: scoreAnswer(1.8) },
    })
    const previous: ReadabilityReport = readabilityReportSchema.parse({
      round: 0,
      try: 0,
      model: "jev-latest",
      passed: false,
      units: [hotspot, passed],
      hotspots: deriveHotspots([hotspot, passed], DEFAULT_READABILITY_THRESHOLDS),
    })
    const consumed = new Set<string>()
    expect(takeUnchangedPassedUnit(previous, "same quote", consumed)?.id).toBe("s1-p1")
    expect(takeUnchangedPassedUnit(previous, "same quote", consumed)).toBeUndefined()
  })
})

describe("buildReadabilityQuestions", () => {
  test("names audience on convolution, diction, formality, and the domain-term gate", () => {
    const questions = buildReadabilityQuestions()
    expect(questions.convolution.instructions).toContain("`audience`")
    expect(questions.diction.instructions).toContain("`audience`")
    expect(questions.formality.instructions).toContain("`audience`")
    expect(questions.dictionIsDomainTerm.instructions).toContain("`audience`")
  })
})

describe("scoreReadability graph node", () => {
  async function withDir<T>(fn: (dir: string) => Promise<T>) {
    const dir = await mkdtemp(join(tmpdir(), "qurom-readability-"))
    try {
      return await fn(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  function state(dir: string, overrides: Partial<ResearchState> = {}): ResearchState {
    return {
      requestId: "req-1",
      inputMode: "topic",
      topic: "How framing works",
      round: 0,
      readabilityTry: 0,
      draft: "This opening paragraph is long enough to count as prose for the readability reviewer.\n\nAnother substantial paragraph that should be scored because it carries a complete idea.",
      audits: [],
      activeRebuttals: {},
      currentRebuttalResponsesByFinding: {},
      rebuttalTurnCounts: {},
      rebuttalHistory: [],
      rebuttalResponseHistory: [],
      unresolvedFindings: [],
      approvedAgents: [],
      status: "scoring_readability",
      outputPath: dir,
      ...overrides,
    }
  }

  test("skips the drafter and goes to audits when disabled", async () => {
    await withDir(async (dir) => {
      const config = testRuntimeConfig({
        dataDir: join(dir, "data"),
        quorumOverrides: { readability: { enabled: false } },
      })
      const next = await scoreReadability(config, state(dir))
      expect(next.status).toBe("auditing")
      const report = await Bun.file(join(dir, "readability-round-0-try-0.json")).json() as { skipped?: { reason: string } }
      expect(report.skipped?.reason).toBe("disabled")
    })
  })

  test("skips when there is no API key", async () => {
    await withDir(async (dir) => {
      const config = testRuntimeConfig({
        dataDir: join(dir, "data"),
        quorumOverrides: { readability: { enabled: true } },
      })
      const next = await scoreReadability(config, state(dir))
      expect(next.status).toBe("auditing")
      const report = await Bun.file(join(dir, "readability-round-0-try-0.json")).json() as { skipped?: { reason: string } }
      expect(report.skipped?.reason).toBe("no_api_key")
    })
  })

  test("routes to readability revise when hotspots remain under maxTries", async () => {
    await withDir(async (dir) => {
      const config = testRuntimeConfig({
        dataDir: join(dir, "data"),
        quorumOverrides: { readability: { enabled: true, maxTries: 5 } },
      })
      const next = await scoreReadability(config, state(dir), { systemOne: mockSystemOne(1.9) })
      expect(next.status).toBe("revising_readability")
      expect(routeAfterReadabilityScore(next)).toBe("reviseReadability")
    })
  })

  test("goes to audits on a clean score without calling a drafter", async () => {
    await withDir(async (dir) => {
      const config = testRuntimeConfig({
        dataDir: join(dir, "data"),
        quorumOverrides: { readability: { enabled: true } },
      })
      const next = await scoreReadability(config, state(dir), { systemOne: mockSystemOne(0.2) })
      expect(next.status).toBe("auditing")
      expect(routeAfterReadabilityScore(next)).toBe("runParallelAudits")
    })
  })

  test("fuses to audits after maxTries even with leftover hotspots", async () => {
    await withDir(async (dir) => {
      const config = testRuntimeConfig({
        dataDir: join(dir, "data"),
        quorumOverrides: { readability: { enabled: true, maxTries: 1 } },
      })
      const next = await scoreReadability(config, state(dir, { readabilityTry: 0 }), { systemOne: mockSystemOne(1.9) })
      expect(next.status).toBe("auditing")
      expect(routeAfterReadabilityScore(next)).toBe("runParallelAudits")
      const report = await Bun.file(join(dir, "readability-round-0-try-0.json")).json() as {
        passed: boolean
        fused?: boolean
        hotspots: unknown[]
      }
      expect(report.passed).toBe(false)
      expect(report.fused).toBe(true)
      expect(report.hotspots.length).toBeGreaterThan(0)
    })
  })

  test("passes empty prose (sources-only) without skipping as disabled", async () => {
    await withDir(async (dir) => {
      const config = testRuntimeConfig({
        dataDir: join(dir, "data"),
        quorumOverrides: { readability: { enabled: true } },
      })
      const next = await scoreReadability(config, state(dir, {
        draft: "## Sources\n\nA bibliographic paragraph that is long enough to look like prose but must be skipped.",
      }), { systemOne: mockSystemOne(1.9) })
      expect(next.status).toBe("auditing")
      const report = await Bun.file(join(dir, "readability-round-0-try-0.json")).json() as {
        passed: boolean
        skipped?: unknown
        hotspots: unknown[]
      }
      expect(report.passed).toBe(true)
      expect(report.skipped).toBeUndefined()
      expect(report.hotspots).toEqual([])
    })
  })

  test("fails the node when the TypeSafe call throws", async () => {
    await withDir(async (dir) => {
      const config = testRuntimeConfig({
        dataDir: join(dir, "data"),
        quorumOverrides: { readability: { enabled: true } },
      })
      await expect(scoreReadability(config, state(dir), {
        systemOne: async () => {
          throw new Error("TypeSafe unavailable")
        },
      })).rejects.toThrow("TypeSafe unavailable")
    })
  })

  test("skips Jev for unchanged passed paragraphs from the previous try", async () => {
    await withDir(async (dir) => {
      const passed = "This opening paragraph is long enough to count as prose for the readability reviewer."
      const rewritten = "The framing bit chooses the decoder before any payload is interpreted in this rewrite."
      const previousUnits = [
        unit({
          id: "s1-p1",
          section: "Untitled",
          quote: passed,
          remedy: { choice: "keep", confidence: 0.9, probabilities: { keep: 0.9 } },
        }),
        unit({
          id: "s1-p2",
          section: "Untitled",
          quote: "Another substantial paragraph that should be scored because it carries a complete idea.",
          scores: { ...unit().scores, convolution: scoreAnswer(1.8) },
        }),
      ]
      await Bun.write(join(dir, "readability-round-0-try-0.json"), JSON.stringify({
        round: 0,
        try: 0,
        model: "jev-latest",
        passed: false,
        thresholds: DEFAULT_READABILITY_THRESHOLDS,
        units: previousUnits,
        hotspots: deriveHotspots(previousUnits, DEFAULT_READABILITY_THRESHOLDS),
      }))
      const seen: string[] = []
      const config = testRuntimeConfig({
        dataDir: join(dir, "data"),
        quorumOverrides: { readability: { enabled: true } },
      })
      const next = await scoreReadability(config, state(dir, {
        readabilityTry: 1,
        draft: `${passed}\n\n${rewritten}`,
      }), {
        systemOne: async (request) => {
          seen.push(String(request.state.unit))
          return mockSystemOne(0.2)!(request)
        },
      })
      expect(next.status).toBe("auditing")
      expect(seen).toEqual([rewritten])
      const report = await Bun.file(join(dir, "readability-round-0-try-1.json")).json() as {
        units: Array<{ quote: string; cached?: boolean }>
      }
      expect(report.units[0]?.cached).toBe(true)
      expect(report.units[1]?.cached).toBeUndefined()
    })
  })
})

describe("readability review prompt", () => {
  test("loads the prompt asset and substitutes {readabilityHints}", () => {
    expect(promptAssetFiles.researchDrafterReadabilityRevise).toBe("research-drafter.readability-revise.md")
    expect(AUDITOR_ROLES).not.toContain("readability-auditor")

    const hotspots: ReadabilityHotspot[] = [{
      unitId: "s3-p2",
      section: "Wire format",
      quote: "That which the protocol conceals, the wire format makes inevitable:",
      criterion: "convolution",
      score: 2.1,
      confidence: 0.74,
      remedy: "unnest",
    }]
    const hints = formatReadabilityHints(hotspots)
    const prompt = readabilityReviewPrompt(
      testRuntimeConfig({ dataDir: "/tmp/qurom-readability-prompt" }),
      emptyPromptBundle({
        researchDrafterReadabilityRevise: "Revise the article.\n\n{readabilityHints}\n",
      }),
      {
        requestId: "req-1",
        inputMode: "topic",
        topic: "How framing works",
        round: 0,
        readabilityTry: 0,
        draft: "draft",
        audits: [],
        activeRebuttals: {},
        currentRebuttalResponsesByFinding: {},
        rebuttalTurnCounts: {},
        rebuttalHistory: [],
        rebuttalResponseHistory: [],
        unresolvedFindings: [],
        approvedAgents: [],
        status: "revising_readability",
      },
      hints,
    )
    expect(prompt).toContain("## Readability review")
    expect(prompt).toContain("[s3-p2]")
    expect(prompt).toContain("unnest")
    expect(prompt).not.toContain("{readabilityHints}")
    expect(prompt).not.toContain("auditor")
    expect(prompt).not.toContain("findingId")
  })
})

describe("reviseReadability graph node", () => {
  afterEach(async () => {
    await disposeDrafterWritingSession("req-1")
  })

  async function withDir<T>(fn: (dir: string) => Promise<T>) {
    const dir = await mkdtemp(join(tmpdir(), "qurom-readability-revise-"))
    try {
      return await fn(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  test("skips the drafter when the loaded report has no hotspots", async () => {
    await withDir(async (dir) => {
      await Bun.write(join(dir, "readability-round-0-try-0.json"), JSON.stringify({
        round: 0,
        try: 0,
        model: "jev-latest",
        passed: true,
        units: [],
        hotspots: [],
      }))
      let called = false
      const runtime = {
        createHandle: async () => ({ id: "h1", providerId: "opencode", role: "research-drafter", title: "x" }),
        prompt: async () => {
          called = true
          return { text: "should not run" }
        },
      } as unknown as AgentRuntime
      const next = await reviseReadability(
        testRuntimeConfig({ dataDir: join(dir, "data") }),
        runtime,
        emptyPromptBundle(),
        {
          requestId: "req-1",
          inputMode: "topic",
          topic: "How framing works",
          round: 0,
          readabilityTry: 0,
          draft: "draft",
          audits: [],
          activeRebuttals: {},
          currentRebuttalResponsesByFinding: {},
          rebuttalTurnCounts: {},
          rebuttalHistory: [],
          rebuttalResponseHistory: [],
          unresolvedFindings: [],
          approvedAgents: [],
          status: "revising_readability",
          outputPath: dir,
        },
      )
      expect(called).toBe(false)
      expect(next.status).toBe("auditing")
    })
  })

  test("rewrites the draft from all hotspot hints and returns to scoring", async () => {
    await withDir(async (dir) => {
      const original = "This opening paragraph is long enough to count as prose for the readability reviewer."
      await Bun.write(join(dir, "draft.md"), original)
      await Bun.write(join(dir, "draft-round-0.md"), original)
      await Bun.write(join(dir, "readability-round-0-try-0.json"), JSON.stringify({
        round: 0,
        try: 0,
        model: "jev-latest",
        passed: false,
        units: [],
        hotspots: [{
          unitId: "s1-p1",
          section: "Wire format",
          quote: original,
          criterion: "convolution",
          score: 1.8,
          confidence: 0.74,
          remedy: "unnest",
        }],
      }))
      let promptText = ""
      let outputAction: string | undefined
      const runtime = {
        createHandle: async () => ({ id: "h1", providerId: "opencode", role: "research-drafter", title: "x" }),
        prompt: async (input: { prompt: string; outputFile?: string; outputAction?: string }) => {
          promptText = input.prompt
          outputAction = input.outputAction
          if (input.outputFile) {
            await Bun.write(input.outputFile, "The framing bit chooses the decoder before any payload is interpreted.\n")
          }
          return { text: "OK" }
        },
      } as unknown as AgentRuntime
      const next = await reviseReadability(
        testRuntimeConfig({ dataDir: join(dir, "data") }),
        runtime,
        emptyPromptBundle({
          researchDrafterReadabilityRevise: "Apply notes.\n{readabilityHints}\n",
        }),
        {
          requestId: "req-1",
          inputMode: "topic",
          topic: "How framing works",
          round: 0,
          readabilityTry: 0,
          draft: original,
          audits: [],
          activeRebuttals: {},
          currentRebuttalResponsesByFinding: {},
          rebuttalTurnCounts: {},
          rebuttalHistory: [],
          rebuttalResponseHistory: [],
          unresolvedFindings: [],
          approvedAgents: [],
          status: "revising_readability",
          outputPath: dir,
        },
      )
      expect(promptText).toContain("[s1-p1]")
      expect(promptText).toContain("unnest")
      expect(outputAction).toBe("edit")
      expect(next.status).toBe("scoring_readability")
      expect(next.readabilityTry).toBe(1)
      expect(next.draft).toContain("framing bit")
      expect(await Bun.file(join(dir, "draft-round-0-readability-1.md")).text()).toContain("framing bit")
      expect(await Bun.file(join(dir, "draft-round-0.md")).text()).toContain("framing bit")
    })
  })
})

describe("pickReviewableMarkdownFilename", () => {
  test("prefers final.md, then latest-draft.md, then the highest draft round", () => {
    expect(pickReviewableMarkdownFilename(["final.md", "latest-draft.md", "draft-round-9.md"])).toBe("final.md")
    expect(pickReviewableMarkdownFilename(["latest-draft.md", "draft-round-9.md"])).toBe("latest-draft.md")
    expect(pickReviewableMarkdownFilename(["draft-round-1.md", "draft-round-9.md", "draft-round-2.md"])).toBe("draft-round-9.md")
    expect(pickReviewableMarkdownFilename(["request.json", "reader-profile.json"])).toBeUndefined()
    expect(hasReviewableMarkdown(["draft-round-0.md"])).toBe(true)
    expect(hasReviewableMarkdown(["request.json"])).toBe(false)
  })
})

describe("scoreCompletedRun", () => {
  async function withDir<T>(fn: (dir: string) => Promise<T>) {
    const dir = await mkdtemp(join(tmpdir(), "qurom-posthoc-"))
    try {
      return await fn(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  const article = [
    "This opening paragraph is long enough to count as prose for the readability reviewer.",
    "",
    "Another substantial paragraph that should be scored because it carries a complete idea.",
  ].join("\n")

  test("scores the finished article into sidecar files without rewriting drafts", async () => {
    await withDir(async (dir) => {
      await Bun.write(join(dir, "final.md"), article)
      await Bun.write(join(dir, "draft-round-0.md"), "Original draft that must not change.\n")
      await Bun.write(join(dir, "request.json"), JSON.stringify({ topic: "How framing works" }))
      const config = testRuntimeConfig({
        dataDir: join(dir, "data"),
        quorumOverrides: { readability: { enabled: true } },
      })
      const result = await scoreCompletedRun({
        runDir: dir,
        config,
        systemOne: mockSystemOne(0.2),
      })
      expect(result.sourceFile).toBe("final.md")
      expect(result.report.kind).toBe("posthoc")
      expect(result.report.passed).toBe(true)
      expect(result.report.sourceFile).toBe("final.md")
      expect(result.report.round).toBe(0)
      const report = await Bun.file(join(dir, POSTHOC_REPORT_FILENAME)).json() as { kind: string; sourceFile: string }
      expect(report.kind).toBe("posthoc")
      expect(report.sourceFile).toBe("final.md")
      expect(await Bun.file(join(dir, POSTHOC_RAW_FILENAME)).exists()).toBe(true)
      expect(await Bun.file(join(dir, "final.md")).text()).toBe(article)
      expect(await Bun.file(join(dir, "draft-round-0.md")).text()).toBe("Original draft that must not change.\n")
      expect(await Bun.file(join(dir, "draft-round-0-readability-0.md")).exists()).toBe(false)
    })
  })

  test("fails instead of writing a skipped pass when readability is disabled", async () => {
    await withDir(async (dir) => {
      await Bun.write(join(dir, "final.md"), article)
      const config = testRuntimeConfig({
        dataDir: join(dir, "data"),
        quorumOverrides: { readability: { enabled: false } },
      })
      const error = await scoreCompletedRun({ runDir: dir, config }).catch((err) => err)
      expect(error).toBeInstanceOf(PosthocReviewError)
      expect(error).toMatchObject({ status: 400 })
      expect(String(error)).toContain("disabled")
      expect(await Bun.file(join(dir, POSTHOC_REPORT_FILENAME)).exists()).toBe(false)
    })
  })

  test("fails instead of writing a skipped pass when the API key is missing", async () => {
    await withDir(async (dir) => {
      await Bun.write(join(dir, "final.md"), article)
      const config = testRuntimeConfig({
        dataDir: join(dir, "data"),
        quorumOverrides: { readability: { enabled: true } },
      })
      const error = await scoreCompletedRun({ runDir: dir, config }).catch((err) => err)
      expect(error).toBeInstanceOf(PosthocReviewError)
      expect(error).toMatchObject({ status: 400 })
      expect(String(error)).toContain("TYPESAFE_API_KEY")
      expect(await Bun.file(join(dir, POSTHOC_REPORT_FILENAME)).exists()).toBe(false)
    })
  })

  test("returns 404 when the run has no markdown article", async () => {
    await withDir(async (dir) => {
      await Bun.write(join(dir, "request.json"), JSON.stringify({ topic: "How framing works" }))
      const config = testRuntimeConfig({
        dataDir: join(dir, "data"),
        quorumOverrides: { readability: { enabled: true } },
      })
      const error = await scoreCompletedRun({
        runDir: dir,
        config,
        systemOne: mockSystemOne(0.2),
      }).catch((err) => err)
      expect(error).toBeInstanceOf(PosthocReviewError)
      expect(error).toMatchObject({ status: 404 })
    })
  })

  test("returns 409 when a review is already running", async () => {
    await withDir(async (dir) => {
      await Bun.write(join(dir, "final.md"), article)
      const config = testRuntimeConfig({
        dataDir: join(dir, "data"),
        quorumOverrides: { readability: { enabled: true } },
      })
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      let started!: () => void
      const startedAt = new Promise<void>((resolve) => { started = resolve })
      const hanging = async (request: Parameters<NonNullable<ReadabilityGraphDeps["systemOne"]>>[0]) => {
        started()
        await gate
        return mockSystemOne(0.2)!(request)
      }
      const first = scoreCompletedRun({ runDir: dir, config, systemOne: hanging })
      await startedAt
      const second = await scoreCompletedRun({ runDir: dir, config, systemOne: mockSystemOne(0.2) }).catch((err) => err)
      expect(second).toBeInstanceOf(PosthocReviewError)
      expect(second).toMatchObject({ status: 409 })
      release()
      const result = await first
      expect(result.report.kind).toBe("posthoc")
    })
  })

  test("does not reuse in-run scores when scoring a completed run", async () => {
    await withDir(async (dir) => {
      await Bun.write(join(dir, "final.md"), article)
      const previousUnits = [
        unit({
          id: "s1-p1",
          quote: "This opening paragraph is long enough to count as prose for the readability reviewer.",
          remedy: { choice: "keep", confidence: 0.9, probabilities: { keep: 0.9 } },
        }),
        unit({
          id: "s1-p2",
          quote: "Another substantial paragraph that should be scored because it carries a complete idea.",
          remedy: { choice: "keep", confidence: 0.9, probabilities: { keep: 0.9 } },
        }),
      ]
      await Bun.write(join(dir, "readability-round-0-try-0.json"), JSON.stringify({
        round: 0,
        try: 0,
        model: "jev-latest",
        passed: true,
        thresholds: DEFAULT_READABILITY_THRESHOLDS,
        units: previousUnits,
        hotspots: [],
      }))
      let calls = 0
      const config = testRuntimeConfig({
        dataDir: join(dir, "data"),
        quorumOverrides: { readability: { enabled: true } },
      })
      await scoreCompletedRun({
        runDir: dir,
        config,
        systemOne: async (request) => {
          calls += 1
          return mockSystemOne(0.2)!(request)
        },
      })
      expect(calls).toBe(2)
    })
  })
})
