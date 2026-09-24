import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  applyCursorUsageImport,
  matchCursorUsageRows,
  parseCursorUsageCsv,
} from "../src/cursor-usage-import.ts"
import { readSessionTelemetry } from "../src/session-telemetry.ts"

const SAMPLE_CSV = `Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
2026-07-04T09:00:21.892Z,bc-agent-one,,Included,auto,No,1000,2000,3000,400,6400,Included
2026-07-04T09:03:29.408Z,bc-agent-one,,Included,auto,No,1100,2100,3100,500,6800,Included
2026-07-04T09:10:00.000Z,bc-agent-two,,Included,gpt-5.5-low,No,500,600,700,800,2600,Included
`

const QUOTED_SAMPLE_CSV = `Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
"2026-07-04T09:00:21.892Z","bc-agent-one","","Included","auto","No","1000","2000","3000","400","6400","Included"
"2026-07-04T09:03:29.408Z","bc-agent-one","","Included","auto","No","1100","2100","3100","500","6800","Included"
`

describe("parseCursorUsageCsv", () => {
  test("parses rows with cloud agent ids", () => {
    const rows = parseCursorUsageCsv(SAMPLE_CSV)
    expect(rows).toHaveLength(3)
    expect(rows[0]?.agentId).toBe("bc-agent-one")
    expect(rows[0]?.model).toBe("auto")
    expect(rows[0]?.outputTokens).toBe(400)
  })

  test("parses quoted Cursor export rows", () => {
    const rows = parseCursorUsageCsv(QUOTED_SAMPLE_CSV)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.agentId).toBe("bc-agent-one")
    expect(rows[0]?.inputWithoutCacheWrite).toBe(2000)
    expect(rows[0]?.cacheRead).toBe(3000)
    expect(rows[0]?.outputTokens).toBe(400)
    expect(rows[0]?.costLabel).toBe("Included")
  })
})

