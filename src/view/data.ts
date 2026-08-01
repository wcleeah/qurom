import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { readSessionTelemetry, SESSION_TELEMETRY_FILENAME, type SessionTelemetryFile } from "../session-telemetry"
import { readCursorUsageImport, CURSOR_USAGE_IMPORT_FILENAME, type CursorUsageImportFile } from "../cursor-usage-import"
import { reconcileAwaitingReaderReplyWithDisk, readerInterviewStateFromRunDir } from "../reader-transcript"
import { getRunsDir, safeFilePath, safeRunPath } from "./paths"
import { isRunManagedActive } from "../run-manager"
import { listReadRunNames, listRunAccessTimes } from "./read-store"
import { isSqliteFile } from "./utils"
import type { FileClass, LiveStatus, NodeHistoryEntry, RequestJson, RunMeta, RunStats, RunStatus } from "./types"
import type { ReaderTranscriptEntry } from "../reader-transcript"
import { resolveRunTelemetry, runElapsedMs } from "./telemetry-view"

function sanitizeLiveStatus(status: LiveStatus): LiveStatus {
  if (status.phase === "complete" || status.phase === "error") {
    return { ...status, awaitingReaderReply: undefined }
  }
  return status
}

async function enrichInterviewFromDisk(runName: string, status: LiveStatus): Promise<LiveStatus> {
  const awaiting = status.awaitingReaderReply
  if (!awaiting || status.phase !== "running") return status
  try {
    const disk = await readerInterviewStateFromRunDir(safeRunPath(runName))
    if (!disk) return status
    const reconciled = reconcileAwaitingReaderReplyWithDisk(awaiting, disk)
    if (reconciled === awaiting) return status
    return {
      ...status,
      awaitingReaderReply: {
        turn: reconciled.turn,
        answeredQuestions: reconciled.answeredQuestions ?? [],
        newQuestions: reconciled.newQuestions,
        transcript: (reconciled.transcript ?? []) as ReaderTranscriptEntry[],
        ...(reconciled.partialProfile ? { partialProfile: reconciled.partialProfile } : {}),
      },
    }  } catch {
    return status
  }
}

export async function readLiveStatus(runName: string): Promise<LiveStatus | null> {
  const runActiveInManager = isRunManagedActive(runName)

  if (runActiveInManager) {
    try {
      const status = sanitizeLiveStatus(await Bun.file(safeFilePath(runName, "live-status.json")).json() as LiveStatus)
      return enrichInterviewFromDisk(runName, status)
    } catch {
      return null
    }
  }

  try {
    const p = safeFilePath(runName, "live-status.json")
    const st = await stat(p)
    if (Date.now() - st.mtime.getTime() <= 30_000) {
      const status = sanitizeLiveStatus(await Bun.file(p).json() as LiveStatus)
      return enrichInterviewFromDisk(runName, status)
    }
  } catch {
    // fall through to run-status snapshot
  }

  try {
    const p = safeFilePath(runName, "run-status.json")
    return sanitizeLiveStatus(await Bun.file(p).json() as LiveStatus)
  } catch {
    return null
  }
}

export async function readNodeHistory(runName: string): Promise<NodeHistoryEntry[]> {
  const live = await readLiveStatus(runName)
  if (live?.nodeHistory?.length) return live.nodeHistory

  try {
    const p = safeFilePath(runName, "node-history.json")
    return await Bun.file(p).json() as NodeHistoryEntry[]
  } catch {
    return []
  }
}

