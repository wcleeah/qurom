import { describe, expect, test } from "bun:test"

import { estimateCursorCostUsd, resolveCursorPricingModelId } from "../src/cursor-pricing.ts"
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
  nodeHistoryEntriesForNodeScope,
  nodeHistoryTotalsForNode,
  renderNodeSessionUsageTable,
  renderRunTelemetryStrip,
  renderSessionTelemetryTable,
  resolveRunTelemetry,
  resolveRunUsage,
  sessionTotalsForNodeRound,
  sessionsForNodeScope,
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

  test("estimates auto pool cost from raw token buckets", () => {
    const result = estimateCursorCostUsd("auto", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    expect(result.costAvailable).toBe(true)
    expect(result.costEstimated).toBe(true)
    expect(result.costUsd).toBeCloseTo(1.25)
  })

  test("maps default and composite csv slugs to pricing entries", () => {
    expect(resolveCursorPricingModelId("default")).toBe("auto")
    expect(resolveCursorPricingModelId("gpt-5.5-low")).toBe("gpt-5.5")
  })
})

describe("telemetry view", () => {
  test("aggregates session telemetry totals by node aliases", () => {
    const totals = nodeHistoryTotalsForNode([
      {
        node: "runParallelAudits",
        startedAt: 1,
        completedAt: 4001,
        status: "completed",
        round: 0,
        durationMs: 4000,
      },
    ], "runParallelAudits", {
      version: 1,
      sessions: [
        {
          sessionId: "ses-a",
          role: "source-auditor",
          provider: "opencode",
          node: "runParallelAudits",
          calls: [{
            completedAt: new Date(2000).toISOString(),
            usage: {
              tokensIn: 600,
              tokensOut: 60,
              costUsd: 0.07,
              costAvailable: true,
            },
            usageSource: "sdk",
          }],
        },
        {
          sessionId: "ses-b",
          role: "methodologist",
          provider: "opencode",
          node: "runParallelAudits",
          calls: [{
            completedAt: new Date(3000).toISOString(),
            usage: {
              tokensIn: 400,
              tokensOut: 40,
              costUsd: 0.05,
              costAvailable: true,
            },
            usageSource: "sdk",
          }],
        },
      ],
    })

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
      agents: {},
      nodeHistory: [],
    }, [], undefined, {
      version: 1,
      sessions: [{
        sessionId: "ses-1",
        role: "research-drafter",
        provider: "opencode",
        calls: [{
          usage: {
            tokensIn: 1200,
            tokensOut: 300,
            costUsd: 0.042,
            costAvailable: true,
            costEstimated: true,
          },
          usageSource: "sdk",
        }],
      }],
    })

    expect(html).toContain("telemetry-strip")
    expect(html).toContain("elapsed")
    expect(html).toContain("1.2k in / 300 out")
    expect(html).toContain("~$0.042 est.")
  })

  test("renders file count and total size in telemetry strip", () => {
    const html = renderRunTelemetryStrip(null, [], {
      fileCount: 12,
      totalBytes: 1_500_000,
    })

    expect(html).toContain("telemetry-strip")
    expect(html).toContain("12 files")
    expect(html).toContain("1.4 MB")
  })

  test("resolveRunTelemetry reads session telemetry only", () => {
    const resolved = resolveRunTelemetry({
      version: 1,
      sessions: [{
        sessionId: "ses-1",
        role: "research-drafter",
        provider: "opencode",
        calls: [{
          usage: {
            tokensIn: 500,
            tokensOut: 50,
            costUsd: 0.01,
            costAvailable: true,
            costEstimated: false,
          },
          usageSource: "sdk",
        }],
      }],
    })
    expect(resolved.usageAvailable).toBe(true)
    expect(resolved.costAvailable).toBe(true)
    expect(resolved.usage.tokensIn).toBe(500)
    expect(resolved.usage.costUsd).toBeCloseTo(0.01)
  })

  test("resolveRunUsage remains compatible", () => {
    const resolved = resolveRunUsage(null, [], {
      version: 1,
      sessions: [{
        sessionId: "ses-1",
        role: "research-drafter",
        provider: "opencode",
        calls: [{
          usage: { tokensIn: 500, tokensOut: 50 },
          usageSource: "sdk",
        }],
      }],
    })
    expect(resolved.usageAvailable).toBe(true)
    expect(resolved.usage.tokensIn).toBe(500)
  })

  test("renderSessionTelemetryTable sorts sessions by latest activity descending", () => {
    const html = renderSessionTelemetryTable({
      version: 1,
      sessions: [
        {
          sessionId: "ses-old",
          role: "source-auditor",
          provider: "opencode",
          createdAt: "2026-07-04T10:00:00.000Z",
          calls: [{
            completedAt: "2026-07-04T10:00:00.000Z",
            usage: { tokensIn: 100, tokensOut: 10 },
            usageSource: "sdk",
          }],
        },
        {
          sessionId: "ses-new",
          role: "methodologist",
          provider: "opencode",
          createdAt: "2026-07-04T12:00:00.000Z",
          calls: [{
            completedAt: "2026-07-04T12:00:00.000Z",
            usage: { tokensIn: 200, tokensOut: 20 },
            usageSource: "sdk",
          }],
        },
      ],
    })

    expect(html).toContain("Session model telemetry")
    expect(html.indexOf("methodologist")).toBeLessThan(html.indexOf("source-auditor"))
    expect(html).toContain("2026-07-04 12:00:00 UTC")
    expect(html).toContain("2026-07-04 10:00:00 UTC")
  })

  test("sessionTotalsForNodeRound scopes usage to a single research round", () => {
    const totals = sessionTotalsForNodeRound({
      version: 1,
      sessions: [
        {
          sessionId: "ses-r0",
          role: "source-auditor",
          provider: "opencode",
          node: "runParallelAudits",
          round: 0,
          calls: [{
            completedAt: new Date(500).toISOString(),
            usage: { tokensIn: 100, tokensOut: 10, costUsd: 0.01, costAvailable: true },
            usageSource: "sdk",
          }],
        },
        {
          sessionId: "ses-r1",
          role: "methodologist",
          provider: "opencode",
          node: "runParallelAudits",
          round: 1,
          calls: [{
            completedAt: new Date(3000).toISOString(),
            usage: { tokensIn: 400, tokensOut: 40, costUsd: 0.04, costAvailable: true },
            usageSource: "sdk",
          }],
        },
      ],
    }, [
      {
        node: "runParallelAudits",
        startedAt: 1,
        completedAt: 1000,
        status: "completed",
        round: 0,
        durationMs: 999,
      },
      {
        node: "runParallelAudits",
        startedAt: 2000,
        completedAt: 4000,
        status: "completed",
        round: 1,
        durationMs: 2000,
      },
    ], "runParallelAudits", 1)

    expect(totals.durationMs).toBe(2000)
    expect(totals.usage.tokensIn).toBe(400)
    expect(Object.keys(totals.usageByAgent)).toEqual(["methodologist"])
  })

  test("renderNodeSessionUsageTable includes model and parameters for scoped sessions", () => {
    const html = renderNodeSessionUsageTable({
      version: 1,
      sessions: [
        {
          sessionId: "ses-r0",
          role: "source-auditor",
          provider: "opencode",
          node: "runParallelAudits",
          round: 0,
          modelParams: [{ id: "temperature", value: "0.2" }],
          calls: [{
            completedAt: new Date(500).toISOString(),
            resolvedModel: "gpt-5.5-medium",
            usage: { tokensIn: 100, tokensOut: 10, costUsd: 0.01, costAvailable: true },
            usageSource: "sdk",
          }],
        },
        {
          sessionId: "ses-r1",
          role: "methodologist",
          provider: "cursor",
          node: "runParallelAudits",
          round: 1,
          calls: [{
            completedAt: new Date(3000).toISOString(),
            resolvedModel: "composer-2.5",
            usage: { tokensIn: 400, tokensOut: 40, costUsd: 0.04, costAvailable: true },
            usageSource: "sdk",
          }],
        },
      ],
    }, [
      {
        node: "runParallelAudits",
        startedAt: 1,
        completedAt: 1000,
        status: "completed",
        round: 0,
        durationMs: 999,
      },
      {
        node: "runParallelAudits",
        startedAt: 2000,
        completedAt: 4000,
        status: "completed",
        round: 1,
        durationMs: 2000,
      },
    ], "runParallelAudits", 1)

    expect(html).toContain("Agent token usage")
    expect(html).toContain("composer-2.5")
    expect(html).toContain("methodologist")
    expect(html).not.toContain("source-auditor")
    expect(html).not.toContain("temperature=0.2")
  })

  test("sessionsForNodeScope filters by node history when session node is missing", () => {
    const scoped = sessionsForNodeScope({
      version: 1,
      sessions: [{
        sessionId: "ses-import",
        role: "source-auditor",
        provider: "cursor",
        modelParams: [{ id: "variant", value: "low" }],
        calls: [{
          completedAt: new Date(500).toISOString(),
          resolvedModel: "gpt-5.5-low",
          usage: { tokensIn: 100, tokensOut: 10 },
          usageSource: "csv-import",
        }],
      }],
    }, [{
      node: "runParallelAudits",
      startedAt: 1,
      completedAt: 1000,
      status: "completed",
      round: 0,
      durationMs: 999,
    }], "runParallelAudits")

    expect(scoped).toHaveLength(1)
    expect(scoped[0]?.calls[0]?.resolvedModel).toBe("gpt-5.5-low")
  })

  test("sessionTotalsForNodeRound attributes calls by node-history timing, not stale session round", () => {
    const nodeHistory = [
      {
        node: "runParallelAudits",
        startedAt: 1,
        completedAt: 1000,
        status: "completed" as const,
        round: 0,
        durationMs: 999,
      },
      {
        node: "runParallelAudits",
        startedAt: 2000,
        completedAt: 4000,
        status: "completed" as const,
        round: 2,
        durationMs: 2000,
      },
    ]
    const sessionTelemetry = {
      version: 1 as const,
      sessions: [{
        sessionId: "ses-auditor",
        role: "source-auditor",
        provider: "opencode",
        node: "runParallelAudits",
        round: 2,
        calls: [
          {
            completedAt: new Date(500).toISOString(),
            usage: { tokensIn: 100, tokensOut: 10, costUsd: 0.01, costAvailable: true },
            usageSource: "sdk" as const,
          },
          {
            completedAt: new Date(3500).toISOString(),
            usage: { tokensIn: 400, tokensOut: 40, costUsd: 0.04, costAvailable: true },
            usageSource: "sdk" as const,
          },
        ],
      }],
    }

    expect(sessionTotalsForNodeRound(sessionTelemetry, nodeHistory, "runParallelAudits", 0).usage.tokensIn).toBe(100)
    expect(sessionTotalsForNodeRound(sessionTelemetry, nodeHistory, "runParallelAudits", 2).usage.tokensIn).toBe(400)
  })

  test("draftFullDraft round tabs follow draft-round-N producers (imported telemetry)", () => {
    const nodeHistory = [
      { node: "draftFullDraft", startedAt: Date.parse("2026-07-04T09:05:21.159Z"), completedAt: Date.parse("2026-07-04T09:07:04.434Z"), status: "completed" as const, round: 0, durationMs: 103275 },
      { node: "reviseDraft", startedAt: Date.parse("2026-07-04T09:10:45.105Z"), completedAt: Date.parse("2026-07-04T09:12:17.723Z"), status: "completed" as const, round: 0, durationMs: 92618 },
      { node: "reviseDraft", startedAt: Date.parse("2026-07-04T09:14:16.686Z"), completedAt: Date.parse("2026-07-04T09:15:11.179Z"), status: "completed" as const, round: 1, durationMs: 54493 },
      { node: "reviseDraft", startedAt: Date.parse("2026-07-04T09:18:17.996Z"), completedAt: Date.parse("2026-07-04T09:19:29.561Z"), status: "completed" as const, round: 2, durationMs: 71565 },
    ]
    const sessionTelemetry = {
      version: 1 as const,
      sessions: [
        { sessionId: "draft-r0", role: "research-drafter", provider: "cursor", calls: [{ completedAt: "2026-07-04T09:05:24.245Z", usage: { tokensIn: 206265, tokensOut: 1 }, usageSource: "csv-import" as const, resolvedModel: "auto" }] },
        { sessionId: "revise-r0", role: "research-drafter", provider: "cursor", calls: [{ completedAt: "2026-07-04T09:10:49.083Z", usage: { tokensIn: 213419, tokensOut: 1 }, usageSource: "csv-import" as const, resolvedModel: "auto" }] },
        { sessionId: "revise-r1", role: "research-drafter", provider: "cursor", calls: [{ completedAt: "2026-07-04T09:14:19.731Z", usage: { tokensIn: 81822, tokensOut: 1 }, usageSource: "csv-import" as const, resolvedModel: "auto" }] },
        { sessionId: "revise-r2", role: "research-drafter", provider: "cursor", calls: [{ completedAt: "2026-07-04T09:18:22.089Z", usage: { tokensIn: 151997, tokensOut: 1 }, usageSource: "csv-import" as const, resolvedModel: "auto" }] },
        { sessionId: "review-r1", role: "research-drafter", provider: "cursor", calls: [{ completedAt: "2026-07-04T09:13:59.909Z", usage: { tokensIn: 49259, tokensOut: 1 }, usageSource: "csv-import" as const, resolvedModel: "auto" }] },
      ],
    }

    expect(nodeHistoryEntriesForNodeScope(nodeHistory, "draftFullDraft", 0).map((e) => e.node)).toEqual(["draftFullDraft"])
    expect(nodeHistoryEntriesForNodeScope(nodeHistory, "draftFullDraft", 1).map((e) => e.node)).toEqual(["reviseDraft"])
    expect(nodeHistoryEntriesForNodeScope(nodeHistory, "draftFullDraft", 2)[0]?.round).toBe(1)

    expect(sessionTotalsForNodeRound(sessionTelemetry, nodeHistory, "draftFullDraft", 0).usage.tokensIn).toBe(206265)
    expect(sessionTotalsForNodeRound(sessionTelemetry, nodeHistory, "draftFullDraft", 1).usage.tokensIn).toBe(213419)
    expect(sessionTotalsForNodeRound(sessionTelemetry, nodeHistory, "draftFullDraft", 2).usage.tokensIn).toBe(81822)
    expect(sessionTotalsForNodeRound(sessionTelemetry, nodeHistory, "draftFullDraft", 3).usage.tokensIn).toBe(151997)
    expect(sessionsForNodeScope(sessionTelemetry, nodeHistory, "draftFullDraft", 1)).toHaveLength(1)
    expect(sessionsForNodeScope(sessionTelemetry, nodeHistory, "draftFullDraft", 1)[0]?.sessionId).toBe("revise-r0")
  })

  test("reviewRebuttalResponses includes auditor rebuttal sessions from runTargetedRebuttals", () => {
    const nodeHistory = [
      {
        node: "runTargetedRebuttals",
        startedAt: Date.parse("2026-07-04T09:10:07.871Z"),
        completedAt: Date.parse("2026-07-04T09:10:45.042Z"),
        status: "completed" as const,
        round: 0,
        rebuttalTurn: 1,
        durationMs: 37171,
      },
      {
        node: "reviewRebuttalResponses",
        startedAt: Date.parse("2026-07-04T09:10:45.053Z"),
        completedAt: Date.parse("2026-07-04T09:10:45.055Z"),
        status: "completed" as const,
        round: 0,
        rebuttalTurn: 1,
        durationMs: 2,
      },
    ]
    const sessionTelemetry = {
      version: 1 as const,
      sessions: [
        {
          sessionId: "auditor-rebuttal",
          role: "source-auditor",
          provider: "cursor",
          calls: [{
            completedAt: "2026-07-04T09:10:11.515Z",
            usage: { tokensIn: 98300, tokensOut: 1600, costUsd: 0.05, costAvailable: true },
            usageSource: "csv-import" as const,
            resolvedModel: "auto",
          }],
        },
        {
          sessionId: "drafter-review",
          role: "research-drafter",
          provider: "cursor",
          calls: [{
            completedAt: "2026-07-04T09:10:50.000Z",
            usage: { tokensIn: 12000, tokensOut: 800, costUsd: 0.01, costAvailable: true },
            usageSource: "csv-import" as const,
            resolvedModel: "auto",
          }],
        },
      ],
    }

    expect(nodeHistoryEntriesForNodeScope(nodeHistory, "reviewRebuttalResponses", 0).map((e) => e.node)).toEqual([
      "runTargetedRebuttals",
      "reviewRebuttalResponses",
    ])
    expect(sessionsForNodeScope(sessionTelemetry, nodeHistory, "reviewRebuttalResponses", 0)).toHaveLength(1)
    expect(sessionsForNodeScope(sessionTelemetry, nodeHistory, "reviewRebuttalResponses", 0)[0]?.role).toBe("source-auditor")
    expect(sessionTotalsForNodeRound(sessionTelemetry, nodeHistory, "reviewRebuttalResponses", 0).usage.tokensIn).toBe(98300)

    const html = renderNodeSessionUsageTable(sessionTelemetry, nodeHistory, "reviewRebuttalResponses", 0)
    expect(html).toContain("Agent token usage")
    expect(html).toContain("source-auditor")
    expect(html).toContain("98.3k in")
  })
})