describe("matchCursorUsageRows", () => {
  test("pairs equal-count agent calls by duration order", () => {
    const rows = parseCursorUsageCsv(SAMPLE_CSV)
    const { matches, unmatchedCalls } = matchCursorUsageRows(rows, [
      {
        runDir: "/tmp/run-a",
        runName: "run-a",
        agentId: "bc-agent-one",
        cursorRunId: "run-short",
        role: "reader-interviewer",
        callIndex: 1,
        durationMs: 1000,
      },
      {
        runDir: "/tmp/run-a",
        runName: "run-a",
        agentId: "bc-agent-one",
        cursorRunId: "run-long",
        role: "reader-interviewer",
        callIndex: 1,
        durationMs: 5000,
      },
      {
        runDir: "/tmp/run-b",
        runName: "run-b",
        agentId: "bc-agent-two",
        cursorRunId: "run-other",
        role: "research-drafter",
        callIndex: 1,
        durationMs: 2000,
      },
    ])

    expect(unmatchedCalls).toHaveLength(0)
    expect(matches).toHaveLength(3)
    expect(matches[0]?.cursorRunId).toBe("run-short")
    expect(matches[0]?.tokensOut).toBe(400)
    expect(matches[0]?.costEstimated).toBe(true)
    expect(matches[0]?.costAvailable).toBe(true)
    expect(matches[1]?.cursorRunId).toBe("run-long")
    expect(matches[1]?.tokensOut).toBe(500)
    expect(matches[2]?.model).toBe("gpt-5.5-low")
  })

  test("pairs keep-alive calls by completion time instead of duration", () => {
    const csv = `Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
2026-09-24T04:11:26.000Z,bc-drafter,,Included,claude-opus-5-5-high,No,100,10,200,50,360,Included
2026-09-24T04:22:37.000Z,bc-drafter,,Included,claude-opus-5-5-high,No,20,2,40,5,67,Included
`
    const { matches } = matchCursorUsageRows(parseCursorUsageCsv(csv), [
      {
        runDir: "/tmp/run-a",
        runName: "run-a",
        agentId: "bc-drafter",
        cursorRunId: "run-draft",
        role: "research-drafter",
        artifact: "draft.md",
        callIndex: 1,
        durationMs: 600_000,
        completedAtMs: Date.parse("2026-09-24T04:22:32.000Z"),
      },
      {
        runDir: "/tmp/run-a",
        runName: "run-a",
        agentId: "bc-drafter",
        cursorRunId: "run-readability",
        role: "research-drafter",
        artifact: "draft.md",
        callIndex: 2,
        durationMs: 40_000,
        completedAtMs: Date.parse("2026-09-24T04:24:01.000Z"),
      },
    ])

    expect(matches).toHaveLength(2)
    expect(matches[0]?.cursorRunId).toBe("run-draft")
    expect(matches[0]?.tokensOut).toBe(50)
    expect(matches[1]?.cursorRunId).toBe("run-readability")
    expect(matches[1]?.tokensOut).toBe(5)
  })

  test("still matches when CSV has extra rows for the same agent", () => {
    const rows = parseCursorUsageCsv(SAMPLE_CSV).filter((row) => row.agentId === "bc-agent-one")
    const { matches, unmatchedCalls } = matchCursorUsageRows(rows, [
      {
        runDir: "/tmp/run-a",
        runName: "run-a",
        agentId: "bc-agent-one",
        cursorRunId: "run-only",
        role: "reader-interviewer",
        callIndex: 1,
        durationMs: 1000,
      },
    ])

    expect(matches).toHaveLength(1)
    expect(matches[0]?.cursorRunId).toBe("run-only")
    expect(unmatchedCalls).toHaveLength(0)
  })

  test("leaves extra finished calls unmatched", () => {
    const rows = parseCursorUsageCsv(SAMPLE_CSV).filter((row) => row.agentId === "bc-agent-two")
    const { matches, unmatchedCalls } = matchCursorUsageRows(rows, [
      {
        runDir: "/tmp/run-a",
        runName: "run-a",
        agentId: "bc-agent-two",
        cursorRunId: "run-one",
        role: "research-drafter",
        callIndex: 1,
        durationMs: 1000,
      },
      {
        runDir: "/tmp/run-a",
        runName: "run-a",
        agentId: "bc-agent-two",
        cursorRunId: "run-two",
        role: "research-drafter",
        callIndex: 2,
        durationMs: 2000,
      },
    ])

    expect(matches).toHaveLength(1)
    expect(unmatchedCalls.map((call) => call.cursorRunId)).toEqual(["run-two"])
  })

  test("ignores empty Free CSV rows when pairing", () => {
    const csv = `Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
2026-09-24T04:11:26.000Z,bc-agent-two,,Included,gpt-5.5-low,No,,,,,0,Free
2026-07-04T09:10:00.000Z,bc-agent-two,,Included,gpt-5.5-low,No,500,600,700,800,2600,Included
`
    const { matches, unmatchedCalls } = matchCursorUsageRows(parseCursorUsageCsv(csv), [
      {
        runDir: "/tmp/run-b",
        runName: "run-b",
        agentId: "bc-agent-two",
        cursorRunId: "run-other",
        role: "research-drafter",
        callIndex: 1,
        durationMs: 2000,
      },
    ])
    expect(unmatchedCalls).toHaveLength(0)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.tokensOut).toBe(800)
  })

  test("maps draft.md keep-alive calls from node history", () => {
    const csv = `Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
2026-09-24T04:11:26.000Z,bc-drafter,,Included,claude-opus-5-5-high,No,100,10,200,50,360,Included
`
    const runDir = "/tmp/run-a"
    const { matches } = matchCursorUsageRows(parseCursorUsageCsv(csv), [
      {
        runDir,
        runName: "run-a",
        agentId: "bc-drafter",
        cursorRunId: "run-draft",
        role: "research-drafter",
        artifact: "draft.md",
        callIndex: 1,
        durationMs: 600_000,
        completedAtMs: Date.parse("2026-09-24T04:22:32.000Z"),
      },
    ], {
      nodeHistoryByRunDir: new Map([[runDir, [
        {
          node: "draftFullDraft",
          round: 0,
          startedAt: Date.parse("2026-09-24T04:11:25.000Z"),
          completedAt: Date.parse("2026-09-24T04:22:33.000Z"),
          durationMs: 668_000,
        },
      ]]]),
    })

    expect(matches[0]?.node).toBe("draftFullDraft")
    expect(matches[0]?.round).toBe(0)
  })
})

