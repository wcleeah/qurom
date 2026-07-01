import { readdir, stat } from "node:fs/promises"
import { basename, join } from "node:path"
import { POLLING_SCRIPT } from "./client-script"
import { renderStructuredJson } from "./artifact-renderers"
import { renderAgentActivity, renderFailureBanner, renderInterviewChatCard, renderLivePipeline, renderNodeHistory } from "./components"
import { computeStats, getRunFiles, listRuns, readLiveStatus } from "./data"
import { renderFileBrowser } from "./file-browser"
import { badge, formatRelative, layout } from "./layout"
import { RUNS_DIR, safeFilePath, safeRunPath } from "./paths"
import { contentType, escapeHtml, formatBytes, formatElapsed, renderJsonCard, renderMarkdown, statusDot } from "./utils"
import type { RequestJson, RunStatus } from "./types"

export async function renderNodePage(runName: string, nodeName: string): Promise<Response> {
  let dirPath: string
  try {
    dirPath = safeRunPath(runName)
  } catch {
    return new Response("Not found", { status: 404 })
  }

  // Read node history from file
  let nodeHistory: any[] = []
  try {
    const f = Bun.file(`${dirPath}/node-history.json`)
    if (await f.exists()) {
      nodeHistory = await f.json() as any[]
    }
  } catch { /* ignore */ }

  // Find the target node (latest occurrence)
  const nodeEntries = nodeHistory.filter((n: any) => n.node === nodeName)
  if (nodeEntries.length === 0) {
    return new Response(`Node "${escapeHtml(nodeName)}" not found in run history`, { status: 404 })
  }

  // Get run files for artifact links
  let files: string[] = []
  try {
    files = await getRunFiles(runName)
  } catch { /* ignore */ }

  let html = `<a class="back-link" href="/runs/${encodeURIComponent(runName)}">← Back to run</a>
<div class="header-bar">
  <h1>Node: ${escapeHtml(nodeName)}</h1>
  <p class="muted-note dim-text">Run: ${escapeHtml(runName)}</p>
</div>`

  for (let i = nodeEntries.length - 1; i >= 0; i--) {
    const entry = nodeEntries[i]
    if (!entry) continue
    const elapsed = entry.completedAt && entry.startedAt
      ? `${((entry.completedAt - entry.startedAt) / 1000).toFixed(1)}s`
      : "unknown"
    const statusLabel = entry.status === "completed" ? "Completed" : "Error"
    const statusCls = entry.status === "completed" ? "success-text" : "danger-text"

    html += `<div class="section">
  <h2>Execution #${nodeEntries.length - i} <span class="${statusCls} tiny-text">${statusLabel}</span></h2>
  <div class="card">
    <table class="summary-table">
      <tr><td>Status</td><td>${statusLabel}</td></tr>
      <tr><td>Duration</td><td>${elapsed}</td></tr>
      <tr><td>Round</td><td>${entry.round ?? 0}</td></tr>
      ${entry.summary ? Object.entries(entry.summary as Record<string, unknown>).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(String(v))}</td></tr>`).join("") : ""}
      ${entry.error ? `<tr><td>Error</td><td class="danger-text">${escapeHtml(String(entry.error))}</td></tr>` : ""}
    </table>
  </div>
</div>`
  }

  // Show related artifacts (files matching node pattern)
  const relatedFiles = files.filter((f) => {
    const lower = f.toLowerCase()
    const nodeLower = nodeName.toLowerCase()
    return lower.includes(nodeLower) ||
      (nodeLower === "draftfulldraft" && lower.includes("draft-round")) ||
      (nodeLower === "runparallelaudits" && lower.includes("audits-round")) ||
      (nodeLower === "aggregateconsensus" && lower.includes("aggregated-findings")) ||
      (nodeLower === "finalizedesign" && lower === "final.html")
  })

  if (relatedFiles.length > 0) {
    html += `<div class="section">
  <h2>Related artifacts</h2>
  <ul class="file-list">
    ${relatedFiles.map((f) => `<li><a href="/runs/${encodeURIComponent(runName)}/raw/${encodeURIComponent(f)}">${escapeHtml(f)}</a></li>`).join("")}
  </ul>
