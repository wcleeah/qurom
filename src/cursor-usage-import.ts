import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { inferCursorCallScope, inferScopeFromNodeHistory } from "./cursor-call-scope"
import { estimateCursorCostUsd } from "./cursor-pricing"
import {
  applySessionTelemetryEvent,
  readSessionTelemetry,
  writeSessionTelemetry,
  type SessionTelemetryFile,
} from "./session-telemetry"
import { foldCursorUsage } from "./usage"

export const CURSOR_USAGE_IMPORT_FILENAME = "cursor-usage-import.json"

export type CursorUsageCsvRow = {
  closedAt: string
  agentId: string
  model: string
  inputWithCacheWrite: number
  inputWithoutCacheWrite: number
  cacheRead: number
  outputTokens: number
  costLabel: string
}

export type CursorUsageMatch = {
  runDir: string
  runName: string
  agentId: string
  cursorRunId: string
  role: string
  node?: string
  round?: number
  callIndex: number
  durationMs: number
  csvClosedAt: string
  completedAtMs?: number
  model: string
  tokensIn: number
  tokensOut: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  costUsd?: number
  costAvailable: boolean
  costEstimated: boolean
}

export type CursorUsageImportFile = {
  importedAt: string
  sourceFile: string
  matches: Array<Omit<CursorUsageMatch, "runDir">>
}

export type CursorUsageImportSummary = {
  csvRows: number
  csvRowsWithAgent: number
  runsScanned: number
  metadataCalls: number
  matchedCalls: number
  unmatchedCalls: number
  runsUpdated: number
  sourceFile: string
}

function parseIntCell(value: string | undefined): number {
  const trimmed = (value ?? "").trim()
  if (!trimmed) return 0
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Parse one RFC 4180 CSV line (Cursor exports quote every data field). */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ""
  let inQuotes = false

  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    if (inQuotes) {
      if (char === "\"") {
        if (line[index + 1] === "\"") {
          current += "\""
          index++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
      continue
    }

    if (char === "\"") {
      inQuotes = true
    } else if (char === ",") {
      cells.push(current)
      current = ""
    } else {
      current += char
    }
  }

  cells.push(current)
  return cells
}

function parseCostUsd(label: string): { costUsd?: number; costAvailable: boolean; costEstimated: boolean } {
  const trimmed = label.trim()
  if (!trimmed || trimmed === "Included" || trimmed === "Free" || trimmed === "free") {
    return { costAvailable: false, costEstimated: true }
  }
  const parsed = Number.parseFloat(trimmed.replace(/^\$/, ""))
  if (!Number.isFinite(parsed)) return { costAvailable: false, costEstimated: true }
  return { costUsd: parsed, costAvailable: true, costEstimated: false }
}

export function parseCursorUsageCsv(text: string): CursorUsageCsvRow[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []

  const header = parseCsvLine(lines[0]!).map((cell) => cell.trim())
  const index = (name: string) => header.indexOf(name)

  const dateIdx = index("Date")
  const agentIdx = index("Cloud Agent ID")
  const modelIdx = index("Model")
  const inCacheWriteIdx = index("Input (w/ Cache Write)")
  const inNoCacheIdx = index("Input (w/o Cache Write)")
  const cacheReadIdx = index("Cache Read")
  const outputIdx = index("Output Tokens")
  const costIdx = index("Cost")

  if (dateIdx < 0 || agentIdx < 0 || modelIdx < 0 || outputIdx < 0) {
    throw new Error("CSV is missing required Cursor usage columns")
  }

  const rows: CursorUsageCsvRow[] = []
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const cells = parseCsvLine(line)
    const agentId = (cells[agentIdx] ?? "").trim()
    if (!agentId) continue
    rows.push({
      closedAt: (cells[dateIdx] ?? "").trim(),
      agentId,
      model: (cells[modelIdx] ?? "").trim(),
      inputWithCacheWrite: parseIntCell(cells[inCacheWriteIdx]),
      inputWithoutCacheWrite: parseIntCell(cells[inNoCacheIdx]),
      cacheRead: parseIntCell(cells[cacheReadIdx]),
      outputTokens: parseIntCell(cells[outputIdx]),
      costLabel: (cells[costIdx] ?? "").trim(),
    })
  }

  return rows
}

type CursorNodeHistoryEntry = {
  node: string
  round?: number
  startedAt: number
  completedAt: number
  durationMs?: number
}

type CursorMetadataCall = {
  runDir: string
  runName: string
  agentId: string
  cursorRunId: string
  role: string
  artifact?: string
  callIndex: number
  durationMs: number
  completedAtMs?: number
  status?: string
}

function isFinishedCursorStatus(status: string | undefined): boolean {
  if (!status) return true
  const normalized = status.trim().toLowerCase()
  return normalized === "finished" || normalized === "completed"
}

