import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { RUNS_DIR, safeFilePath, safeRunPath } from "./paths"
import { isSqliteFile } from "./utils"
import type { FileClass, LiveStatus, RequestJson, RunMeta, RunStats, RunStatus } from "./types"

export async function readLiveStatus(runName: string): Promise<LiveStatus | null> {
  try {
    const p = safeFilePath(runName, "live-status.json")
    const st = await stat(p)
    if (Date.now() - st.mtime.getTime() > 30_000) return null
    return await Bun.file(p).json() as LiveStatus
  } catch {
    return null
  }
}

export async function listRuns(): Promise<RunMeta[]> {
  const entries = await readdir(RUNS_DIR, { withFileTypes: true })
  const dirs = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith(".") && !isSqliteFile(e.name),
  )

  const metas: RunMeta[] = []

  for (const dir of dirs) {
    const dirPath = join(RUNS_DIR, dir.name)
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
      fileCount = files.filter((f) => !isSqliteFile(f) && f !== ".gitkeep" && !isReaderReplyArchive(f)).length

      for (const file of files) {
        if (file === "request.json") {
          requestJson = await Bun.file(join(dirPath, file)).json() as RequestJson
        }
        if (file.startsWith("draft-round-") && file.endsWith(".md")) {
          roundCount = Math.max(roundCount, parseInt(file.match(/round-(\d+)/)?.[1] ?? "0") + 1)
        }
        const designHtmlMatch = file.match(/^design-html-round-(\d+)\.html$/)
        if (designHtmlMatch) {
          designRoundCount = Math.max(designRoundCount, parseInt(designHtmlMatch[1]) + 1)
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
    })
  }

  metas.sort((a, b) => b.mtime - a.mtime)
  return metas
}

export function computeStats(runs: RunMeta[]): RunStats {
  return {
    total: runs.length,
    approved: runs.filter((r) => r.status === "approved").length,
    failed: runs.filter((r) => r.status === "failed").length,
    running: runs.filter((r) => r.status === "running").length,
  }
}

export async function getRunFiles(runName: string): Promise<string[]> {
  const dirPath = safeRunPath(runName)
  const files = await readdir(dirPath)
  return files
    .filter((f) => !isSqliteFile(f) && f !== ".gitkeep" && !isReaderReplyArchive(f))
    .sort()
}

export function isReaderReplyArchive(name: string): boolean {
  return /^reader-reply-turn-\d+\.json$/.test(name)
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
  const match = filename.match(/^reader-profile(?:-(\d+))?\.json$/)
  return match ? match[1] : undefined
}

export function classifyFile(filename: string): FileClass {
  const round = roundFrom(filename)
  const readerTurn = readerProfileTurn(filename)
  if (filename === "request.json") return { group: "Run Metadata", subGroup: "Request", label: "Request", description: "Original topic/input and request id" }
  if (filename === "reader-profile.json" || readerTurn) {
    return {
      group: "Run Metadata",
      subGroup: "Reader",
      label: readerTurn ? `Reader profile turn ${readerTurn}` : "Reader profile",
      description: "Interview-derived audience model",
    }
  }
  if (filename === "summary.json") return { group: "Run Metadata", subGroup: "Summaries", label: "Summary", description: "Compact title/summary for the run" }
  if (filename === "confidence.json") return { group: "Run Metadata", subGroup: "Summaries", label: "Confidence", description: "Final confidence and caveat metadata" }
  if (filename === "failure.json") return { group: "Run Metadata", subGroup: "Failures", label: "Failure details", description: "Research failure payload" }
  if (filename === "debug-log.jsonl") return { group: "Debug", subGroup: "Logs", label: "Debug log", description: "Chronological pipeline/recovery events" }
  if (filename === "node-history.json") return { group: "Debug", subGroup: "Timelines", label: "Node history", description: "Processed graph steps" }
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
  if (/^auditor-rebuttal-responses-round-\d+-turn-\d+\.json$/.test(filename)) return { group: "Rebuttals", subGroup: "Auditor Responses", label: `Auditor rebuttal response round ${round}`, description: "Auditor response to drafter rebuttals" }
  if (/^drafter-rebuttal-review-round-\d+-turn-\d+\.json$/.test(filename)) return { group: "Rebuttals", subGroup: "Drafter Reviews", label: `Drafter rebuttal review round ${round}`, description: "Drafter review of auditor responses" }
  if (/^design-html-round-\d+\.html$/.test(filename)) return { group: "Design", subGroup: "HTML Drafts", label: `HTML draft round ${round}`, description: "Generated design HTML" }
  if (filename === "design-failure.json") return { group: "Design Rounds", subGroup: "Failures", label: "Design failure details", description: "Design quorum error payload" }
  return { group: "Other", subGroup: "Unclassified", label: filename, description: "Additional artifact" }
}