</div>`
  }

  const fullHtml = layout(`Node: ${nodeName} — ${escapeHtml(runName)}`, html)
  return new Response(fullHtml, {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

// ---------------------------------------------------------------------------
// Debug log
// ---------------------------------------------------------------------------

export async function renderDebugLog(runName: string, files: string[]): Promise<string> {
  if (!files.includes("debug-log.jsonl")) return ""

  let dirPath: string
  try { dirPath = safeRunPath(runName) } catch { return "" }

  // Read last 200 lines (tail)
  let raw: string
  try {
    const f = Bun.file(`${dirPath}/debug-log.jsonl`)
    if (!(await f.exists())) return ""
    const content = await f.text()
    const lines = content.trim().split("\n")
    raw = lines.slice(-200).join("\n")
  } catch { return "" }

  if (!raw.trim()) return ""

  const entries: Array<{ ts: string; type: string; [k: string]: unknown }> = []
  for (const line of raw.split("\n")) {
    try { entries.push(JSON.parse(line)) } catch { /* skip malformed lines */ }
  }

  if (entries.length === 0) return ""

  let html = '<div class="section"><details class="markdown-preview"><summary>Debug Log (' + entries.length + ' entries)</summary>'
  html += '<div class="debug-log-scroll"><table class="summary-table summary-table-debug">'
  html += '<thead><tr><th>Time</th><th>Type</th><th>Data</th></tr></thead><tbody>'

  for (const entry of entries.reverse()) {
    const { ts, type, ...data } = entry
    const time = ts ? (ts as string).slice(11, 23) : ""
    const typeKind = type.split(".")[1]
    const typeClass = typeKind === "error" ? "danger-text" : typeKind === "complete" ? "success-text" : typeKind === "start" ? "accent-text" : "muted-text"
    const dataStr = JSON.stringify(data).slice(0, 200)
    html += `<tr>
  <td class="cell-nowrap muted-text">${escapeHtml(time)}</td>
  <td class="cell-nowrap ${typeClass}">${escapeHtml(type)}</td>
  <td class="cell-truncate cell-truncate-wide">${escapeHtml(dataStr)}</td>
</tr>`
  }

  html += '</tbody></table></div></details></div>'
  return html
}

export async function renderRunNav(currentName: string): Promise<string> {
  let names: string[]
  try {
    const entries = await readdir(RUNS_DIR, { withFileTypes: true })
    names = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !/\.sqlite/.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a))
  } catch {
    return ""
  }

  const index = names.indexOf(currentName)
  if (index === -1) return ""

  const prevName = index < names.length - 1 ? names[index + 1] : null
  const nextName = index > 0 ? names[index - 1] : null

  return `<div class="run-nav">
  ${prevName ? `<a href="/runs/${encodeURIComponent(prevName)}">← Prev</a>` : '<span></span>'}
  <a href="/">↑ All runs</a>
  ${nextName ? `<a href="/runs/${encodeURIComponent(nextName)}">Next →</a>` : '<span></span>'}
</div>`
}

// ---------------------------------------------------------------------------
// Route: GET /
// ---------------------------------------------------------------------------

export async function renderIndex(): Promise<Response> {
  const runs = await listRuns()
  const stats = computeStats(runs)

  // Stats dashboard
  const statsHtml = `
<div class="stats-grid">
  <div class="stat-card stat-total">
    <div class="stat-value">${stats.total}</div>
    <div class="stat-label">Total</div>
  </div>
  <div class="stat-card stat-approved">
    <div class="stat-value">${stats.approved}</div>
    <div class="stat-label">Approved</div>
  </div>
  <div class="stat-card stat-failed">
    <div class="stat-value">${stats.failed}</div>
    <div class="stat-label">Failed</div>
  </div>
  <div class="stat-card stat-running">
    <div class="stat-value">${stats.running}</div>
    <div class="stat-label">Running</div>
  </div>
