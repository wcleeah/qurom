import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { defaultOpenCodeDbPath } from "./data-paths"
import {
  applySessionTelemetryEvent,
  readSessionTelemetry,
  writeSessionTelemetry,
  type SessionTelemetryFile,
  type SessionTelemetryRecord,
} from "./session-telemetry"
import { foldOpencodeTokens, hasUsage } from "./usage"

export const DEBUG_LOG_FILENAME = "debug-log.jsonl"
export const OPENCODE_USAGE_IMPORT_FILENAME = "opencode-usage-import.json"

const SESSION_BATCH_SIZE = 100

export type OpenCodeSessionUsage = {
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

export type DiscoveredOpenCodeSession = {
  sessionId: string
  role: string
  node?: string
  round?: number
  createdAt?: string
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
  source: "opencode-db"
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

type SessionUsageRow = {
  session_id: string
  agent: string | null
  model_id: string | null
  provider_id: string | null
  tokens_in: number
  tokens_out: number
  tokens_cache_read: number
  tokens_cache_write: number
  reported_cost: number
  duration_ms: number
  completed_at: number | null
}

type RunBackfillCandidate = {
  runDir: string
  runName: string
  record: SessionTelemetryRecord
}

export function isOpenCodeDbConfigured(dbPath = defaultOpenCodeDbPath()): boolean {
  return existsSync(dbPath)
}

function openOpenCodeDb(dbPath: string): Database {
  return new Database(dbPath, { readonly: true })
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

export async function parseDebugLogOpenCodeSessions(runDir: string): Promise<DiscoveredOpenCodeSession[]> {
  let text: string
  try {
    text = await readFile(join(runDir, DEBUG_LOG_FILENAME), "utf8")
  } catch {
    return []
  }

  const nodeStarts: Array<{ ts: number; node: string; round: number }> = []
  const sessions = new Map<string, DiscoveredOpenCodeSession>()

  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    const ts = Date.parse(String(entry.ts ?? ""))
    const eventTs = Number.isFinite(ts) ? ts : Date.now()

    if (entry.type === "node.start" && typeof entry.node === "string") {
      nodeStarts.push({
        ts: eventTs,
        node: entry.node,
        round: typeof entry.round === "number" ? entry.round : 0,
      })
      continue
    }

    if (entry.type !== "session.created" || typeof entry.sessionID !== "string") continue

    const activeNode = [...nodeStarts].reverse().find((item) => item.ts <= eventTs) ?? nodeStarts.at(-1)
    sessions.set(entry.sessionID, {
      sessionId: entry.sessionID,
      role: typeof entry.role === "string" ? entry.role : entry.sessionID,
      node: activeNode?.node,
      round: activeNode?.round,
      createdAt: new Date(eventTs).toISOString(),
    })
  }

  return [...sessions.values()]
}

function usageFromSessionRow(row: OpenCodeSessionUsage) {
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

function foldMessageTokenFields(input: {
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

const SESSION_USAGE_QUERY = `
  SELECT
    session_id,
    MAX(json_extract(data, '$.agent')) AS agent,
    MAX(json_extract(data, '$.modelID')) AS model_id,
    MAX(json_extract(data, '$.providerID')) AS provider_id,
    COALESCE(SUM(CAST(json_extract(data, '$.tokens.input') AS INTEGER)), 0) AS tokens_in,
    COALESCE(SUM(CAST(json_extract(data, '$.tokens.output') AS INTEGER)), 0) AS tokens_out,
    COALESCE(SUM(CAST(json_extract(data, '$.tokens.cache.read') AS INTEGER)), 0) AS tokens_cache_read,
    COALESCE(SUM(CAST(json_extract(data, '$.tokens.cache.write') AS INTEGER)), 0) AS tokens_cache_write,
    COALESCE(SUM(CAST(json_extract(data, '$.cost') AS REAL)), 0) AS reported_cost,
    COALESCE(SUM(
      CASE WHEN json_extract(data, '$.time.completed') IS NOT NULL
        AND json_extract(data, '$.time.created') IS NOT NULL
      THEN CAST(json_extract(data, '$.time.completed') AS INTEGER)
         - CAST(json_extract(data, '$.time.created') AS INTEGER)
      ELSE 0 END
    ), 0) AS duration_ms,
    MAX(CAST(json_extract(data, '$.time.completed') AS INTEGER)) AS completed_at
  FROM message
  WHERE json_extract(data, '$.role') = 'assistant'
    AND session_id IN (
`

function rowToSessionUsage(row: SessionUsageRow): OpenCodeSessionUsage {
  const folded = foldMessageTokenFields({
    tokens_in: Number(row.tokens_in ?? 0),
    tokens_out: Number(row.tokens_out ?? 0),
    tokens_cache_read: Number(row.tokens_cache_read ?? 0),
    tokens_cache_write: Number(row.tokens_cache_write ?? 0),
  })
  const reportedCost = Number(row.reported_cost ?? 0)
  const completedAtRaw = row.completed_at
  return {
    sessionId: String(row.session_id),
    agent: row.agent == null ? null : String(row.agent),
    modelId: row.model_id == null ? null : String(row.model_id),
    providerId: row.provider_id == null ? null : String(row.provider_id),
    tokensIn: folded.tokensIn,
    tokensOut: folded.tokensOut,
    costUsd: reportedCost,
    costAvailable: reportedCost > 0,
    durationMs: Number(row.duration_ms ?? 0),
    completedAt: completedAtRaw == null ? null : Number(completedAtRaw),
  }
}

export function fetchOpenCodeSessionUsage(
  db: Database,
  sessionIds: string[],
): Map<string, OpenCodeSessionUsage> {
  const output = new Map<string, OpenCodeSessionUsage>()
  if (sessionIds.length === 0) return output

  for (let index = 0; index < sessionIds.length; index += SESSION_BATCH_SIZE) {
    const batch = sessionIds.slice(index, index + SESSION_BATCH_SIZE)
    const placeholders = batch.map(() => "?").join(", ")
    const sql = `${SESSION_USAGE_QUERY}${placeholders})\n  GROUP BY session_id`
    const rows = db.query(sql).all(...batch) as SessionUsageRow[]

    for (const row of rows) {
      output.set(row.session_id, rowToSessionUsage(row))
    }
  }

  return output
}

async function runHasOpenCodeSignal(runDir: string, telemetry: SessionTelemetryFile): Promise<boolean> {
  if (telemetry.sessions.some((session) => session.provider === "opencode")) return true
  const discovered = await parseDebugLogOpenCodeSessions(runDir)
  return discovered.length > 0
}

async function listBackfillCandidates(runsDir: string): Promise<{
  candidates: RunBackfillCandidate[]
  runsScanned: number
}> {
  const entries = await readdir(runsDir, { withFileTypes: true })
  const candidates: RunBackfillCandidate[] = []
  let runsScanned = 0

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue
    const runDir = join(runsDir, entry.name)
    const telemetry = await readSessionTelemetry(runDir)
    if (!(await runHasOpenCodeSignal(runDir, telemetry))) continue

    runsScanned++
    const discovered = await parseDebugLogOpenCodeSessions(runDir)
    const bySession = new Map<string, RunBackfillCandidate>()

    for (const session of discovered) {
      const existing = telemetry.sessions.find((record) => record.sessionId === session.sessionId)
      if (existing && !sessionNeedsBackfill(existing)) continue

      bySession.set(session.sessionId, {
        runDir,
        runName: entry.name,
        record: existing ?? {
          sessionId: session.sessionId,
          role: session.role,
          provider: "opencode",
          node: session.node,
          round: session.round,
          createdAt: session.createdAt,
          calls: [],
        },
      })
    }

    for (const record of telemetry.sessions) {
      if (!sessionNeedsBackfill(record)) continue
      if (bySession.has(record.sessionId)) continue
      bySession.set(record.sessionId, { runDir, runName: entry.name, record })
    }

    candidates.push(...bySession.values())
  }

  return { candidates, runsScanned }
}

function buildMatch(record: SessionTelemetryRecord, usage: OpenCodeSessionUsage): OpenCodeUsageMatch {
  const usageTotals = usageFromSessionRow(usage)
  const completedAt = usage.completedAt
    ? new Date(usage.completedAt).toISOString()
    : new Date().toISOString()

  return {
    sessionId: record.sessionId,
    role: record.role,
    node: record.node,
    round: record.round,
    providerAgent: record.providerAgent ?? usage.agent ?? undefined,
    resolvedModel: usage.modelId ?? latestCall(record)?.resolvedModel,
    durationMs: usage.durationMs > 0 ? usage.durationMs : latestCall(record)?.durationMs,
    completedAt,
    tokensIn: usageTotals.tokensIn,
    tokensOut: usageTotals.tokensOut,
    costUsd: usageTotals.costUsd,
    costAvailable: usageTotals.costAvailable ?? false,
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
      usageSource: "opencode-import",
    })
  }
  return next
}

export async function applyOpenCodeUsageImport(input: {
  runsDir: string
  dbPath?: string
}): Promise<OpenCodeUsageImportSummary> {
  const dbPath = input.dbPath ?? defaultOpenCodeDbPath()
  if (!(await Bun.file(dbPath).exists())) {
    throw new Error(`OpenCode database not found at ${dbPath}`)
  }

  const db = openOpenCodeDb(dbPath)
  try {
    const { candidates, runsScanned } = await listBackfillCandidates(input.runsDir)
    const sessionIds = [...new Set(candidates.map((item) => item.record.sessionId))]
    const usageBySession = fetchOpenCodeSessionUsage(db, sessionIds)

    const byRun = new Map<string, { runName: string; matches: OpenCodeUsageMatch[]; unmatched: string[] }>()
    let matchedSessions = 0

    for (const candidate of candidates) {
      const usage = usageBySession.get(candidate.record.sessionId)
      const bucket = byRun.get(candidate.runDir) ?? {
        runName: candidate.runName,
        matches: [],
        unmatched: [],
      }

      if (!usage || !hasUsage({ tokensIn: usage.tokensIn, tokensOut: usage.tokensOut })) {
        bucket.unmatched.push(candidate.record.sessionId)
        byRun.set(candidate.runDir, bucket)
        continue
      }

      bucket.matches.push(buildMatch(candidate.record, usage))
      matchedSessions++
      byRun.set(candidate.runDir, bucket)
    }

    let runsUpdated = 0
    for (const [runDir, payload] of byRun) {
      if (payload.matches.length === 0) continue

      const importFile: OpenCodeUsageImportFile = {
        importedAt: new Date().toISOString(),
        source: "opencode-db",
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

    return {
      runsScanned,
      opencodeSessionsFound: candidates.length,
      sessionsNeedingBackfill: candidates.length,
      matchedSessions,
      unmatchedSessions: candidates.length - matchedSessions,
      runsUpdated,
    }
  } finally {
    db.close()
  }
}

export async function readOpenCodeUsageImport(runDir: string): Promise<OpenCodeUsageImportFile | null> {
  try {
    return JSON.parse(await readFile(join(runDir, OPENCODE_USAGE_IMPORT_FILENAME), "utf8")) as OpenCodeUsageImportFile
  } catch {
    return null
  }
}