function isBillableCsvRow(row: CursorUsageCsvRow): boolean {
  return row.inputWithCacheWrite > 0
    || row.inputWithoutCacheWrite > 0
    || row.cacheRead > 0
    || row.outputTokens > 0
}

function parseTimestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

async function readRunNodeHistory(runDir: string): Promise<CursorNodeHistoryEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(join(runDir, "node-history.json"), "utf8")) as CursorNodeHistoryEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function scopeForMetadataCall(
  call: CursorMetadataCall,
  nodeHistoryByRunDir: Map<string, CursorNodeHistoryEntry[]>,
) {
  const fromArtifact = inferCursorCallScope({ role: call.role, artifact: call.artifact })
  if (fromArtifact.node) return fromArtifact
  return inferScopeFromNodeHistory(call.completedAtMs, nodeHistoryByRunDir.get(call.runDir) ?? [])
}

async function listCursorMetadataCalls(runsDir: string): Promise<CursorMetadataCall[]> {
  const entries = await readdir(runsDir, { withFileTypes: true })
  const calls: CursorMetadataCall[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue
    const runDir = join(runsDir, entry.name)
    const files = await readdir(runDir)
    for (const file of files) {
      if (!file.endsWith("-metadata.json") || !file.startsWith("cursor-")) continue
      const metadataPath = join(runDir, file)
      const resultPath = metadataPath.replace("-metadata.json", "-result.json")
      try {
        const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
          agentId: string
          runId: string
          role: string
          callIndex?: number
          requestedArtifact?: string
          outputFile?: string
          completedAt?: string
        }
        const result = JSON.parse(await readFile(resultPath, "utf8")) as {
          durationMs?: number
          status?: string
        }
        if (!isFinishedCursorStatus(result.status)) continue
        const callMatch = file.match(/-call-(\d+)-/)
        calls.push({
          runDir,
          runName: entry.name,
          agentId: metadata.agentId,
          cursorRunId: metadata.runId,
          role: metadata.role,
          artifact: metadata.requestedArtifact ?? metadata.outputFile,
          callIndex: metadata.callIndex ?? (callMatch ? Number.parseInt(callMatch[1]!, 10) : 0),
          durationMs: result.durationMs ?? 0,
          completedAtMs: parseTimestampMs(metadata.completedAt),
          status: result.status,
        })
      } catch {
        // skip incomplete artifacts
      }
    }
  }

  return calls
}

function groupRowsByAgent(rows: CursorUsageCsvRow[]): Map<string, CursorUsageCsvRow[]> {
  const grouped = new Map<string, CursorUsageCsvRow[]>()
  for (const row of rows) {
    const list = grouped.get(row.agentId) ?? []
    list.push(row)
    grouped.set(row.agentId, list)
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.closedAt.localeCompare(b.closedAt))
  }
  return grouped
}

function compareMetadataCalls(a: CursorMetadataCall, b: CursorMetadataCall): number {
  if (a.completedAtMs != null && b.completedAtMs != null) return a.completedAtMs - b.completedAtMs
  if (a.completedAtMs != null) return -1
  if (b.completedAtMs != null) return 1
  return a.durationMs - b.durationMs
}

function groupCallsByAgent(calls: CursorMetadataCall[]): Map<string, CursorMetadataCall[]> {
  const grouped = new Map<string, CursorMetadataCall[]>()
  for (const call of calls) {
    const list = grouped.get(call.agentId) ?? []
    list.push(call)
    grouped.set(call.agentId, list)
  }
  for (const list of grouped.values()) {
    list.sort(compareMetadataCalls)
  }
  return grouped
}

function usageFromCsvRow(row: CursorUsageCsvRow) {
  const raw = {
    inputTokens: row.inputWithoutCacheWrite,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheRead,
    cacheWriteTokens: row.inputWithCacheWrite,
  }
  const folded = foldCursorUsage(raw)
  const parsedCost = parseCostUsd(row.costLabel)

  if (parsedCost.costAvailable) {
    return {
      ...folded,
      costUsd: parsedCost.costUsd,
      costAvailable: true,
      costEstimated: false,
    }
  }

  const estimated = estimateCursorCostUsd(row.model, raw)
  if (estimated.costAvailable) {
    return {
      ...folded,
      costUsd: estimated.costUsd,
      costAvailable: true,
      costEstimated: true,
    }
  }

  return {
    ...folded,
    costAvailable: false,
    costEstimated: false,
  }
}