</div>`

  // Active run hero — scan for live-status.json
  let activeRunHtml = ""
  let hasActiveRun = false
  for (const run of runs) {
    if (run.status !== "running") continue
    const liveStatus = await readLiveStatus(run.name)
    if (!liveStatus) continue
    hasActiveRun = true
    const elapsed = liveStatus.nodeStartedAt ? formatElapsed(Date.now() - liveStatus.nodeStartedAt) : ""
    const agentList = Object.entries(liveStatus.agents)
      .slice(0, 4)
      .map(([name, a]) => `${statusDot(a.status)} ${escapeHtml(name)}${a.tool ? ` · ${escapeHtml(a.tool)}` : ""}`)
      .join(" · ")
    activeRunHtml = `<div class="card active-run-hero">
  <div class="active-run-header">
    <span class="badge badge-running">● Active</span>
    <span class="active-run-refresh">auto-refreshes</span>
  </div>
  <div class="active-run-topic">
    <a href="/runs/${encodeURIComponent(run.name)}">${escapeHtml(run.topic)}</a>
  </div>
  <div class="active-run-pipeline">
    ${escapeHtml(liveStatus.node ?? "running")} · Round ${liveStatus.round}/${liveStatus.maxRounds} · ${elapsed}
  </div>
  ${agentList ? `<div class="active-run-agents">${agentList}</div>` : ""}
</div>`
    break
  }

  // Run cards
  let runCards = ""
  if (runs.length === 0) {
    runCards = `<div class="empty-state">No runs found in <code>${escapeHtml(RUNS_DIR)}</code></div>`
  } else {
    for (const run of runs) {
      const roundLabel =
        run.roundCount > 0
          ? `<span>${run.roundCount} round${run.roundCount !== 1 ? "s" : ""}</span>`
          : ""
      const iconsStr = run.hasFinalHtml ? ` <span class="tiny-text muted-text">html</span>` : ""

      const designBadge = run.designStatus
        ? `<span class="badge ${run.designStatus === "approved" ? "badge-approved" : run.designStatus === "failed" ? "badge-failed" : "badge-running"} design-badge">design: ${run.designStatus}</span>`
        : ""

      runCards += `<div class="run-card">
  <div class="run-card-top">
    <div class="run-card-title">
      <a href="/runs/${encodeURIComponent(run.name)}">${escapeHtml(run.topic)}${iconsStr}</a>
    </div>
    <div class="row-inline-spread">${badge(run.status)}${designBadge}</div>
  </div>
  <div class="run-card-meta">
    ${roundLabel}
    ${run.designRoundCount > 0 ? `<span>${run.designRoundCount} design round${run.designRoundCount !== 1 ? "s" : ""}</span>` : ""}
    <span>${run.fileCount} file${run.fileCount !== 1 ? "s" : ""}</span>
    <span>${formatRelative(run.mtime)}</span>
    <span class="tiny-text dim-text">${escapeHtml(run.name.slice(-12))}</span>
  </div>
</div>`
    }
  }

  const body = `
<div class="site-nav">
  <a href="/" class="active">Runs</a>
  <a href="/config">Config</a>
