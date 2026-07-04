import { stat } from "node:fs/promises"
import { basename, join } from "node:path"
import { POLLING_SCRIPT, NODE_REFRESH_SCRIPT, ROUND_REFRESH_SCRIPT, FILES_REFRESH_SCRIPT, INDEX_REFRESH_SCRIPT } from "./client-script"
import { renderRefreshControls } from "./refresh-controls"
import { renderNewRunForm, NEW_RUN_FORM_SCRIPT } from "./new-run-form"
import { renderOpencodeBootstrapBanner } from "./opencode-bootstrap-view"
import { renderRunControlsSection, renderNodeControlsSection, renderRunCompletionBanner, resolveRunResumeActions, resolveRunVerdict } from "./run-controls"
import { tryGetRunManager } from "../run-manager"
import { renderStructuredJson } from "./artifact-renderers"
import { renderJsonViewer } from "./json-viewer"
import { renderAgentActivity, renderFailureBanner, renderInterviewChatCard, renderLivePipeline, renderNodeHistory } from "./components"
import { computeStats, getRunFiles, listRuns, readLiveStatus, readNodeHistory } from "./data"
import { getNodeDefinition } from "./node-registry"
import { renderNodeDashboard, renderNodeExecutionHistory, renderNodeGrid, renderNodeMiniPipeline } from "./node-view"
import { renderLiveStatusMeta, renderRoundDetailPage, renderRoundStrip } from "./round-view"
import { renderRunTelemetryStrip, resolveRunTelemetry, runElapsedMs } from "./telemetry-view"
import { renderFileBrowser } from "./file-browser"
import { listHtmlReaderAskThreads } from "./html-ask-store"
import { listHtmlReaderHighlights } from "./html-highlights-store"
import { getHtmlReaderNotes } from "./html-notes-store"
import { renderHtmlViewerPage } from "./html-viewer"
import { tableWrap } from "./html"
import { renderDebugLogHtml, type DebugLogEntry } from "./debug-log-viewer"
import { appNavbarAction } from "./app-nav"
import { badge, formatRelative, layout } from "./layout"
import { getRunsDir, resolveRunName, safeFilePath, safeRunPath } from "./paths"
import { STAR_SCRIPT } from "./star-script"
import { isRunStarred } from "./starred-store"
import { contentType, escapeHtml, formatBytes, formatElapsed, formatUsagePair, renderJsonCard, renderMarkdown, statusDot } from "./utils"
import type { RequestJson, RunStatus } from "./types"

function renderStarButton(runName: string, starred: boolean): string {
  const activeClass = starred ? " star-button-active" : ""
  const label = starred ? "Unstar run" : "Star run"
  return `<button type="button" class="star-button${activeClass}" data-star-toggle data-run-name="${escapeHtml(runName)}" data-starred="${starred ? "true" : "false"}" aria-pressed="${starred ? "true" : "false"}" aria-label="${label}">★</button>`
}

async function canonicalRunResponse(
  runName: string,
  suffix = "",
): Promise<{ runName: string; early?: Response }> {
  const resolved = await resolveRunName(runName)
  if (!resolved) return { runName, early: new Response("Not found", { status: 404 }) }
  if (resolved !== runName) {
    return {
      runName: resolved,
      early: new Response(null, {
        status: 302,
        headers: { Location: `/runs/${encodeURIComponent(resolved)}${suffix}` },
      }),
    }
  }
  return { runName: resolved }
}

