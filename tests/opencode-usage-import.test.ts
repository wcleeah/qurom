import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  applyOpenCodeUsageImport,
  fetchOpenCodeSessionUsage,
  isOpenCodeDbConfigured,
  parseDebugLogOpenCodeSessions,
  sessionNeedsBackfill,
} from "../src/opencode-usage-import.ts"
import { readSessionTelemetry, SESSION_TELEMETRY_FILENAME } from "../src/session-telemetry.ts"
import { foldOpencodeTokens } from "../src/usage.ts"

function createTestOpenCodeDb(dbPath: string, rows: Array<{ sessionId: string; data: Record<string, unknown> }>) {
  const db = new Database(dbPath, { create: true })
  db.run(`
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    )
  `)
  for (const [index, row] of rows.entries()) {
    db.run(
      "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
      [`msg-${index}`, row.sessionId, 1_700_000_000_000, 1_700_000_000_000, JSON.stringify(row.data)],
    )
  }
  db.close()
}

describe("isOpenCodeDbConfigured", () => {
  test("returns false when database file is missing", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "opencode-db-missing-"))
    const dbPath = join(runsDir, "missing-opencode.db")
    expect(isOpenCodeDbConfigured(dbPath)).toBe(false)
  })

  test("returns true when database file exists", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "opencode-db-present-"))
    const dbPath = join(runsDir, "opencode.db")
    createTestOpenCodeDb(dbPath, [])
    expect(isOpenCodeDbConfigured(dbPath)).toBe(true)
  })
})

describe("sessionNeedsBackfill", () => {
  test("targets opencode sessions with missing or zero usage", () => {
    expect(
      sessionNeedsBackfill({
        sessionId: "ses-1",
        role: "research-drafter",
        provider: "opencode",
        calls: [],
      }),
    ).toBe(true)

    expect(
      sessionNeedsBackfill({
        sessionId: "ses-2",
        role: "research-drafter",
        provider: "opencode",
        calls: [{ usage: { tokensIn: 0, tokensOut: 0 } }],
      }),
    ).toBe(true)

    expect(
      sessionNeedsBackfill({
        sessionId: "ses-3",
        role: "research-drafter",
        provider: "opencode",
        calls: [{ usage: { tokensIn: 10, tokensOut: 5 } }],
      }),
    ).toBe(false)

    expect(
      sessionNeedsBackfill({
        sessionId: "ses-4",
        role: "research-drafter",
        provider: "cursor",
        calls: [],
      }),
    ).toBe(false)
  })
})

describe("fetchOpenCodeSessionUsage", () => {
  test("folds cache tokens into tokensIn", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "opencode-fetch-"))
    const dbPath = join(runsDir, "opencode.db")
    createTestOpenCodeDb(dbPath, [
      {
        sessionId: "ses-fold",
        data: {
          role: "assistant",
          agent: "research-drafter",
          modelID: "claude-sonnet-4",
          providerID: "anthropic",
          cost: 0.42,
          tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 300, write: 50 } },
          time: { created: 1_700_000_000_000, completed: 1_700_000_001_200 },
        },
      },
    ])

    const db = new Database(dbPath, { readonly: true })
    const usage = fetchOpenCodeSessionUsage(db, ["ses-fold"])
    db.close()

    const row = usage.get("ses-fold")
    expect(row?.tokensIn).toBe(
      foldOpencodeTokens({ input: 100, output: 20, cache: { read: 300, write: 50 } }).tokensIn,
    )
    expect(row?.tokensOut).toBe(20)
    expect(row?.costAvailable).toBe(true)
    expect(row?.costUsd).toBe(0.42)
  })
})

describe("parseDebugLogOpenCodeSessions", () => {
  test("discovers sessions and stamps node from debug log", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "opencode-debug-"))
    const runDir = join(runsDir, "demo-run")
    await mkdir(runDir, { recursive: true })
    await writeFile(
      join(runDir, "debug-log.jsonl"),
      [
        '{"ts":"2026-07-04T06:38:58.016Z","type":"node.start","node":"runParallelAudits","round":0}',
        '{"ts":"2026-07-04T06:38:58.020Z","type":"session.created","sessionID":"ses-auditor","role":"auditor:source-auditor"}',
      ].join("\n"),
      "utf8",
    )

    const sessions = await parseDebugLogOpenCodeSessions(runDir)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.sessionId).toBe("ses-auditor")
    expect(sessions[0]?.node).toBe("runParallelAudits")
    expect(sessions[0]?.round).toBe(0)
  })
})