</div>
<h1 class="page-title">Runs</h1>
${statsHtml}
${activeRunHtml}
${runCards}`

  const extraHead = hasActiveRun ? `<meta http-equiv="refresh" content="8">` : ""
  const html = layout("Runs — quorum", body, extraHead)
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

// ---------------------------------------------------------------------------
// Run detail helpers
// ---------------------------------------------------------------------------

export function countByPattern(files: string[], pattern: RegExp): number {
  return files.filter((f) => pattern.test(f)).length
}

export async function getFileSizes(runName: string, files: string[]): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  for (const f of files) {
    try {
      const p = safeFilePath(runName, f)
      const s = await stat(p)
      sizes.set(f, s.size)
    } catch {
      sizes.set(f, 0)
    }
  }
  return sizes
}

export async function readDesignConsensus(runName: string, files: string[]): Promise<{
  outcome: string
  round: number
  unresolvedCount: number
  severityBreakdown: Record<string, number>
  hasFinalHtml: boolean
  hasDesignFiles: boolean
  hasFailure: boolean
} | null> {
  const designConsensusFiles = files
    .filter((f) => /^design-consensus-round-\d+\.json$/.test(f))
    .sort()

  if (designConsensusFiles.length === 0) {
    // No design quorum ran at all
    return null
  }

  // Read the latest consensus file
  const latest = designConsensusFiles[designConsensusFiles.length - 1]
  try {
    const p = safeFilePath(runName, latest)
    const data = await Bun.file(p).json() as {
      outcome?: string
      approvedAgents?: string[]
      unresolvedFindings?: Array<{ severity: string }>
    }
    const roundMatch = latest.match(/round-(\d+)/)
    const round = roundMatch ? parseInt(roundMatch[1]) : 0
    const unresolvedCount = data.unresolvedFindings?.length ?? 0
    const severityBreakdown: Record<string, number> = {}
    for (const f of data.unresolvedFindings ?? []) {
      severityBreakdown[f.severity] = (severityBreakdown[f.severity] ?? 0) + 1
    }
    return {
      outcome: data.outcome ?? "unknown",
      round,
      unresolvedCount,
      severityBreakdown,
      hasFinalHtml: files.includes("final.html"),
      hasDesignFiles: true,
      hasFailure: files.includes("design-failure.json"),
    }
  } catch {
    return { outcome: "unknown", round: 0, unresolvedCount: 0, severityBreakdown: {}, hasFinalHtml: false, hasDesignFiles: true, hasFailure: false }
  }
}

// ---------------------------------------------------------------------------
// Route: GET /runs/:name
// ---------------------------------------------------------------------------

export async function renderRun(name: string): Promise<Response> {
  let dirPath: string
  try {
    dirPath = safeRunPath(name)
  } catch {
    return new Response("Not found", { status: 404 })
  }

  let files: string[] = []
  try {
    files = await getRunFiles(name)
  } catch {
    return new Response("Cannot read run directory", { status: 500 })
  }

  // File sizes (parallel stat)
  const fileSizes = await getFileSizes(name, files)

  // Parse request.json
  let requestJson: RequestJson | null = null
  if (files.includes("request.json")) {
    try {
      requestJson = await Bun.file(join(dirPath, "request.json")).json() as RequestJson
    } catch { /* ignore */ }
  }

  // Determine research status
  const hasFinalHtml = files.includes("final.html")
  const hasFinalMd = files.includes("final.md")
  const hasLatestDraft = files.includes("latest-draft.md")
  const hasFailureJson = files.includes("failure.json")

  let researchStatus: RunStatus = "running"
  if (hasFinalMd) researchStatus = "approved"
  else if (hasLatestDraft) researchStatus = "failed"

  // Design status
  const design = await readDesignConsensus(name, files)

  // Live status (if run is active)
  const liveStatus = await readLiveStatus(name)

  // Overall status: combine research + design
  let status: RunStatus = "running"
  if (researchStatus === "approved" && (design?.outcome === "approved" || design?.outcome === "approved_with_caveats")) {
    status = "approved"
  } else if (researchStatus === "approved" && !design) {
    status = "approved" // research passed, no design phase
  } else if (researchStatus === "approved" && design?.outcome === "failed_non_convergent") {
    status = "failed"
  } else if (researchStatus === "failed") {
    status = "failed"
  } else if (researchStatus === "approved" && design) {
    status = "running" // research passed, design still running or pending
  }

  const topic =
    requestJson?.inputSummary?.title ??
    requestJson?.topic ??
    name

  // ── Counts for quick stats ──
  const draftCount = countByPattern(files, /^draft-round-\d+\.md$/)
  const auditCount = countByPattern(files, /^audits-round-\d+\.json$/)
  const aggregatedCount = countByPattern(files, /^aggregated-findings-round-\d+\.json$/)
  const rebuttalCount =
    countByPattern(files, /^auditor-rebuttal-responses-round-\d+-turn-\d+\.json$/) +
    countByPattern(files, /^drafter-rebuttal-review-round-\d+-turn-\d+\.json$/)
  const reviewCount = countByPattern(files, /^drafter-finding-review-round-\d+\.json$/)
  const designFilesCount = countByPattern(files, /^design-/)
  void designFilesCount

  const totalBytes = [...fileSizes.values()].reduce((a, b) => a + b, 0)

  // ── Quick stats dashboard ──
  let statsHtml = `<div class="run-stats-grid">
  <div class="run-stat">
    <div class="run-stat-value">${files.length}</div>
    <div class="run-stat-label">Files</div>
  </div>
  <div class="run-stat">
    <div class="run-stat-value">${formatBytes(totalBytes)}</div>
    <div class="run-stat-label">Total size</div>
  </div>`

  if (draftCount > 0) {
    statsHtml += `
  <div class="run-stat">
    <div class="run-stat-value">${draftCount}</div>
    <div class="run-stat-label">Drafts</div>
  </div>`
  }

  if (auditCount > 0) {
    statsHtml += `
  <div class="run-stat">
    <div class="run-stat-value">${auditCount}</div>
    <div class="run-stat-label">Audits</div>
  </div>`
  }

  if (rebuttalCount > 0) {
    statsHtml += `
  <div class="run-stat">
    <div class="run-stat-value">${rebuttalCount}</div>
    <div class="run-stat-label">Rebuttals</div>
  </div>`
  }

  if (reviewCount > 0) {
    statsHtml += `
  <div class="run-stat">
    <div class="run-stat-value">${reviewCount}</div>
    <div class="run-stat-label">Reviews</div>
  </div>`
  }

  if (aggregatedCount > 0) {
    statsHtml += `
  <div class="run-stat">
    <div class="run-stat-value">${aggregatedCount}</div>
    <div class="run-stat-label">Aggregations</div>
  </div>`
  }

  // Design file counts
  if (design && design.hasDesignFiles) {
    const designAuditCount = countByPattern(files, /^design-audits-round-\d+\.json$/)
    const designConsensusCount = countByPattern(files, /^design-consensus-round-\d+\.json$/)
    if (designAuditCount > 0) {
      statsHtml += `
  <div class="run-stat">
    <div class="run-stat-value">${designAuditCount}</div>
    <div class="run-stat-label">Design Audits</div>
  </div>`
    }
    if (designConsensusCount > 0) {
      statsHtml += `
  <div class="run-stat">
    <div class="run-stat-value">${designConsensusCount}</div>
    <div class="run-stat-label">Design Consensus</div>
  </div>`
    }
    statsHtml += `
  <div class="run-stat">
    <div class="run-stat-value">${design.unresolvedCount}</div>
    <div class="run-stat-label">Design Unresolved</div>
  </div>`
  }

  statsHtml += `</div>`

  // ── Phase timeline ──
  let phaseHtml = ""

  // Research phase
  let researchLabel = "running"
  let researchClass = "badge-running"
  if (researchStatus === "approved") {
    researchLabel = "approved"
    researchClass = "badge-approved"
  } else if (researchStatus === "failed") {
    researchLabel = "failed"
    researchClass = "badge-failed"
  }

  const maxRound = draftCount > 0 ? draftCount - 1 : 0
  const researchLine = `<div class="phase-row">
  <span class="badge ${researchClass}">Research: ${researchLabel}</span>
  <span class="phase-detail">${maxRound} round${maxRound !== 1 ? "s" : ""}, ${aggregatedCount} consensus</span>