describe("applyCursorUsageImport", () => {
  test("writes import overlay and session telemetry for a run", async () => {
    const root = await mkdtemp(join(tmpdir(), "quorum-import-"))
    const runDir = join(root, "sample-run")
    await mkdir(runDir, { recursive: true })

    await writeFile(join(runDir, "cursor-reader-interviewer-call-1-attempt-1-run-abc-metadata.json"), JSON.stringify({
      agentId: "bc-agent-two",
      runId: "run-abc",
      role: "reader-interviewer",
      callIndex: 1,
      requestedArtifact: "reader-profile-0.json",
    }))
    await writeFile(join(runDir, "cursor-reader-interviewer-call-1-attempt-1-run-abc-result.json"), JSON.stringify({
      durationMs: 2000,
      model: { id: "default" },
    }))

    const rows = parseCursorUsageCsv(SAMPLE_CSV).filter((row) => row.agentId === "bc-agent-two")
    const summary = await applyCursorUsageImport({
      runsDir: root,
      rows,
      sourceFile: "usage.csv",
      totalCsvRows: 3,
    })

    expect(summary.matchedCalls).toBe(1)
    expect(summary.runsUpdated).toBe(1)

    const sessionTelemetry = await readSessionTelemetry(runDir)
    expect(sessionTelemetry.sessions).toHaveLength(1)
    expect(sessionTelemetry.sessions[0]?.calls[0]?.resolvedModel).toBe("gpt-5.5-low")
    expect(sessionTelemetry.sessions[0]?.calls[0]?.usage?.tokensOut).toBe(800)
    expect(sessionTelemetry.sessions[0]?.calls[0]?.usage?.tokensIn).toBe(600)
    expect(sessionTelemetry.sessions[0]?.calls[0]?.usage?.cacheReadTokens).toBe(700)
    expect(sessionTelemetry.sessions[0]?.calls[0]?.usage?.cacheWriteTokens).toBe(500)
    expect(sessionTelemetry.sessions[0]?.calls[0]?.usage?.costEstimated).toBe(true)
    expect(sessionTelemetry.sessions[0]?.calls[0]?.usage?.costAvailable).toBe(true)
    expect(sessionTelemetry.sessions[0]?.calls[0]?.usageSource).toBe("csv-import")
    expect(sessionTelemetry.sessions[0]?.node).toBe("discoverReader")
    expect(sessionTelemetry.sessions[0]?.round).toBe(0)
  })

  test("skips failed retry metadata so the finished call still maps", async () => {
    const root = await mkdtemp(join(tmpdir(), "quorum-import-"))
    const runDir = join(root, "retry-run")
    await mkdir(runDir, { recursive: true })

    await writeFile(join(runDir, "cursor-logic-auditor-call-1-attempt-1-run-err-metadata.json"), JSON.stringify({
      agentId: "bc-logic",
      runId: "run-err",
      role: "logic-auditor",
      callIndex: 1,
      requestedArtifact: "audit-logic-auditor-round-1.json",
      completedAt: "2026-09-24T04:42:14.000Z",
    }))
    await writeFile(join(runDir, "cursor-logic-auditor-call-1-attempt-1-run-err-result.json"), JSON.stringify({
      status: "error",
      durationMs: 2000,
    }))
    await writeFile(join(runDir, "cursor-logic-auditor-call-1-attempt-2-run-ok-metadata.json"), JSON.stringify({
      agentId: "bc-logic",
      runId: "run-ok",
      role: "logic-auditor",
      callIndex: 1,
      requestedArtifact: "audit-logic-auditor-round-1.json",
      completedAt: "2026-09-24T04:43:19.000Z",
    }))
    await writeFile(join(runDir, "cursor-logic-auditor-call-1-attempt-2-run-ok-result.json"), JSON.stringify({
      status: "finished",
      durationMs: 59563,
    }))

    const csv = `Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
2026-09-24T04:42:17.000Z,bc-logic,,Included,gpt-5.6-sol-medium,No,40000,6,37000,3300,80306,Included
`
    const summary = await applyCursorUsageImport({
      runsDir: root,
      rows: parseCursorUsageCsv(csv),
      sourceFile: "usage.csv",
    })

    expect(summary.matchedCalls).toBe(1)
    expect(summary.unmatchedCalls).toBe(0)
    const sessionTelemetry = await readSessionTelemetry(runDir)
    expect(sessionTelemetry.sessions[0]?.calls).toHaveLength(1)
    expect(sessionTelemetry.sessions[0]?.calls[0]?.cursorRunId).toBe("run-ok")
    expect(sessionTelemetry.sessions[0]?.calls[0]?.usage?.tokensOut).toBe(3300)
    expect(sessionTelemetry.sessions[0]?.calls[0]?.completedAt).toBe("2026-09-24T04:43:19.000Z")
    expect(sessionTelemetry.sessions[0]?.node).toBe("runParallelAudits")
  })

  test("reimport updates node and round on existing sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "quorum-import-"))
    const runDir = join(root, "design-run")
    await mkdir(runDir, { recursive: true })

    await writeFile(join(runDir, "cursor-html-designer-call-1-attempt-1-run-abc-metadata.json"), JSON.stringify({
      agentId: "bc-designer",
      runId: "run-abc",
      role: "html-designer",
      callIndex: 1,
      requestedArtifact: "design-html-round-0.html",
    }))
    await writeFile(join(runDir, "cursor-html-designer-call-1-attempt-1-run-abc-result.json"), JSON.stringify({
      durationMs: 1000,
    }))

    const csv = `Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
2026-07-04T09:10:00.000Z,bc-designer,,Included,auto,No,1000,2000,3000,400,6400,$1.23
`
    const rows = parseCursorUsageCsv(csv)

    await applyCursorUsageImport({ runsDir: root, rows, sourceFile: "usage.csv" })
    const first = await readSessionTelemetry(runDir)
    expect(first.sessions[0]?.node).toBe("runDesignHtml")
    expect(first.sessions[0]?.round).toBe(0)

    await applyCursorUsageImport({ runsDir: root, rows, sourceFile: "usage-again.csv" })
    const second = await readSessionTelemetry(runDir)
    expect(second.sessions[0]?.node).toBe("runDesignHtml")
    expect(second.sessions[0]?.round).toBe(0)
    expect(second.sessions[0]?.calls[0]?.usage?.costUsd).toBeCloseTo(1.23)
  })
})
