import { createClient, type Client } from "@libsql/client"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import {
  applySessionTelemetryEvent,
  readSessionTelemetry,
  SESSION_TELEMETRY_FILENAME,
  writeSessionTelemetry,
  type SessionTelemetryFile,
  type SessionTelemetryRecord,
} from "./session-telemetry"
import { foldOpencodeTokens, hasUsage } from "./usage"

export const OPENCODE_USAGE_IMPORT_FILENAME = "opencode-usage-import.json"

const TURSO_BATCH_SIZE = 100

export type OpenCodeTursoSessionUsage = {
  sessionId: string
  agent: string | null
  modelId: string | null
  providerId: string | null
  tokensIn: number
  tokensOut: number
  costUsd: number
  costAvailable: boolean
  durationMs: number
  completedAt: number | null
}

export type OpenCodeUsageMatch = {
  sessionId: string
  role: string
  node?: string
  round?: number
  providerAgent?: string
  resolvedModel?: string
  durationMs?: number
  completedAt: string
  tokensIn: number
  tokensOut: number
  costUsd?: number
  costAvailable: boolean
  costEstimated: boolean
}

export type OpenCodeUsageImportFile = {
  importedAt: string
  source: "turso"
  matches: OpenCodeUsageMatch[]
  unmatchedSessionIds: string[]
}

export type OpenCodeUsageImportSummary = {
  runsScanned: number
  opencodeSessionsFound: number
  sessionsNeedingBackfill: number
  matchedSessions: number
  unmatchedSessions: number
  runsUpdated: number
}

export type TursoQueryClient = Pick<Client, "execute" | "close">

export function isTursoConfigured(): boolean {
  return Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN)
}

export function createTursoClient(): TursoQueryClient | null {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) return null
  return createClient({ url, authToken })
}

function latestCall(record: SessionTelemetryRecord) {
  return record.calls.at(-1)
}

export function sessionNeedsBackfill(record: SessionTelemetryRecord): boolean {
  if (record.provider !== "opencode") return false
  const call = latestCall(record)
  if (!call?.usage) return true
  return !hasUsage(call.usage)
}

function usageFromTursoRow(row: OpenCodeTursoSessionUsage) {
  return {
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    ...(row.costAvailable
      ? {
          costUsd: row.costUsd,
          costAvailable: true,
          costEstimated: false,
        }
      : {}),
  }
}

function foldTursoTokenFields(input: {
  tokens_in: number
  tokens_out: number
  tokens_cache_read: number
  tokens_cache_write: number
}) {
  return foldOpencodeTokens({
    input: input.tokens_in,
    output: input.tokens_out,
    cache: { read: input.tokens_cache_read, write: input.tokens_cache_write },
  })
}

export async function fetchTursoSessionUsage(
  client: TursoQueryClient,
  sessionIds: string[],
): Promise<Map<string, OpenCodeTursoSessionUsage>> {
  const output = new Map<string, OpenCodeTursoSessionUsage>()
  if (sessionIds.length === 0) return output

  for (let index = 0; index < sessionIds.length; index += TURSO_BATCH_SIZE) {
    const batch = sessionIds.slice(index, index + TURSO_BATCH_SIZE)
    const placeholders = batch.map(() => "?").join(", ")
    const result = await client.execute({
      sql: `
        SELECT
          session_id,
          agent,
          model_id,
          provider_id,
          COALESCE(SUM(tokens_in), 0) AS tokens_in,
          COALESCE(SUM(tokens_out), 0) AS tokens_out,
          COALESCE(SUM(tokens_cache_read), 0) AS tokens_cache_read,
          COALESCE(SUM(tokens_cache_write), 0) AS tokens_cache_write,
          COALESCE(SUM(cost), 0) AS reported_cost,
          COALESCE(SUM(response_time_ms), 0) AS duration_ms,
          MAX(time_completed) AS completed_at
        FROM responses
        WHERE session_id IN (${placeholders})
        GROUP BY session_id
      `,
      args: batch,
    })

    for (const row of result.rows) {
      const sessionId = String(row.session_id)
      const tokensIn = Number(row.tokens_in ?? 0)
      const tokensOut = Number(row.tokens_out ?? 0)
      const cacheRead = Number(row.tokens_cache_read ?? 0)
      const cacheWrite = Number(row.tokens_cache_write ?? 0)
      const folded = foldTursoTokenFields({
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        tokens_cache_read: cacheRead,
        tokens_cache_write: cacheWrite,
      })
      const reportedCost = Number(row.reported_cost ?? 0)
      const completedAtRaw = row.completed_at
      output.set(sessionId, {
        sessionId,
        agent: row.agent == null ? null : String(row.agent),
        modelId: row.model_id == null ? null : String(row.model_id),
        providerId: row.provider_id == null ? null : String(row.provider_id),
        tokensIn: folded.tokensIn,
        tokensOut: folded.tokensOut,
        costUsd: reportedCost,
        costAvailable: reportedCost > 0,
        durationMs: Number(row.duration_ms ?? 0),
        completedAt:
          completedAtRaw == null || completedAtRaw === ""
            ? null
            : Number(completedAtRaw),
      })
    }
  }

  return output
}

type RunBackfillCandidate = {
  runDir: string
  runName: string
  record: SessionTelemetryRecord
}