</div>`

  // Design phase
  let designLine = ""
  if (design && design.hasDesignFiles) {
    let designLabel = design.outcome
    let designClass = "badge-running"
    if (design.outcome === "approved") {
      designLabel = "approved"
      designClass = "badge-approved"
    } else if (design.outcome === "approved_with_caveats") {
      designLabel = "approved with caveats"
      designClass = "badge-approved"
    } else if (design.outcome === "failed_non_convergent" || design.hasFailure) {
      designLabel = "failed"
      designClass = "badge-failed"
    } else if (design.outcome === "needs_revision") {
      designLabel = "needs revision"
      designClass = "badge-running"
    }

    const sevParts: string[] = []
    if (design.severityBreakdown.blocker) sevParts.push(`${design.severityBreakdown.blocker} blocker`)
    if (design.severityBreakdown.major) sevParts.push(`${design.severityBreakdown.major} major`)
    if (design.severityBreakdown.minor) sevParts.push(`${design.severityBreakdown.minor} minor`)
    const sevStr = sevParts.length > 0 ? ` (${sevParts.join(", ")} unresolved)` : ""

    designLine = `<div class="phase-row">
  <span class="badge ${designClass}">Design: ${designLabel}</span>
  <span class="phase-detail">round ${design.round}${sevStr}</span>