export async function renderNodePage(runName: string, nodeName: string): Promise<Response> {
  const canonical = await canonicalRunResponse(
    runName,
    `/node/${encodeURIComponent(nodeName)}`,
  )
  if (canonical.early) return canonical.early
  runName = canonical.runName

  try {
    safeRunPath(runName)
  } catch {
    return new Response("Not found", { status: 404 })
  }

  const def = getNodeDefinition(nodeName)
  if (!def && !getNodeDefinition(nodeName.replace(/Prompt|Resume$/, ""))) {
    return new Response(`Unknown node "${escapeHtml(nodeName)}"`, { status: 404 })
  }

  let files: string[] = []
  try {
    files = await getRunFiles(runName)
  } catch {
    return new Response("Cannot read run directory", { status: 500 })
  }

  const fileSizes = await getFileSizes(runName, files)
  const liveStatus = await readLiveStatus(runName)
  const nodeHistory = await readNodeHistory(runName)
  const displayName = def?.label ?? nodeName
  const { body: dashboardBody, live: dashboardLive } = await renderNodeDashboard(runName, nodeName, files, fileSizes, liveStatus, nodeHistory)
  const historyHtml = renderNodeExecutionHistory(nodeHistory, nodeName, runName)
  const miniPipeline = renderNodeMiniPipeline(runName, nodeName, files)
  const showLiveRefresh = liveStatus?.phase === "running"
  const hasFinalMd = files.includes("final.md")
  const isRunning = liveStatus?.phase === "running"
  const runActiveGlobally = Boolean(tryGetRunManager()?.status().active)
  const nodeControlsHtml = renderNodeControlsSection({
    runName,
    nodeName,
    showRetry: !isRunning && !hasFinalMd,
    runActiveGlobally,
  })

  const html = `${showLiveRefresh ? renderRefreshControls() : ""}
${nodeControlsHtml}
<div class="header-bar">
  <h1>${escapeHtml(displayName)}</h1>
  <p class="muted-note dim-text">Run: ${escapeHtml(runName)} · ${escapeHtml(nodeName)}</p>
</div>
${miniPipeline}
<div id="node-live-section">${dashboardLive}</div>
<div id="node-dashboard-section">${dashboardBody}</div>
<div id="node-history-section">${historyHtml}</div>
${showLiveRefresh ? NODE_REFRESH_SCRIPT : ""}`

  const fullHtml = layout(`Node: ${displayName} — ${escapeHtml(runName)}`, html, {
    navbar: {
      section: "runs",
      back: { href: `/runs/${encodeURIComponent(runName)}`, label: "← Back to run" },
      title: displayName,
    },
  })
  return new Response(fullHtml, {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function renderRoundPage(runName: string, roundNum: number): Promise<Response> {
  const canonical = await canonicalRunResponse(runName, `/round/${roundNum}`)
  if (canonical.early) return canonical.early
  runName = canonical.runName

  try {
    safeRunPath(runName)
  } catch {
    return new Response("Not found", { status: 404 })
  }

  let files: string[] = []
  try {
    files = await getRunFiles(runName)
  } catch {
    return new Response("Cannot read run directory", { status: 500 })
  }

  const fileSizes = await getFileSizes(runName, files)
  const liveStatus = await readLiveStatus(runName)
  const body = await renderRoundDetailPage(runName, roundNum, files, fileSizes, liveStatus)
  const showLiveRefresh = liveStatus?.phase === "running"

  const html = layout(`Round ${roundNum} — ${escapeHtml(runName)}`, `${showLiveRefresh ? renderRefreshControls() : ""}
<div id="round-detail-section">${body}</div>
${showLiveRefresh ? ROUND_REFRESH_SCRIPT : ""}`, {
    navbar: {
      section: "runs",
      back: { href: `/runs/${encodeURIComponent(runName)}`, label: "← Back to run" },
      title: `Round ${roundNum}`,
    },
  })

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function renderFilesPage(runName: string): Promise<Response> {
  const canonical = await canonicalRunResponse(runName, "/files")
  if (canonical.early) return canonical.early
  runName = canonical.runName

  try {
    safeRunPath(runName)
  } catch {
    return new Response("Not found", { status: 404 })
  }

  let files: string[] = []
  try {
    files = await getRunFiles(runName)
  } catch {
    return new Response("Cannot read run directory", { status: 500 })
  }

  const fileSizes = await getFileSizes(runName, files)
  const liveStatus = await readLiveStatus(runName)
  const fileListHtml = renderFileBrowser({ runName, files, fileSizes })
  const showLiveRefresh = liveStatus?.phase === "running"

  const html = layout(`Files — ${escapeHtml(runName)}`, `${showLiveRefresh ? renderRefreshControls() : ""}
<div id="files-section" class="section">
  <h1 class="page-title">All files</h1>
  ${fileListHtml}
</div>
${showLiveRefresh ? FILES_REFRESH_SCRIPT : ""}`, {
    navbar: {
      section: "runs",
      back: { href: `/runs/${encodeURIComponent(runName)}`, label: "← Back to run" },
      title: "All files",
    },
  })

  return new Response(html, {
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

  const entries: DebugLogEntry[] = []
  for (const line of raw.split("\n")) {
    try { entries.push(JSON.parse(line) as DebugLogEntry) } catch { /* skip malformed lines */ }
  }

  if (entries.length === 0) return ""

  return `<div class="section">
  <h2>Debug log</h2>
  ${renderDebugLogHtml([...entries].reverse())}
</div>`
}

// ---------------------------------------------------------------------------
// Route: GET /
// ---------------------------------------------------------------------------

export async function renderIndex(searchParams = new URLSearchParams()): Promise<Response> {
  const showStarredOnly = searchParams.get("starred") === "1"
  const runError = searchParams.get("error") ?? undefined
  let runs = await listRuns()
  if (showStarredOnly) {
    runs = runs.filter((run) => run.starred)
  }
  const stats = computeStats(runs)

  const manager = tryGetRunManager()
  const managerStatus = manager?.status()
  const runActive = Boolean(managerStatus?.active)

  let bootstrapHtml = ""
  try {
    bootstrapHtml = await renderOpencodeBootstrapBanner()
  } catch {
    // Index renders in test fixtures without a full config tree.
  }

  const newRunHtml = renderNewRunForm({
    runActive,
    activeRunId: managerStatus?.active?.runId,
    error: runError,
  })

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
    const nodeHistory = await readNodeHistory(run.name)
    const elapsedMs = runElapsedMs(liveStatus, nodeHistory)
    const elapsed = elapsedMs !== undefined ? formatElapsed(elapsedMs) : ""
    const { usage, usageAvailable, costAvailable } = resolveRunTelemetry(liveStatus, nodeHistory)
    const usageLabel = usageAvailable || costAvailable ? ` · ${formatUsagePair(usage, true)}` : ""
    const agentList = Object.entries(liveStatus.agents)
      .slice(0, 4)
      .map(([name, a]) => `${statusDot(a.status)} ${escapeHtml(name)}${a.tool ? ` · ${escapeHtml(a.tool)}` : ""}`)
      .join(" · ")
    activeRunHtml = `<div class="card active-run-hero">
  <div class="active-run-header">
    <span class="badge badge-running">● Active</span>
  </div>
  <div class="active-run-topic">
    <a href="/runs/${encodeURIComponent(run.name)}">${escapeHtml(run.topic)}</a>
  </div>
  <div class="active-run-pipeline">
    ${escapeHtml(liveStatus.node ?? "running")} · Round ${liveStatus.round}/${liveStatus.maxRounds} · ${escapeHtml(elapsed)}${escapeHtml(usageLabel)}
  </div>
  ${agentList ? `<div class="active-run-agents">${agentList}</div>` : ""}
</div>`
    break
  }

  // Run cards
  let runCards = ""
  if (runs.length === 0) {
    runCards = showStarredOnly
      ? `<div class="empty-state">No starred runs yet. <a href="/">Show all runs</a></div>`
      : `<div class="empty-state">No runs found in <code>${escapeHtml(getRunsDir())}</code></div>`
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
    ${renderStarButton(run.name, run.starred)}
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

  const filterHtml = `<div class="run-filters">
  <a href="/"${showStarredOnly ? "" : ' class="active"'}>All</a>
  <a href="/?starred=1"${showStarredOnly ? ' class="active"' : ""}>Starred</a>
</div>`

  const body = `
<h1 class="page-title">Runs</h1>
${filterHtml}
${bootstrapHtml}
${newRunHtml}
${statsHtml}
${hasActiveRun ? renderRefreshControls() : ""}
<div id="index-active-section">${activeRunHtml}</div>
<div id="run-card-list">${runCards}</div>
${STAR_SCRIPT}
${NEW_RUN_FORM_SCRIPT}
${hasActiveRun ? INDEX_REFRESH_SCRIPT : ""}`

  const html = layout("Runs — quorum", body, { navbar: { section: "runs" } })
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

export async function readDesignSummary(_runName: string, files: string[]): Promise<{
  status: "approved" | "failed" | "running"
  round: number
  hasFinalHtml: boolean
  hasDesignFiles: boolean
  hasFailure: boolean
} | null> {
  const designHtmlFiles = files
    .filter((f) => /^design-html-round-\d+\.html$/.test(f))
    .sort()

  const hasFinalHtml = files.includes("final.html")
  const hasFailure = files.includes("design-failure.json")
  if (designHtmlFiles.length === 0 && !hasFinalHtml && !hasFailure) {
    return null
  }

  const latest = designHtmlFiles[designHtmlFiles.length - 1]
  const roundMatch = latest?.match(/round-(\d+)/)
  const round = roundMatch ? parseInt(roundMatch[1]) : 0
  return {
    status: hasFailure ? "failed" : hasFinalHtml ? "approved" : "running",
    round,
    hasFinalHtml,
    hasDesignFiles: designHtmlFiles.length > 0 || hasFinalHtml,
    hasFailure,
  }
}

// ---------------------------------------------------------------------------
// Route: GET /runs/:name
// ---------------------------------------------------------------------------

export async function renderRun(name: string): Promise<Response> {
  const canonical = await canonicalRunResponse(name)
  if (canonical.early) return canonical.early
  name = canonical.runName

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
  const design = await readDesignSummary(name, files)

  // Live status (if run is active)
  const liveStatus = await readLiveStatus(name)

  // Overall status: combine research + design
  let status: RunStatus = "running"
  if (researchStatus === "approved" && design?.status === "approved") {
    status = "approved"
  } else if (researchStatus === "approved" && !design) {
    status = "approved" // research passed, no design phase
  } else if (researchStatus === "approved" && design?.status === "failed") {
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

  const starred = await isRunStarred(name)

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

  if (design && design.hasDesignFiles) {
    const designHtmlCount = countByPattern(files, /^design-html-round-\d+\.html$/)
    statsHtml += `
  <div class="run-stat">
    <div class="run-stat-value">${designHtmlCount}</div>
    <div class="run-stat-label">Design HTML</div>
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
    let designLabel = design.status
    let designClass = "badge-running"
    if (design.status === "approved") {
      designLabel = "approved"
      designClass = "badge-approved"
    } else if (design.status === "failed" || design.hasFailure) {
      designLabel = "failed"
      designClass = "badge-failed"
    }

    designLine = `<div class="phase-row">
  <span class="badge ${designClass}">Design: ${designLabel}</span>
  <span class="phase-detail">HTML generation${design.hasFinalHtml ? ", final.html ready" : ""}</span>
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
    const designOutcomeLabel = design.status === "approved" ? "Approved"
      : design.status === "failed" ? "Failed"
      : "Running"
    const designOutcomeClass = design.status === "approved" ? "approved"
      : design.status === "failed" ? "failed"
      : "needs-revision"

    designSummaryHtml = `<div class="section">
  <h2>Design</h2>
  <div class="structured-card">
    <div class="outcome-banner ${escapeHtml(designOutcomeClass)}">${designOutcomeLabel}</div>
    ${tableWrap(`<table class="summary-table">
      <tr><td>HTML drafts</td><td>${countByPattern(files, /^design-html-round-\d+\.html$/)}</td></tr>
      ${design.hasFinalHtml ? `<tr><td>Final HTML</td><td>final.html ready</td></tr>` : ""}
      ${design.hasFailure ? `<tr><td>Error</td><td class="danger-text">design-failure.json</td></tr>` : ""}
    </table>`)}
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
    const latestDesignHtml = files
      .filter((f) => /^design-html-round-\d+\.html$/.test(f))
      .sort()
      .pop()
    if (latestDesignHtml) {
      keyLinks.push(`<a class="hero-link" href="/runs/${encodeURIComponent(name)}/raw/${encodeURIComponent(latestDesignHtml)}">
  View ${latestDesignHtml} — design draft
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

  const nodeHistory = await readNodeHistory(name)
  const pipelineHtml = renderLivePipeline(liveStatus, files, researchStatus, name, nodeHistory)
  const agentActivityHtml = renderAgentActivity(liveStatus)
  const nodeHistoryHtml = renderNodeHistory(nodeHistory, name)
  const roundStripHtml = await renderRoundStrip(name, files, liveStatus)
  const nodeGridHtml = renderNodeGrid(name, files, liveStatus, researchStatus, nodeHistory)
  const liveMetaHtml = renderLiveStatusMeta(liveStatus)
  const telemetryHtml = renderRunTelemetryStrip(liveStatus, nodeHistory)
  const debugLogHtml = await renderDebugLog(name, files)
  const failureBannerHtml = await renderFailureBanner(name, files, liveStatus)
  const interviewChatHtml = renderInterviewChatCard(name, liveStatus)

  const isRunning = liveStatus?.phase === "running"
  const runActiveGlobally = Boolean(tryGetRunManager()?.status().active)
  const showCompletion = liveStatus && (liveStatus.phase === "complete" || liveStatus.phase === "error")
  const verdict = resolveRunVerdict({
    researchStatus: researchStatus,
    designStatus: design?.status ?? null,
    liveError: liveStatus?.phase === "error" ? liveStatus.error : undefined,
    hasFailureJson,
  })
  const resumeActions = resolveRunResumeActions({
    isRunning,
    hasFinalMd,
    hasFinalHtml,
    designStatus: design?.status ?? null,
  })
  const runControlsHtml = renderRunControlsSection({
    runName: name,
    isRunning,
    showCompletion: Boolean(showCompletion),
    completionHtml: showCompletion
      ? renderRunCompletionBanner({
        errored: verdict.errored,
        verdictText: verdict.verdictText,
        outputDir: dirPath,
      })
      : "",
    resumeActions,
    runActiveGlobally,
  })

  const filesLinkSection = `<div class="section"><p><a href="/runs/${encodeURIComponent(name)}/files">Browse all ${files.length} files →</a></p></div>`

  const telemetrySection = `<div id="telemetry-section">${telemetryHtml}</div>`
  const pipelineSection = `<div id="pipeline-section">${pipelineHtml}</div>`
  const agentActivitySection = `<div id="agent-activity-section">${agentActivityHtml}</div>`
  const nodeHistorySection = `<div id="node-history-section">${nodeHistoryHtml}</div>`
  const roundStripSection = `<div id="round-strip-section">${roundStripHtml}</div>`
  const nodeGridSection = `<div id="node-grid-section">${nodeGridHtml}</div>`
  const debugLogSection = `<div id="debug-log-section">${debugLogHtml}</div>`
  const failureBannerSection = `<div id="failure-banner-section">${failureBannerHtml}</div>`
  const interviewChatSection = `<div id="interview-chat-section">${interviewChatHtml}</div>`
  const markdownSection = ""
  const statsSection = `<div id="stats-section">${statsHtml}</div>`
  const heroSection = `<div id="hero-section">${heroHtml}</div>`
  const keyOutputsSection = `<div id="key-outputs-section">${keyOutputsHtml}</div>`
  const phaseSection = `<div id="phase-section">${phaseHtml}</div>`
  const designSummarySection = `<div id="design-summary-section">${designSummaryHtml}</div>`
  const filesSection = `<div id="files-section">${filesLinkSection}</div>`

  const inputModeLabel = requestJson?.inputMode
    ? `<span class="meta-item">Input: <strong>${escapeHtml(requestJson.inputMode)}</strong></span>`
    : ""

  const extraHead = ""

  const body = `
${isRunning ? renderRefreshControls() : ""}
${runControlsHtml}
${interviewChatSection}
<div class="header-bar">
  <div class="header-main">
    <div class="header-title-row">
      ${renderStarButton(name, starred)}
      <h1>${escapeHtml(topic)}</h1>
    </div>
    <div class="meta-row">
      <span class="meta-item">${badge(status)}</span>
      <span class="meta-item">ID: <strong>${escapeHtml(requestJson?.requestId ?? name)}</strong></span>
      ${inputModeLabel}
      ${liveMetaHtml}
    </div>
  </div>
</div>

${failureBannerSection}
${telemetrySection}
${pipelineSection}
${roundStripSection}
${agentActivitySection}
${nodeGridSection}
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
${STAR_SCRIPT}
${isRunning ? POLLING_SCRIPT : ""}`

  const html = layout(`${escapeHtml(topic)} — quorum run`, body, {
    extraHead,
    navbar: {
      section: "runs",
      back: { href: "/", label: "← Back to runs" },
      title: topic,
    },
  })

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
    const runHref = `/runs/${encodeURIComponent(runName)}`
    const sourceHref = `${runHref}/raw/${encodeURIComponent(filePath)}?source=1`
    const html = layout(`${baseName} — ${escapeHtml(runName)}`, htmlBody, {
      navbar: {
        section: "runs",
        back: { href: runHref, label: "← Back to run" },
        title: baseName,
        actionsHtml: appNavbarAction(sourceHref, "View raw source"),
      },
    })
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  }

  // For .html files, render viewer shell by default; ?source=1 gives raw bytes for iframe/download
  if ((ext === "html" || ext === "htm") && searchParams.get("source") !== "1") {
    const notes = await getHtmlReaderNotes(runName, filePath)
    const highlights = await listHtmlReaderHighlights(runName, filePath)
    const askThreads = await listHtmlReaderAskThreads(runName, filePath)
    const html = renderHtmlViewerPage(runName, filePath, notes, highlights, askThreads)
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  }

  if ((ext === "html" || ext === "htm") && searchParams.get("source") === "1") {
    const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" }
    if (searchParams.get("download") === "1") {
      headers["content-disposition"] = `attachment; filename="${basename(filePath).replace(/"/g, "")}"`
    }
    return new Response(file, { headers })
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
      : renderJsonViewer(parsed)

    const runHref = `/runs/${encodeURIComponent(runName)}`
    const sourceHref = `${runHref}/raw/${encodeURIComponent(filePath)}?source=1`
    const html = layout(`${baseName} — ${escapeHtml(runName)}`, structuredHtml, {
      navbar: {
        section: "runs",
        back: { href: runHref, label: "← Back to run" },
        title: baseName,
        actionsHtml: appNavbarAction(sourceHref, "View raw source"),
      },
    })
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