export async function listRuns(): Promise<RunMeta[]> {
  const entries = await readdir(getRunsDir(), { withFileTypes: true })
  const dirs = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith(".") && !isSqliteFile(e.name),
  )

  const metas: RunMeta[] = []

  for (const dir of dirs) {
    const dirPath = join(getRunsDir(), dir.name)
    let requestJson: RequestJson | null = null
    let roundCount = 0
    let designRoundCount = 0
    let hasFinalHtml = false
    let hasFinalMd = false
    let hasLatestDraft = false
    let fileCount = 0
    let mtime = 0
    let hasDesignFailure = false

    try {
      const dirStat = await stat(dirPath)
      mtime = dirStat.mtimeMs

      const files = await readdir(dirPath)
      fileCount = files.filter((f) => !isSqliteFile(f) && f !== ".gitkeep" && !f.startsWith(".") && !isReaderReplyArchive(f)).length

      for (const file of files) {
        if (file === "request.json") {
          requestJson = await Bun.file(join(dirPath, file)).json() as RequestJson
        }
        if (file.startsWith("draft-round-") && file.endsWith(".md")) {
          roundCount = Math.max(roundCount, parseInt(file.match(/round-(\d+)/)?.[1] ?? "0") + 1)
        }
        if (/^design-html-.+\.html$/.test(file)) {
          designRoundCount += 1
        }
        if (file === "final.html") hasFinalHtml = true
        if (file === "final.md") hasFinalMd = true
        if (file === "latest-draft.md") hasLatestDraft = true
        if (file === "design-failure.json") hasDesignFailure = true
      }
    } catch {
      continue
    }

    const topic =
      requestJson?.inputSummary?.title ??
      requestJson?.topic ??
      dir.name

    // Research status
    let researchStatus: RunStatus = "running"
    if (hasFinalMd) researchStatus = "approved"
    else if (hasLatestDraft) researchStatus = "failed"

    // Design status
    let designStatus: RunStatus | null = null
    if (designRoundCount > 0 || hasFinalHtml || hasDesignFailure) {
      if (hasDesignFailure) {
        designStatus = "failed"
      } else if (hasFinalHtml) {
        designStatus = "approved"
      } else if (designRoundCount > 0) {
        designStatus = "running"
      }
    } else if (researchStatus === "approved") {
      // Research passed but no design files yet — design is likely in-progress
      designStatus = "running"
    }

    // Overall status: combine research + design
    let status: RunStatus = "running"
    if (designStatus === "failed" || researchStatus === "failed") {
      status = "failed"
    } else if (researchStatus === "approved" && (designStatus === "approved" || designStatus === null)) {
      status = "approved"
    } else if (researchStatus === "approved" && designStatus === "running") {
      status = "running"
    }

    metas.push({
      name: dir.name,
      topic,
      status,
      mtime,
      roundCount,
      hasFinalHtml,
      hasFinalMd,
      hasLatestDraft,
      fileCount,
      designStatus,
      designRoundCount,
      unread: true,
    })
  }

  const read = await listReadRunNames()
  const accessTimes = await listRunAccessTimes()
  for (const meta of metas) {
    meta.unread = !read.has(meta.name)
    meta.accessedAt = accessTimes.get(meta.name)
  }

  await Promise.all(metas.map((meta) => enrichRunIndexFields(meta)))

  metas.sort((a, b) => {
    const aAccess = a.accessedAt ?? 0
    const bAccess = b.accessedAt ?? 0
    if (aAccess !== bAccess) return bAccess - aAccess
    return b.mtime - a.mtime
  })
  return metas
}

async function enrichRunIndexFields(meta: RunMeta): Promise<void> {
  const [liveStatus, sessionTelemetry] = await Promise.all([
    readLiveStatus(meta.name),
    readRunSessionTelemetry(meta.name),
  ])

  let nodeHistory: NodeHistoryEntry[] = []
  if (liveStatus?.nodeHistory?.length) {
    nodeHistory = liveStatus.nodeHistory
  } else {
    try {
      nodeHistory = await Bun.file(safeFilePath(meta.name, "node-history.json")).json() as NodeHistoryEntry[]
    } catch {
      nodeHistory = []
    }
  }

  const elapsedMs = runElapsedMs(liveStatus, nodeHistory)
  if (elapsedMs !== undefined) meta.elapsedMs = elapsedMs

  const { usage, costAvailable, costEstimated } = resolveRunTelemetry(sessionTelemetry)
  if (costAvailable) {
    meta.costAvailable = true
    meta.costUsd = usage.costUsd ?? 0
    meta.costEstimated = costEstimated
  }
}

export function filterRunsForIndex(
  runs: RunMeta[],
  searchParams: URLSearchParams,
): { runs: RunMeta[]; showUnreadOnly: boolean; showReadOnly: boolean; showAll: boolean } {
  const showAll = searchParams.get("all") === "1"
  const showReadOnly = searchParams.get("read") === "1"
  if (showAll) {
    return { runs, showUnreadOnly: false, showReadOnly: false, showAll }
  }
  if (showReadOnly) {
    return {
      runs: runs.filter((run) => !run.unread),
      showUnreadOnly: false,
      showReadOnly: true,
      showAll: false,
    }
  }
  return {
    runs: runs.filter((run) => run.unread),
    showUnreadOnly: true,
    showReadOnly: false,
    showAll: false,
  }
}

export function computeStats(runs: RunMeta[]): RunStats {
  return {
    total: runs.length,
    read: runs.filter((r) => !r.unread).length,
    unread: runs.filter((r) => r.unread).length,
    failed: runs.filter((r) => r.status === "failed").length,
  }
}