</div>`
  } else if (researchStatus === "approved" && !design) {
    // Research finished, design phase expected but no design files yet
    designLine = `<div class="phase-row">
  <span class="badge badge-running">Design: running…</span>
  <span class="phase-detail">waiting for design artifacts</span>
</div>`
  } else if (researchStatus === "approved" && design && !design.hasDesignFiles) {
    designLine = `<div class="phase-row">
  <span class="badge badge-running">Design: running…</span>
  <span class="phase-detail">generating HTML</span>
</div>`
  }

  if (researchLine || designLine) {
    phaseHtml = `<div class="section">
  <h2>Pipeline</h2>
  <div class="card stack-card stack-card-roomy">
    ${researchLine}
    ${designLine}
  </div>
</div>`
  }

  // ── Design summary card ──
  let designSummaryHtml = ""
  if (design && design.hasDesignFiles) {
    const designOutcomeLabel = design.outcome === "approved" ? "Approved"
      : design.outcome === "approved_with_caveats" ? "Approved with caveats"
      : design.outcome === "failed_non_convergent" ? "Failed"
      : design.outcome === "needs_revision" ? "Needs revision"
      : design.outcome
    const designOutcomeClass = design.outcome === "approved" ? "approved"
      : design.outcome === "approved_with_caveats" ? "approved"
      : design.outcome === "failed_non_convergent" ? "failed"
      : "needs-revision"

    const sevRows: string[] = []
    if (design.severityBreakdown.blocker) sevRows.push(`<tr><td><span class="danger-text">Blocker</span></td><td>${design.severityBreakdown.blocker}</td></tr>`)
    if (design.severityBreakdown.major) sevRows.push(`<tr><td><span class="running-text">Major</span></td><td>${design.severityBreakdown.major}</td></tr>`)
    if (design.severityBreakdown.minor) sevRows.push(`<tr><td><span class="muted-text">Minor</span></td><td>${design.severityBreakdown.minor}</td></tr>`)

    designSummaryHtml = `<div class="section">
  <h2>Design Quorum</h2>
  <div class="structured-card">
    <div class="outcome-banner ${escapeHtml(designOutcomeClass)}">${designOutcomeLabel}</div>
    <table class="summary-table">
      <tr><td>Round</td><td>${design.round}</td></tr>
      <tr><td>Unresolved findings</td><td>${design.unresolvedCount}${design.outcome === "approved_with_caveats" ? " minor caveat(s)" : ""}</td></tr>
      ${sevRows.join("\n")}
      ${design.hasFinalHtml ? `<tr><td>Final HTML</td><td>final.html ready</td></tr>` : ""}
      ${design.hasFailure ? `<tr><td>Error</td><td class="danger-text">design-failure.json</td></tr>` : ""}
    </table>
  </div>
</div>`
  }

  // ── Hero: final.html ──
  let heroHtml = ""
  if (hasFinalHtml) {
    heroHtml = `<div class="card">
  <div class="row-inline card-compact">
    <h2 class="title-reset">Final rendered page</h2>
  </div>
  <a class="hero-link" href="/runs/${encodeURIComponent(name)}/raw/final.html" target="_blank" rel="noopener">
    Open final.html →
  </a>
