import { describe, expect, test } from "bun:test"

import { estimateCursorCostUsd } from "../src/cursor-pricing.ts"
import {
  addUsage,
  emptyUsage,
  foldCursorUsage,
  foldOpencodeTokens,
  hasCost,
  sumUsage,
  usageDelta,
} from "../src/usage.ts"
import {
  nodeHistoryTotalsForNode,
  renderRunTelemetryStrip,
  resolveRunTelemetry,
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

  test("computes cost deltas for cumulative updates", () => {
    const delta = usageDelta(
      { tokensIn: 0, tokensOut: 0, costUsd: 0.01, costAvailable: true },
      { tokensIn: 0, tokensOut: 0, costUsd: 0.045, costAvailable: true, costEstimated: true },
    )
    expect(delta.tokensIn).toBe(0)
    expect(delta.tokensOut).toBe(0)
    expect(delta.costAvailable).toBe(true)
    expect(delta.costEstimated).toBe(true)
    expect(delta.costUsd).toBeCloseTo(0.035)
  })

  test("addUsage sums cost when available", () => {
    const total = emptyUsage()
    addUsage(total, { tokensIn: 100, tokensOut: 10, costUsd: 0.02, costAvailable: true, costEstimated: true })
    addUsage(total, { tokensIn: 50, tokensOut: 5, costUsd: 0.01, costAvailable: true })
    expect(total.tokensIn).toBe(150)
    expect(total.costUsd).toBeCloseTo(0.03)
    expect(total.costAvailable).toBe(true)
    expect(total.costEstimated).toBe(true)
    expect(hasCost(total)).toBe(true)
  })

  test("sums usage across node history entries", () => {
    expect(sumUsage([
      { tokensIn: 100, tokensOut: 10 },
      { tokensIn: 50, tokensOut: 5 },
    ])).toEqual({ tokensIn: 150, tokensOut: 15, costUsd: 0, costAvailable: false })
  })
})

describe("cursor pricing", () => {
  test("estimates composer-2.5 cost from raw token buckets", () => {
    const result = estimateCursorCostUsd("composer-2.5", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    expect(result.costAvailable).toBe(true)
    expect(result.costEstimated).toBe(true)
    expect(result.costUsd).toBeCloseTo(0.5)
  })

  test("returns unavailable for unknown model ids", () => {
    expect(estimateCursorCostUsd("unknown-model", { inputTokens: 1000 })).toEqual({
      costUsd: 0,
      costAvailable: false,
      costEstimated: true,
    })
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
        usage: {
          tokensIn: 1000,
          tokensOut: 100,
          costUsd: 0.12,
          costAvailable: true,
        },
        usageByAgent: {
          "source-auditor": {
            tokensIn: 600,
            tokensOut: 60,
            costUsd: 0.07,
            costAvailable: true,
            usageAvailable: true,
          },
          methodologist: {
            tokensIn: 400,
            tokensOut: 40,
            costUsd: 0.05,
            costAvailable: true,
            usageAvailable: true,
          },
        },
      },
    ], "runParallelAudits")

    expect(totals.durationMs).toBe(4000)
    expect(totals.usage.tokensIn).toBe(1000)
    expect(totals.usage.tokensOut).toBe(100)
    expect(totals.costAvailable).toBe(true)
    expect(totals.usage.costUsd).toBeCloseTo(0.12)
    expect(Object.keys(totals.usageByAgent)).toEqual(["source-auditor", "methodologist"])
  })

  test("renders run telemetry strip with elapsed, tokens, and cost", () => {
    const html = renderRunTelemetryStrip({
      phase: "running",
      runStartedAt: Date.now() - 65_000,
      round: 1,
      maxRounds: 3,
      usage: {
        tokensIn: 1200,
        tokensOut: 300,
        costUsd: 0.042,
        costAvailable: true,
        costEstimated: true,
      },
      usageAvailable: true,
      nodeUsage: emptyUsage(),
      nodeUsageAvailable: false,
      nodeUsageByAgent: {},
      agents: {},
      nodeHistory: [],
    }, [])

    expect(html).toContain("telemetry-strip")
    expect(html).toContain("elapsed")
    expect(html).toContain("1.2k in / 300 out")
    expect(html).toContain("~$0.042 est.")
  })

  test("resolveRunTelemetry falls back to node history", () => {
    const resolved = resolveRunTelemetry(null, [
      {
        node: "draftFullDraft",
        startedAt: 1,
        completedAt: 2,
        status: "completed",
        round: 0,
        usageAvailable: true,
        usage: {
          tokensIn: 500,
          tokensOut: 50,
          costUsd: 0.01,
          costAvailable: true,
          costEstimated: false,
        },
      },
    ])
    expect(resolved.usageAvailable).toBe(true)
    expect(resolved.costAvailable).toBe(true)
    expect(resolved.usage.tokensIn).toBe(500)
    expect(resolved.usage.costUsd).toBeCloseTo(0.01)
  })

  test("resolveRunUsage remains compatible", () => {
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
    expect(resolved.usage.tokensIn).toBe(500)
  })
})