async function listBackfillCandidates(runsDir: string): Promise<RunBackfillCandidate[]> {
  const entries = await readdir(runsDir, { withFileTypes: true })
  const candidates: RunBackfillCandidate[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue
    const runDir = join(runsDir, entry.name)
    let telemetryPath: string
    try {
      telemetryPath = join(runDir, SESSION_TELEMETRY_FILENAME)
      await readFile(telemetryPath, "utf8")
    } catch {
      continue
    }

    const file = await readSessionTelemetry(runDir)
    for (const record of file.sessions) {
      if (!sessionNeedsBackfill(record)) continue
      candidates.push({ runDir, runName: entry.name, record })
    }
  }

  return candidates
}

function buildMatch(record: SessionTelemetryRecord, turso: OpenCodeTursoSessionUsage): OpenCodeUsageMatch {
  const usage = usageFromTursoRow(turso)
  const completedAt = turso.completedAt
    ? new Date(turso.completedAt).toISOString()
    : new Date().toISOString()

  return {
    sessionId: record.sessionId,
    role: record.role,
    node: record.node,
    round: record.round,
    providerAgent: record.providerAgent ?? turso.agent ?? undefined,
    resolvedModel: turso.modelId ?? latestCall(record)?.resolvedModel,
    durationMs: turso.durationMs > 0 ? turso.durationMs : latestCall(record)?.durationMs,
    completedAt,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    costUsd: usage.costUsd,
    costAvailable: usage.costAvailable ?? false,
    costEstimated: false,
  }
}

function mergeImportIntoSessionTelemetry(
  file: SessionTelemetryFile,
  matches: OpenCodeUsageMatch[],
): SessionTelemetryFile {
  let next = file
  for (const match of matches) {
    next = applySessionTelemetryEvent(next, {
      kind: "session.telemetry",
      sessionID: match.sessionId,
      role: match.role,
      provider: "opencode",
      phase: "completed",
      node: match.node,
      round: match.round,
      providerAgent: match.providerAgent,
      resolvedModel: match.resolvedModel,
      durationMs: match.durationMs,
      completedAt: Date.parse(match.completedAt),
      usage: {
        tokensIn: match.tokensIn,
        tokensOut: match.tokensOut,
        costUsd: match.costUsd,
        costAvailable: match.costAvailable,
        costEstimated: match.costEstimated,
      },
      usageSource: "turso-import",
    })
  }
  return next
}

export async function applyOpenCodeUsageImport(input: {
  runsDir: string
  tursoClient?: TursoQueryClient | null
}): Promise<OpenCodeUsageImportSummary> {
  const client = input.tursoClient ?? createTursoClient()
  if (!client) {
    throw new Error("Turso not configured (missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN)")
  }

  const ownsClient = !input.tursoClient
  try {
    const candidates = await listBackfillCandidates(input.runsDir)
    const sessionIds = [...new Set(candidates.map((item) => item.record.sessionId))]
    const tursoBySession = await fetchTursoSessionUsage(client, sessionIds)

    const byRun = new Map<string, { runName: string; matches: OpenCodeUsageMatch[]; unmatched: string[] }>()
    let matchedSessions = 0

    for (const candidate of candidates) {
      const turso = tursoBySession.get(candidate.record.sessionId)
      const bucket = byRun.get(candidate.runDir) ?? {
        runName: candidate.runName,
        matches: [],
        unmatched: [],
      }

      if (!turso || !hasUsage({ tokensIn: turso.tokensIn, tokensOut: turso.tokensOut })) {
        bucket.unmatched.push(candidate.record.sessionId)
        byRun.set(candidate.runDir, bucket)
        continue
      }

      bucket.matches.push(buildMatch(candidate.record, turso))
      matchedSessions++
      byRun.set(candidate.runDir, bucket)
    }

    let runsUpdated = 0
    for (const [runDir, payload] of byRun) {
      if (payload.matches.length === 0) continue

      const importFile: OpenCodeUsageImportFile = {
        importedAt: new Date().toISOString(),
        source: "turso",
        matches: payload.matches,
        unmatchedSessionIds: payload.unmatched,
      }
      await writeFile(
        join(runDir, OPENCODE_USAGE_IMPORT_FILENAME),
        `${JSON.stringify(importFile, null, 2)}\n`,
        "utf8",
      )

      const sessionFile = mergeImportIntoSessionTelemetry(await readSessionTelemetry(runDir), payload.matches)
      await writeSessionTelemetry(runDir, sessionFile)
      runsUpdated++
    }

    const runsScanned = new Set(candidates.map((item) => item.runDir)).size
    const opencodeSessionsFound = candidates.length
    const unmatchedSessions = candidates.length - matchedSessions

    return {
      runsScanned,
      opencodeSessionsFound,
      sessionsNeedingBackfill: candidates.length,
      matchedSessions,
      unmatchedSessions,
      runsUpdated,
    }
  } finally {
    if (ownsClient) client.close()
  }
}

export async function readOpenCodeUsageImport(runDir: string): Promise<OpenCodeUsageImportFile | null> {
  try {
    return JSON.parse(await readFile(join(runDir, OPENCODE_USAGE_IMPORT_FILENAME), "utf8")) as OpenCodeUsageImportFile
  } catch {
    return null
  }
}