</div>`
  }

  // ── Key output file links (prominent quick-access) ──
  let keyOutputsHtml = ""
  const keyLinks: string[] = []

  if (hasFinalMd) {
    const sz = fileSizes.get("final.md") ?? 0
    keyLinks.push(`<a class="hero-link" href="/runs/${encodeURIComponent(name)}/raw/final.md">
  View final.md — approved draft (${formatBytes(sz)})
</a>`)
  }
  if (hasLatestDraft) {
    const sz = fileSizes.get("latest-draft.md") ?? 0
    keyLinks.push(`<a class="hero-link" href="/runs/${encodeURIComponent(name)}/raw/latest-draft.md">
  View latest-draft.md — failed run (${formatBytes(sz)})
</a>`)
  }
  if (hasFailureJson) {
    keyLinks.push(`<a class="hero-link" href="/runs/${encodeURIComponent(name)}/raw/failure.json">
  View failure.json — error details
</a>`)
  }

  // Design outputs
  if (design && design.hasDesignFiles) {
    const latestDesignConsensus = files
      .filter((f) => /^design-consensus-round-\d+\.json$/.test(f))
      .sort()
      .pop()
    if (latestDesignConsensus) {
      keyLinks.push(`<a class="hero-link" href="/runs/${encodeURIComponent(name)}/raw/${encodeURIComponent(latestDesignConsensus)}">
  View ${latestDesignConsensus} — outcome: ${design.outcome}
</a>`)
    }
  }

  if (keyLinks.length > 0) {
    keyOutputsHtml = `<div class="section">
  <h2>Key outputs</h2>
  ${keyLinks.join("\n")}
</div>`
  }

  // ── Request info (collapsed by default) ──
  let requestInfoHtml = ""
  if (requestJson) {
    requestInfoHtml = `<div class="section">
  <h2>Request metadata</h2>
  <div class="card">
    ${renderJsonCard(requestJson, { defaultOpen: false })}
  </div>
</div>`
  }

  const fileListHtml = renderFileBrowser({ runName: name, files, fileSizes })

  // ── Assemble body ──
  const inputModeLabel = requestJson?.inputMode
    ? `<span class="meta-item">Input: <strong>${escapeHtml(requestJson.inputMode)}</strong></span>`
    : ""

  const pipelineHtml = renderLivePipeline(liveStatus, files, researchStatus, name)
  const agentActivityHtml = renderAgentActivity(liveStatus)
  const nodeHistoryHtml = renderNodeHistory(liveStatus, name)
  const debugLogHtml = await renderDebugLog(name, files)
  const failureBannerHtml = await renderFailureBanner(name, files, liveStatus)
  const runNavHtml = await renderRunNav(name)
  const interviewChatHtml = renderInterviewChatCard(name, liveStatus)

  const extraHead = ""  // Background poll handles refresh

  // Wrap dynamic sections with IDs for background polling
  const pipelineSection = `<div id="pipeline-section">${pipelineHtml}</div>`
  const agentActivitySection = `<div id="agent-activity-section">${agentActivityHtml}</div>`
  const nodeHistorySection = `<div id="node-history-section">${nodeHistoryHtml}</div>`
  const debugLogSection = `<div id="debug-log-section">${debugLogHtml}</div>`
  const failureBannerSection = `<div id="failure-banner-section">${failureBannerHtml}</div>`
  const interviewChatSection = `<div id="interview-chat-section">${interviewChatHtml}</div>`
  const markdownSection = ""
  const statsSection = `<div id="stats-section">${statsHtml}</div>`
  const heroSection = `<div id="hero-section">${heroHtml}</div>`
  const keyOutputsSection = `<div id="key-outputs-section">${keyOutputsHtml}</div>`
  const phaseSection = `<div id="phase-section">${phaseHtml}</div>`
  const designSummarySection = `<div id="design-summary-section">${designSummaryHtml}</div>`
  const filesSection = `<div id="files-section"><div class="section">
  <h2>All files</h2>
  ${fileListHtml}