export function matchCursorUsageRows(
  rows: CursorUsageCsvRow[],
  calls: CursorMetadataCall[],
  options?: { nodeHistoryByRunDir?: Map<string, CursorNodeHistoryEntry[]> },
): { matches: CursorUsageMatch[]; unmatchedCalls: CursorMetadataCall[] } {
  const rowsByAgent = groupRowsByAgent(rows.filter(isBillableCsvRow))
  const callsByAgent = groupCallsByAgent(calls)
  const nodeHistoryByRunDir = options?.nodeHistoryByRunDir ?? new Map<string, CursorNodeHistoryEntry[]>()
  const matches: CursorUsageMatch[] = []
  const unmatchedCalls: CursorMetadataCall[] = []

  for (const [agentId, agentCalls] of callsByAgent) {
    const csvRows = rowsByAgent.get(agentId) ?? []
    const paired = Math.min(csvRows.length, agentCalls.length)
    if (paired === 0) {
      unmatchedCalls.push(...agentCalls)
      continue
    }

    for (let i = 0; i < paired; i++) {
      const call = agentCalls[i]!
      const row = csvRows[i]!
      const usage = usageFromCsvRow(row)
      const scope = scopeForMetadataCall(call, nodeHistoryByRunDir)
      matches.push({
        runDir: call.runDir,
        runName: call.runName,
        agentId: call.agentId,
        cursorRunId: call.cursorRunId,
        role: call.role,
        node: scope.node,
        round: scope.round,
        callIndex: call.callIndex,
        durationMs: call.durationMs,
        csvClosedAt: row.closedAt,
        completedAtMs: call.completedAtMs,
        model: row.model,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        costUsd: usage.costUsd,
        costAvailable: usage.costAvailable,
        costEstimated: usage.costEstimated,
      })
    }
    unmatchedCalls.push(...agentCalls.slice(paired))
  }

  return { matches, unmatchedCalls }
}

function mergeImportIntoSessionTelemetry(
  file: SessionTelemetryFile,
  matches: CursorUsageMatch[],
): SessionTelemetryFile {
  let next = file
  for (const match of matches) {
    next = applySessionTelemetryEvent(next, {
      kind: "session.telemetry",
      sessionID: match.agentId,
      role: match.role,
      provider: "cursor",
      phase: "completed",
      node: match.node,
      round: match.round,
      cursorRunId: match.cursorRunId,
      callIndex: match.callIndex,
      resolvedModel: match.model,
      durationMs: match.durationMs,
      completedAt: match.completedAtMs ?? Date.parse(match.csvClosedAt),
      usage: {
        tokensIn: match.tokensIn,
        tokensOut: match.tokensOut,
        cacheReadTokens: match.cacheReadTokens,
        cacheWriteTokens: match.cacheWriteTokens,
        costUsd: match.costUsd,
        costAvailable: match.costAvailable,
        costEstimated: match.costEstimated,
      },
      usageSource: "csv-import",
    })
  }
  return next
}

export async function applyCursorUsageImport(input: {
  runsDir: string
  rows: CursorUsageCsvRow[]
  sourceFile: string
  totalCsvRows?: number
}): Promise<CursorUsageImportSummary> {
  const calls = await listCursorMetadataCalls(input.runsDir)
  const nodeHistoryByRunDir = new Map<string, CursorNodeHistoryEntry[]>()
  for (const call of calls) {
    if (nodeHistoryByRunDir.has(call.runDir)) continue
    nodeHistoryByRunDir.set(call.runDir, await readRunNodeHistory(call.runDir))
  }
  const { matches, unmatchedCalls } = matchCursorUsageRows(input.rows, calls, { nodeHistoryByRunDir })

  const byRun = new Map<string, CursorUsageMatch[]>()
  for (const match of matches) {
    const list = byRun.get(match.runDir) ?? []
    list.push(match)
    byRun.set(match.runDir, list)
  }

  for (const [runDir, runMatches] of byRun) {
    const importFile: CursorUsageImportFile = {
      importedAt: new Date().toISOString(),
      sourceFile: input.sourceFile,
      matches: runMatches.map(({ runDir: _runDir, ...rest }) => rest),
    }
    await writeFile(
      join(runDir, CURSOR_USAGE_IMPORT_FILENAME),
      `${JSON.stringify(importFile, null, 2)}\n`,
      "utf8",
    )

    const sessionFile = mergeImportIntoSessionTelemetry(await readSessionTelemetry(runDir), runMatches)
    await writeSessionTelemetry(runDir, sessionFile)
  }

  return {
    csvRows: input.totalCsvRows ?? input.rows.length,
    csvRowsWithAgent: input.rows.length,
    runsScanned: new Set(calls.map((call) => call.runDir)).size,
    metadataCalls: calls.length,
    matchedCalls: matches.length,
    unmatchedCalls: unmatchedCalls.length,
    runsUpdated: byRun.size,
    sourceFile: input.sourceFile,
  }
}

export async function readCursorUsageImport(runDir: string): Promise<CursorUsageImportFile | null> {
  try {
    return JSON.parse(await readFile(join(runDir, CURSOR_USAGE_IMPORT_FILENAME), "utf8")) as CursorUsageImportFile
  } catch {
    return null
  }
}
