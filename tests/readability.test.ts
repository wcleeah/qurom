import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { SystemOneResult } from "@typesafe-ai/sdk"

import type { AgentRuntime } from "../src/agent-runtime/runtime"
import { formatReadabilityHints } from "../src/readability/hints"
import { deriveHotspots, scoreDraftReadability } from "../src/readability/score"
import { segmentDraft } from "../src/readability/segment"
import type { ReadabilityHotspot, ReadabilityUnit } from "../src/readability/schema"
import { DEFAULT_READABILITY_THRESHOLDS, READABILITY_AUDIENCE, READABILITY_REGISTER, buildReadabilityQuestions, type ReadabilityQuestions } from "../src/readability/criteria"
import {
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
      const runtime = {
        createHandle: async () => ({ id: "h1", providerId: "opencode", role: "research-drafter", title: "x" }),
        prompt: async (input: { prompt: string }) => {
          promptText = input.prompt
          return { text: "The framing bit chooses the decoder before any payload is interpreted.\n" }
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
      expect(next.status).toBe("scoring_readability")
      expect(next.readabilityTry).toBe(1)
      expect(next.draft).toContain("framing bit")
      expect(await Bun.file(join(dir, "draft-round-0-readability-1.md")).text()).toContain("framing bit")
      expect(await Bun.file(join(dir, "draft-round-0.md")).text()).toContain("framing bit")
    })
  })
})