describe("applyOpenCodeUsageImport", () => {
  test("creates session-telemetry from debug log and opencode.db", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "opencode-import-debug-"))
    const runDir = join(runsDir, "demo-run")
    await mkdir(runDir, { recursive: true })
    await writeFile(
      join(runDir, "debug-log.jsonl"),
      [
        '{"ts":"2026-07-04T06:36:01.833Z","type":"node.start","node":"draftFullDraft","round":0}',
        '{"ts":"2026-07-04T06:36:01.839Z","type":"session.created","sessionID":"ses-missing","role":"research-drafter"}',
      ].join("\n"),
      "utf8",
    )

    const dbPath = join(runsDir, "opencode.db")
    createTestOpenCodeDb(dbPath, [
      {
        sessionId: "ses-missing",
        data: {
          role: "assistant",
          agent: "research-drafter",
          modelID: "claude-sonnet-4",
          providerID: "anthropic",
          cost: 0.15,
          tokens: { input: 1000, output: 250, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1_700_000_000_000, completed: 1_700_000_004_500 },
        },
      },
    ])

    const summary = await applyOpenCodeUsageImport({ runsDir, dbPath })
    expect(summary.runsScanned).toBe(1)
    expect(summary.matchedSessions).toBe(1)
    expect(summary.runsUpdated).toBe(1)

    const telemetry = await readSessionTelemetry(runDir)
    const missing = telemetry.sessions.find((session) => session.sessionId === "ses-missing")
    expect(missing?.provider).toBe("opencode")
    expect(missing?.node).toBe("draftFullDraft")
    expect(missing?.calls[0]?.usage?.tokensIn).toBe(1000)
    expect(missing?.calls[0]?.usageSource).toBe("opencode-import")
  })

  test("gap-fills opencode sessions from opencode.db and skips sessions with usage", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "opencode-import-"))
    const runDir = join(runsDir, "demo-run")
    await mkdir(runDir, { recursive: true })
    await writeFile(
      join(runDir, SESSION_TELEMETRY_FILENAME),
      `${JSON.stringify(
        {
          version: 1,
          sessions: [
            {
              sessionId: "ses-missing",
              role: "research-drafter",
              provider: "opencode",
              node: "draftFullDraft",
              round: 0,
              providerAgent: "research-drafter",
              calls: [],
            },
            {
              sessionId: "ses-has-usage",
              role: "logic-auditor",
              provider: "opencode",
              node: "runParallelAudits",
              round: 1,
              calls: [{ usage: { tokensIn: 500, tokensOut: 100 }, usageSource: "sdk" }],
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    )
    await writeFile(
      join(runDir, "debug-log.jsonl"),
      [
        '{"ts":"2026-07-04T06:36:01.833Z","type":"node.start","node":"draftFullDraft","round":0}',
        '{"ts":"2026-07-04T06:36:01.839Z","type":"session.created","sessionID":"ses-missing","role":"research-drafter"}',
        '{"ts":"2026-07-04T06:38:58.016Z","type":"node.start","node":"runParallelAudits","round":1}',
        '{"ts":"2026-07-04T06:38:58.020Z","type":"session.created","sessionID":"ses-has-usage","role":"logic-auditor"}',
      ].join("\n"),
      "utf8",
    )

    const dbPath = join(runsDir, "opencode.db")
    createTestOpenCodeDb(dbPath, [
      {
        sessionId: "ses-missing",
        data: {
          role: "assistant",
          agent: "research-drafter",
          modelID: "claude-sonnet-4",
          providerID: "anthropic",
          cost: 0.15,
          tokens: { input: 1000, output: 250, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1_700_000_000_000, completed: 1_700_000_004_500 },
        },
      },
    ])

    const summary = await applyOpenCodeUsageImport({ runsDir, dbPath })
    expect(summary.runsScanned).toBe(1)
    expect(summary.sessionsNeedingBackfill).toBe(1)
    expect(summary.matchedSessions).toBe(1)
    expect(summary.unmatchedSessions).toBe(0)
    expect(summary.runsUpdated).toBe(1)

    const telemetry = await readSessionTelemetry(runDir)
    const missing = telemetry.sessions.find((session) => session.sessionId === "ses-missing")
    expect(missing?.calls[0]?.usage?.tokensIn).toBe(1000)
    expect(missing?.calls[0]?.usage?.tokensOut).toBe(250)
    expect(missing?.calls[0]?.usageSource).toBe("opencode-import")
    expect(missing?.calls[0]?.resolvedModel).toBe("claude-sonnet-4")

    const existing = telemetry.sessions.find((session) => session.sessionId === "ses-has-usage")
    expect(existing?.calls[0]?.usageSource).toBe("sdk")
  })
})