</div></div>`

  const body = `
${runNavHtml}
<a class="back-link" href="/">← Back to runs</a>
${liveStatus?.phase === "running" ? `<div class="refresh-controls">
  <span id="refresh-dot" class="refresh-dot" aria-hidden="true"></span>
  <span id="refresh-status">Polling every 8s</span>
  <button type="button" class="refresh-button" data-refresh-now>Refresh now</button>
</div>` : ""}
${interviewChatSection}
<div class="header-bar">
  <div class="header-main">
    <h1>${escapeHtml(topic)}</h1>
    <div class="meta-row">
      <span class="meta-item">${badge(status)}</span>
      <span class="meta-item">ID: <strong>${escapeHtml(requestJson?.requestId ?? name)}</strong></span>
      ${inputModeLabel}
    </div>
  </div>
</div>

${failureBannerSection}
${pipelineSection}
${agentActivitySection}
${nodeHistorySection}
${debugLogSection}
${markdownSection}
${statsSection}
${phaseSection}
${designSummarySection}
${heroSection}
${keyOutputsSection}
${requestInfoHtml}
${filesSection}
${liveStatus?.phase === "running" ? POLLING_SCRIPT : ""}`

  const html = layout(`${escapeHtml(topic)} — quorum run`, body, extraHead)

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

// ---------------------------------------------------------------------------
// Route: GET /runs/:name/raw/*
// ---------------------------------------------------------------------------

export async function serveRawFile(
  runName: string,
  filePath: string,
  searchParams: URLSearchParams,
): Promise<Response> {
  let resolved: string
  try {
    resolved = safeFilePath(runName, filePath)
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Not found", { status: 404 })
  }

  let file: ReturnType<typeof Bun.file>
  try {
    file = Bun.file(resolved)
    if (!(await file.exists())) {
      return new Response("File not found", { status: 404 })
    }
  } catch {
    return new Response("File not found", { status: 404 })
  }

  const ext = filePath.split(".").pop()?.toLowerCase()

  // For .md files, render formatted HTML by default; ?source=1 gives raw markdown
  if (ext === "md" && searchParams.get("source") !== "1") {
    const rawContent = await file.text()
    const htmlBody = `<div class="md-content">${renderMarkdown(rawContent)}</div>`
    const baseName = basename(filePath)
    const html = layout(
      `${baseName} — ${escapeHtml(runName)}`,
      `
<a class="back-link" href="/runs/${encodeURIComponent(runName)}">← Back to run</a>
<p class="muted-note source-note">
  <a href="/runs/${encodeURIComponent(runName)}/raw/${encodeURIComponent(filePath)}?source=1">View raw source</a>
</p>
${htmlBody}`,
    )
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  }

  // For .json files, render a structured page by type
  if (ext === "json" && searchParams.get("source") !== "1") {
    const rawContent = await file.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(rawContent)
    } catch {
      parsed = rawContent
    }
    const baseName = basename(filePath)
    const structuredHtml = typeof parsed === "object" && parsed !== null
      ? renderStructuredJson(baseName, parsed)
      : renderJsonCard(parsed, { defaultOpen: true })

    const html = layout(
      `${baseName} — ${escapeHtml(runName)}`,
      `
<a class="back-link" href="/runs/${encodeURIComponent(runName)}">← Back to run</a>
<div class="row-inline page-title">
  <h2 class="title-reset">${escapeHtml(baseName)}</h2>
  <a href="/runs/${encodeURIComponent(runName)}/raw/${encodeURIComponent(filePath)}?source=1" class="muted-note">View raw source</a>
</div>
${structuredHtml}
`,
    )
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  }

  const ct = contentType(filePath)
  const headers: Record<string, string> = { "content-type": ct }
  if (ct.startsWith("text/")) {
    headers["content-type"] = ct.includes("charset") ? ct : `${ct}; charset=utf-8`
  }

  return new Response(file, { headers })
}
