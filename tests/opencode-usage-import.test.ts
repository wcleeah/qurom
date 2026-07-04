import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  applyOpenCodeUsageImport,
  fetchTursoSessionUsage,
  sessionNeedsBackfill,
  type TursoQueryClient,
} from "../src/opencode-usage-import.ts"
import { readSessionTelemetry, SESSION_TELEMETRY_FILENAME } from "../src/session-telemetry.ts"
import { foldOpencodeTokens } from "../src/usage.ts"

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

describe("fetchTursoSessionUsage", () => {
  test("folds cache tokens into tokensIn", async () => {
    const client: TursoQueryClient = {
      async execute() {
        return {
          columns: [],
          rows: [
            {
              session_id: "ses-fold",
              agent: "research-drafter",
              model_id: "claude-sonnet-4",
              provider_id: "anthropic",
              tokens_in: 100,
              tokens_out: 20,
              tokens_cache_read: 300,
              tokens_cache_write: 50,
              reported_cost: 0.42,
              duration_ms: 1200,
              completed_at: 1_700_000_000_000,
            },
          ],
          rowsAffected: 0,
          columnTypes: [],
        }
      },
      close() {},
    }

    const usage = await fetchTursoSessionUsage(client, ["ses-fold"])
    const row = usage.get("ses-fold")
    expect(row?.tokensIn).toBe(
      foldOpencodeTokens({ input: 100, output: 20, cache: { read: 300, write: 50 } }).tokensIn,
    )
    expect(row?.tokensOut).toBe(20)
    expect(row?.costAvailable).toBe(true)
    expect(row?.costUsd).toBe(0.42)
  })
})

describe("applyOpenCodeUsageImport", () => {
  test("gap-fills opencode sessions from Turso and skips sessions with usage", async () => {
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

    const tursoClient: TursoQueryClient = {
      async execute({ args }) {
        const sessionId = String(args?.[0] ?? "")
        if (sessionId !== "ses-missing") {
          return { columns: [], rows: [], rowsAffected: 0, columnTypes: [] }
        }
        return {
          columns: [],
          rows: [
            {
              session_id: "ses-missing",
              agent: "research-drafter",
              model_id: "claude-sonnet-4",
              provider_id: "anthropic",
              tokens_in: 1000,
              tokens_out: 250,
              tokens_cache_read: 0,
              tokens_cache_write: 0,
              reported_cost: 0.15,
              duration_ms: 4500,
              completed_at: 1_700_000_000_000,
            },
          ],
          rowsAffected: 0,
          columnTypes: [],
        }
      },
      close() {},
    }

    const summary = await applyOpenCodeUsageImport({ runsDir, tursoClient })
    expect(summary.runsScanned).toBe(1)
    expect(summary.sessionsNeedingBackfill).toBe(1)
    expect(summary.matchedSessions).toBe(1)
    expect(summary.unmatchedSessions).toBe(0)
    expect(summary.runsUpdated).toBe(1)

    const telemetry = await readSessionTelemetry(runDir)
    const missing = telemetry.sessions.find((session) => session.sessionId === "ses-missing")
    expect(missing?.calls[0]?.usage?.tokensIn).toBe(1000)
    expect(missing?.calls[0]?.usage?.tokensOut).toBe(250)
    expect(missing?.calls[0]?.usageSource).toBe("turso-import")
    expect(missing?.calls[0]?.resolvedModel).toBe("claude-sonnet-4")

    const existing = telemetry.sessions.find((session) => session.sessionId === "ses-has-usage")
    expect(existing?.calls[0]?.usageSource).toBe("sdk")
  })
})
