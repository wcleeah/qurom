import { describe, expect, test } from "bun:test"

import {
  foldCursorUsage,
  foldOpencodeTokens,
  sumUsage,
  usageDelta,
} from "../src/usage.ts"
import {
  nodeHistoryTotalsForNode,
  renderRunTelemetryStrip,
  resolveRunUsage,
} from "../src/view/telemetry-view.ts"

describe("usage folding", () => {
  test("folds opencode cache tokens into tokens in", () => {
    expect(foldOpencodeTokens({
      input: 100,
      output: 40,
      cache: { read: 20, write: 5 },
    })).toEqual({ tokensIn: 125, tokensOut: 40 })
  })

  test("folds cursor cache tokens into tokens in", () => {
    expect(foldCursorUsage({
      inputTokens: 200,
      outputTokens: 80,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
    })).toEqual({ tokensIn: 240, tokensOut: 80 })
  })

  test("computes usage deltas for cumulative updates", () => {
    expect(usageDelta({ tokensIn: 100, tokensOut: 20 }, { tokensIn: 150, tokensOut: 35 }))
      .toEqual({ tokensIn: 50, tokensOut: 15 })
  })

  test("sums usage across node history entries", () => {
    expect(sumUsage([
      { tokensIn: 100, tokensOut: 10 },
      { tokensIn: 50, tokensOut: 5 },
    ])).toEqual({ tokensIn: 150, tokensOut: 15 })
  })
})

describe("telemetry view", () => {
  test("aggregates node history totals by node aliases", () => {
    const totals = nodeHistoryTotalsForNode([
      {
        node: "runParallelAudits",
        startedAt: 1,
        completedAt: 4001,
        status: "completed",
        round: 0,
        durationMs: 4000,
        usageAvailable: true,
        usage: { tokensIn: 1000, tokensOut: 100 },
        usageByAgent: {
          "source-auditor": { tokensIn: 600, tokensOut: 60, usageAvailable: true },
          methodologist: { tokensIn: 400, tokensOut: 40, usageAvailable: true },
        },
      },
    ], "runParallelAudits")

    expect(totals.durationMs).toBe(4000)
    expect(totals.usage).toEqual({ tokensIn: 1000, tokensOut: 100 })
    expect(Object.keys(totals.usageByAgent)).toEqual(["source-auditor", "methodologist"])
  })

  test("renders run telemetry strip with elapsed and tokens", () => {
    const html = renderRunTelemetryStrip({
      phase: "running",
      runStartedAt: Date.now() - 65_000,
      round: 1,
      maxRounds: 3,
      usage: { tokensIn: 1200, tokensOut: 300 },
      usageAvailable: true,
      nodeUsage: { tokensIn: 0, tokensOut: 0 },
      nodeUsageAvailable: false,
      nodeUsageByAgent: {},
      agents: {},
      nodeHistory: [],
    }, [])

    expect(html).toContain("telemetry-strip")
    expect(html).toContain("elapsed")
    expect(html).toContain("1.2k in / 300 out")
  })

  test("resolveRunUsage falls back to node history", () => {
    const resolved = resolveRunUsage(null, [
      {
        node: "draftFullDraft",
        startedAt: 1,
        completedAt: 2,
        status: "completed",
        round: 0,
        usageAvailable: true,
        usage: { tokensIn: 500, tokensOut: 50 },
      },
    ])
    expect(resolved.usageAvailable).toBe(true)
    expect(resolved.usage).toEqual({ tokensIn: 500, tokensOut: 50 })
  })
})