export async function getRunFiles(runName: string): Promise<string[]> {
  const dirPath = safeRunPath(runName)
  const files = await readdir(dirPath)
  return files
    .filter((f) => !isSqliteFile(f) && f !== ".gitkeep" && !f.startsWith(".") && !isReaderReplyArchive(f))
    .sort()
}

export function isReaderReplyArchive(_name: string): boolean {
  // No longer used as archives — replies are first-class reply-N.json files.
  return false
}

// ---------------------------------------------------------------------------
// JSON-aware summaries
// ---------------------------------------------------------------------------

/**
 * Try to extract a human-readable label from a JSON artifact file
 * (e.g. "3 findings · outcome: needs_revision") without re-reading
 * the full file — used only when the file is loaded later.
 */

export function roundFrom(filename: string) {
  return filename.match(/round-(\d+)/)?.[1]
}

export function agentFrom(filename: string, prefix: string) {
  return filename
    .replace(new RegExp(`^${prefix}-`), "")
    .replace(/-round-\d+\.json$/, "")
}

export function readerProfileTurn(filename: string) {
  // Legacy per-turn profiles are no longer written; keep matcher for old runs.
  const match = filename.match(/^reader-profile(?:-(\d+))?\.json$/)
  return match ? match[1] : undefined
}

export function classifyFile(filename: string): FileClass {
  const round = roundFrom(filename)
  const readerTurn = readerProfileTurn(filename)
  if (filename === "request.json") return { group: "Run Metadata", subGroup: "Request", label: "Request", description: "Original topic/input and request id" }
  if (filename === "input.md") return { group: "Run Metadata", subGroup: "Request", label: "Source document", description: "Original markdown submitted for this document-mode run" }
  if (filename === "reader-profile.json" || readerTurn) {
    return {
      group: "Run Metadata",
      subGroup: "Reader",
      label: readerTurn ? `Reader profile turn ${readerTurn}` : "Reader profile",
      description: "Interview-derived audience model",
    }
  }
  const questionTurn = filename.match(/^question-(\d+)\.json$/)?.[1]
  if (questionTurn) {
    return {
      group: "Run Metadata",
      subGroup: "Reader",
      label: `Interview question ${questionTurn}`,
      description: "Questions asked on this interview turn",
    }
  }
  const replyTurn = filename.match(/^reply-(\d+)\.json$/)?.[1]
  if (replyTurn) {
    return {
      group: "Run Metadata",
      subGroup: "Reader",
      label: `Interview reply ${replyTurn}`,
      description: "Reader answer for this interview turn",
    }
  }
  if (filename === "summary.json") return { group: "Run Metadata", subGroup: "Summaries", label: "Summary", description: "Compact title/summary for the run" }
  if (filename === "confidence.json") return { group: "Run Metadata", subGroup: "Summaries", label: "Confidence", description: "Final confidence and caveat metadata" }
  if (filename === "failure.json") return { group: "Run Metadata", subGroup: "Failures", label: "Failure details", description: "Research failure payload" }
  if (filename === "debug-log.jsonl") return { group: "Debug", subGroup: "Logs", label: "Debug log", description: "Chronological pipeline/recovery events" }
  if (filename === "node-history.json") return { group: "Debug", subGroup: "Timelines", label: "Node history", description: "Processed graph steps" }
  if (filename === SESSION_TELEMETRY_FILENAME) return { group: "Debug", subGroup: "Telemetry", label: "Session telemetry", description: "Model, parameters, and usage per agent session" }
  if (filename === CURSOR_USAGE_IMPORT_FILENAME) return { group: "Debug", subGroup: "Telemetry", label: "Cursor usage import", description: "CSV backfilled token usage for Cursor cloud calls" }
  if (filename === "live-status.json") return { group: "Debug", subGroup: "Live", label: "Live status", description: "Current dashboard snapshot" }
  if (/^cursor-[\w.-]+-call-\d+-attempt-\d+-[\w.-]+-(metadata|result|artifacts|conversation)\.json$/.test(filename)) {
    return { group: "Debug", subGroup: "Cursor", label: filename, description: "Cursor provider diagnostic artifact" }
  }
  if (/^cursor-[\w.-]+-call-\d+-attempt-\d+-[\w.-]+-response\.txt$/.test(filename)) {
    return { group: "Debug", subGroup: "Cursor", label: filename, description: "Cursor provider text response" }
  }
  if (filename === "final.html") return { group: "Final Outputs", subGroup: "Published", label: "Final HTML", description: "Rendered design output" }
  if (filename === "final.md") return { group: "Final Outputs", subGroup: "Published", label: "Final markdown", description: "Approved research document" }
  if (filename === "latest-draft.md") return { group: "Final Outputs", subGroup: "Fallbacks", label: "Latest draft", description: "Most recent research draft" }
  if (/^draft-round-\d+\.md$/.test(filename)) return { group: "Research Rounds", subGroup: "Drafts", label: `Draft round ${round}`, description: "Research draft submitted to auditors" }
  if (/^audits-round-\d+\.json$/.test(filename)) return { group: "Research Rounds", subGroup: "Audit Bundles", label: `Audit bundle round ${round}`, description: "Combined auditor results" }
  if (/^audit-[\w-]+-round-\d+\.json$/.test(filename)) {
    const agent = agentFrom(filename, "audit")
    return { group: "Research Rounds", subGroup: "Per-Agent Audits", label: `${agent} round ${round}`, description: "Individual auditor result" }
  }
  if (/^drafter-finding-review-round-\d+\.json$/.test(filename)) return { group: "Research Rounds", subGroup: "Reviews", label: `Drafter review round ${round}`, description: "Accepted findings and rebuttal choices" }
  if (/^aggregated-findings-round-\d+\.json$/.test(filename)) return { group: "Research Rounds", subGroup: "Consensus", label: `Consensus round ${round}`, description: "Aggregated unresolved findings/outcome" }
  if (/^unresolved-findings-round-\d+\.json$/.test(filename)) return { group: "Research Rounds", subGroup: "Consensus", label: `Unresolved findings round ${round}`, description: "Findings carried into revision" }
  if (/^auditor-rebuttal-responses-round-\d+-turn-\d+\.json$/.test(filename)) {
    const turn = filename.match(/turn-(\d+)/)?.[1]
    return { group: "Rebuttals", subGroup: "Auditor Responses", label: `Auditor responses round ${round} turn ${turn}`, description: "Aggregated auditor rebuttal responses" }
  }
  if (/^auditor-rebuttal-responses-[\w-]+-round-\d+\.json$/.test(filename)) {
    const agent = agentFrom(filename, "auditor-rebuttal-responses")
    return { group: "Rebuttals", subGroup: "Per-Agent Responses", label: `${agent} rebuttal round ${round}`, description: "Individual auditor rebuttal response" }
  }
  if (/^rebuttals-[\w-]+-round-\d+\.json$/.test(filename)) {
    const agent = agentFrom(filename, "rebuttals")
    return { group: "Rebuttals", subGroup: "Rebuttal Inputs", label: `${agent} rebuttals round ${round}`, description: "Rebuttals sent to auditor" }
  }
  if (/^disputed-round-\d+\.json$/.test(filename)) return { group: "Rebuttals", subGroup: "Disputed", label: `Disputed findings round ${round}`, description: "Findings under rebuttal review" }
  if (/^drafter-rebuttal-review-round-\d+-turn-\d+\.json$/.test(filename)) {
    const turn = filename.match(/turn-(\d+)/)?.[1]
    return { group: "Rebuttals", subGroup: "Drafter Reviews", label: `Drafter rebuttal review round ${round} turn ${turn}`, description: "Drafter review of auditor responses" }
  }
  if (/^design-html-round-\d+\.html$/.test(filename)) {
    return { group: "Design", subGroup: "HTML Drafts", label: `HTML draft round ${round}`, description: "Legacy design HTML round artifact" }
  }
  if (/^design-html-.+\.html$/.test(filename)) {
    const role = filename.replace(/^design-html-/, "").replace(/\.html$/, "")
    return { group: "Design", subGroup: "HTML Drafts", label: `HTML · ${role}`, description: "Role-staged design HTML artifact" }
  }
  if (filename === "design-failure.json") return { group: "Design Rounds", subGroup: "Failures", label: "Design failure details", description: "Design pipeline error payload" }
  return { group: "Other", subGroup: "Unclassified", label: filename, description: "Additional artifact" }
}

export async function readRunSessionTelemetry(runName: string): Promise<SessionTelemetryFile> {
  try {
    return await readSessionTelemetry(safeRunPath(runName))
  } catch {
    return { version: 1, sessions: [] }
  }
}

export async function readRunCursorUsageImport(runName: string): Promise<CursorUsageImportFile | null> {
  try {
    return await readCursorUsageImport(safeRunPath(runName))
  } catch {
    return null
  }
}
