import { readdir, stat } from "node:fs/promises"
import { join, resolve, basename } from "node:path"
import { marked } from "marked"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RUNS_DIR = resolve(import.meta.dirname, "..", "runs")
const PORT = parseInt(process.env.VIEW_PORT ?? "3000", 10)
const HOST = process.env.VIEW_HOST ?? "0.0.0.0"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RunStatus = "approved" | "failed" | "running"

interface RunMeta {
  name: string
  topic: string
  status: RunStatus
  mtime: number
  roundCount: number
  hasFinalHtml: boolean
  hasFinalMd: boolean
  hasLatestDraft: boolean
  fileCount: number
}

interface RunStats {
  total: number
  approved: number
  failed: number
  running: number
}

interface RequestJson {
  requestId?: string
  inputMode?: string
  topic?: string
  inputSummary?: { title?: string; summary?: string }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SQLITE_RX = /\.sqlite\b/

function isSqliteFile(name: string): boolean {
  return SQLITE_RX.test(name)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function contentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "html":
    case "htm":
      return "text/html; charset=utf-8"
    case "json":
      return "application/json; charset=utf-8"
    case "md":
      return "text/markdown; charset=utf-8"
    case "css":
      return "text/css; charset=utf-8"
    case "js":
      return "text/javascript; charset=utf-8"
    case "svg":
      return "image/svg+xml"
    default:
      return "text/plain; charset=utf-8"
  }
}

function escapeHtmlLight(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function renderJsonBlock(data: unknown): string {
  try {
    return escapeHtml(JSON.stringify(data, null, 2))
  } catch {
    return escapeHtml(String(data))
  }
}

/**
 * Render a JSON value as a structured, collapsible block.
 * If the JSON is an object with a small set of top-level keys, extract a
 * human-readable summary line.  Otherwise just show "N entries".
 */
function renderJsonCard(
  data: unknown,
  opts?: { defaultOpen?: boolean; maxPreviewKeys?: number },
): string {
  const maxPreviewKeys = opts?.maxPreviewKeys ?? 6
  const defaultOpen = opts?.defaultOpen ?? false

  let parsed: unknown
  try {
    parsed = typeof data === "string" ? JSON.parse(data) : data
  } catch {
    return `<pre class="json-block"><code>${escapeHtml(String(data))}</code></pre>`
  }

  // Build a one-line summary for the <summary> tag
  let summaryText = ""
  if (Array.isArray(parsed)) {
    summaryText = `${parsed.length} item${parsed.length !== 1 ? "s" : ""}`
  } else if (parsed && typeof parsed === "object") {
    const keys = Object.keys(parsed)
    const shown = keys.slice(0, maxPreviewKeys)
    const parts = shown.map((k) => {
      const v = (parsed as Record<string, unknown>)[k]
      if (typeof v === "string" && v.length > 60) {
        return `${k}: ${JSON.stringify(v.slice(0, 57) + "…")}`
      }
      return `${k}: ${JSON.stringify(v)}`
    })
    summaryText = parts.join(" · ")
    if (keys.length > maxPreviewKeys) {
      summaryText += ` · … +${keys.length - maxPreviewKeys} more`
    }
  } else {
    summaryText = JSON.stringify(parsed)
  }

  const openAttr = defaultOpen ? " open" : ""
  const formatted = JSON.stringify(parsed, null, 2)

  return `<details class="json-details"${openAttr}>
  <summary class="json-summary">${escapeHtmlLight(summaryText)}</summary>
  <pre class="json-block"><code>${escapeHtml(formatted)}</code></pre>
</details>`
}

function renderMarkdown(src: string): string {
  try {
    return marked.parse(src, { async: false }) as string
  } catch {
    return `<pre><code>${escapeHtml(src)}</code></pre>`
  }
}

// ---------------------------------------------------------------------------
// Structured JSON renderers — type-specific HTML for each artifact
// ---------------------------------------------------------------------------

interface AuditFinding {
  severity: string
  category: string
  issue: string
  evidence: string[]
  required_fix: string
  findingId: string
  agent?: string
}

interface AuditRecord {
  agent: string
  vote: string
  summary: string
  findings: AuditFinding[]
}

interface AggregatedFindings {
  outcome: string
  approvedAgents: string[]
  unresolvedFindings: AuditFinding[]
  failureReason?: string
}

interface RebuttalEntry {
  findingId: string
  position: string
  argument: string
  evidence: string[]
  requestedResolution: string
}

interface RebuttalResponseEntry {
  findingId: string
  decision: string
  argument: string
  agent: string
  turn: number
  updatedFinding?: Partial<AuditFinding>
}

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "approved": return "✅ Approved"
    case "needs_revision": return "🔧 Needs revision"
    case "failed_non_convergent": return "❌ Failed (non-convergent)"
    default: return `📋 ${outcome}`
  }
}

function outcomeClass(outcome: string): string {
  if (outcome === "approved") return "approved"
  if (outcome === "failed_non_convergent") return "failed"
  return "needs-revision"
}

function renderFindingRow(f: AuditFinding, compact?: boolean): string {
  const fixHtml = !compact && f.required_fix
    ? `<div class="finding-required-fix">🔧 ${escapeHtml(f.required_fix)}</div>`
    : ""

  const evidenceHtml = !compact && f.evidence && f.evidence.length > 0
    ? `<details class="finding-evidence">
  <summary>📚 Evidence (${f.evidence.length} source${f.evidence.length !== 1 ? "s" : ""})</summary>
  <ul>${f.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>
</details>`
    : ""

  const agentHtml = f.agent
    ? `<div class="finding-agent">👤 ${escapeHtml(f.agent)}</div>`
    : ""

  return `<div class="finding">
  <div class="finding-header">
    <span class="finding-severity ${escapeHtml(f.severity)}">${escapeHtml(f.severity)}</span>
    <span class="finding-category">${escapeHtml(f.category)}</span>
    <span class="finding-issue">${escapeHtml(f.issue)}</span>
  </div>
  ${fixHtml}
  ${evidenceHtml}
  ${agentHtml}
</div>`
}

// ── request.json ──

function renderRequestCard(data: unknown): string {
  const d = data as Record<string, unknown>
  const rows: string[] = []
  if (d.requestId) rows.push(`<tr><td>Request ID</td><td><code>${escapeHtml(String(d.requestId))}</code></td></tr>`)
  if (d.inputMode) rows.push(`<tr><td>Input mode</td><td>${escapeHtml(String(d.inputMode))}</td></tr>`)
  if (d.topic) rows.push(`<tr><td>Topic</td><td>${escapeHtml(String(d.topic))}</td></tr>`)
  if (d.documentPath) rows.push(`<tr><td>Document</td><td><code>${escapeHtml(String(d.documentPath))}</code></td></tr>`)
  if (d.inputSummary && typeof d.inputSummary === "object") {
    const s = d.inputSummary as Record<string, unknown>
    if (s.title) rows.push(`<tr><td>Title</td><td>${escapeHtml(String(s.title))}</td></tr>`)
  }
  return `<div class="structured-card">
  <div class="auditor-header">📋 Request</div>
  <table class="summary-table">${rows.join("")}</table>
</div>`
}

// ── summary.json ──

function renderSummaryCard(data: unknown): string {
  const d = data as Record<string, unknown>
  const outcome = String(d.outcome ?? "unknown")
  const rebuttalCount = Object.keys((d.rebuttalTurnCounts as object) ?? {}).length

  const withdrawn = Array.isArray(d.rebuttalResponseHistory)
    ? (d.rebuttalResponseHistory as Array<{ response?: { decision?: string } }>).filter(
        (e) => e?.response?.decision === "withdraw",
      ).length
    : 0

  const rows: string[] = []
  if (d.round !== undefined) rows.push(`<tr><td>Rounds</td><td>${d.round}</td></tr>`)
  if (Array.isArray(d.approvedAgents)) {
    const agents = (d.approvedAgents as string[]).join(", ")
    rows.push(`<tr><td>Approved</td><td>${escapeHtml(agents) || "—"} (${(d.approvedAgents as string[]).length})</td></tr>`)
  }
  if (Array.isArray(d.unresolvedFindings)) {
    rows.push(`<tr><td>Unresolved</td><td>${(d.unresolvedFindings as unknown[]).length} findings</td></tr>`)
  }
  if (rebuttalCount > 0) {
    rows.push(`<tr><td>Rebuttals</td><td>${rebuttalCount} finding(s), ${withdrawn} withdrawn</td></tr>`)
  }

  return `<div class="structured-card">
  <div class="outcome-banner ${outcomeClass(outcome)}">${outcomeLabel(outcome)}</div>
  <table class="summary-table">${rows.join("")}</table>
</div>`
}

// ── audits-round-N.json ──

function renderAuditRound(filename: string, data: unknown, isDesign?: boolean): string {
  const audits = data as AuditRecord[]
  if (!Array.isArray(audits)) return renderJsonCard(data, { defaultOpen: true })

  const roundMatch = filename.match(/round-(\d+)/)
  const roundLabel = roundMatch ? `Round ${roundMatch[1]}` : ""
  const phaseIcon = isDesign ? "🎨" : "🔍"
  const phaseLabel = isDesign ? "Design Audits" : "Audits"

  let html = `<div class="section"><h2>${phaseIcon} ${phaseLabel} — ${roundLabel} (${audits.length} auditor${audits.length !== 1 ? "s" : ""})</h2>`

  for (const audit of audits) {
    const voteIcon = audit.vote === "approve" ? "✅" : "❌"
    const totalFindings = audit.findings?.length ?? 0

    html += `<div class="structured-card">
  <div class="auditor-header">
    <span>👤 ${escapeHtml(audit.agent)}</span>
    <span class="auditor-vote ${escapeHtml(audit.vote)}">${voteIcon} ${audit.vote}${totalFindings > 0 ? ` · ${totalFindings} finding${totalFindings !== 1 ? "s" : ""}` : ""}</span>
  </div>`

    if (audit.summary) {
      html += `<div style="padding:0.55rem 0.85rem;font-size:0.78rem;color:var(--muted);border-bottom:1px solid var(--border);">${escapeHtml(audit.summary)}</div>`
    }

    for (const f of audit.findings ?? []) {
      html += renderFindingRow(f)
    }

    html += `</div>`
  }

  html += `</div>`
  return html
}

// ── aggregated-findings-round-N.json ──

function renderConsensusCard(filename: string, data: unknown, isDesign?: boolean): string {
  const d = data as AggregatedFindings
  if (!d || typeof d !== "object") return renderJsonCard(data, { defaultOpen: true })

  const roundMatch = filename.match(/round-(\d+)/)
  const roundLabel = roundMatch ? `Round ${roundMatch[1]}` : ""
  const phaseIcon = isDesign ? "🎨" : "📊"
  const phaseLabel = isDesign ? "Design Consensus" : "Consensus"
  const totalAuditors = (d.approvedAgents?.length ?? 0) + (d.unresolvedFindings?.length ?? 0) > 0
    ? (d.approvedAgents?.length ?? 0) + new Set((d.unresolvedFindings ?? []).map((f) => f.agent)).size
    : 0

  let html = `<div class="section"><h2>${phaseIcon} ${phaseLabel} — ${roundLabel}</h2>
<div class="structured-card">
  <div class="outcome-banner ${outcomeClass(d.outcome)}">${outcomeLabel(d.outcome)}</div>`

  // Summary rows
  const rows: string[] = []
  if (d.approvedAgents?.length > 0) {
    rows.push(`<tr><td>Approved</td><td>${escapeHtml(d.approvedAgents.join(", "))} (${d.approvedAgents.length})</td></tr>`)
  }
  if (d.unresolvedFindings?.length > 0) {
    rows.push(`<tr><td>Unresolved</td><td>${d.unresolvedFindings.length} finding${d.unresolvedFindings.length !== 1 ? "s" : ""}</td></tr>`)
  }
  if (d.failureReason) {
    rows.push(`<tr><td>Failure reason</td><td><code>${escapeHtml(d.failureReason)}</code></td></tr>`)
  }
  if (rows.length > 0) {
    html += `<div style="padding:0.55rem 0.85rem;"><table class="summary-table">${rows.join("")}</table></div>`
  }

  // Unresolved findings list
  if (d.unresolvedFindings?.length > 0) {
    for (const f of d.unresolvedFindings) {
      html += renderFindingRow(f, true)
    }
  }

  html += `</div></div>`
  return html
}

// ── drafter-finding-review-round-N.json ──

function renderDrafterReview(filename: string, data: unknown): string {
  const d = data as { acceptedFindingIds?: string[]; rebuttals?: RebuttalEntry[] }
  if (!d || typeof d !== "object") return renderJsonCard(data, { defaultOpen: true })

  const roundMatch = filename.match(/round-(\d+)/)
  const roundLabel = roundMatch ? `Round ${roundMatch[1]}` : ""
  const accepted = d.acceptedFindingIds ?? []
  const rebuttals = d.rebuttals ?? []

  let html = `<div class="section"><h2>👀 Drafter Review — ${roundLabel}</h2>
<div class="structured-card">`

  // Accepted
  html += `<div class="review-section">
  <h4>✅ Accepted (${accepted.length} finding${accepted.length !== 1 ? "s" : ""})</h4>`
  if (accepted.length > 0) {
    html += `<div style="display:flex;flex-wrap:wrap;gap:0.25rem 0.5rem;">`
    for (const id of accepted.slice(0, 30)) {
      html += `<code style="font-size:0.65rem;background:var(--code-bg);padding:0.1rem 0.3rem;border-radius:3px;">${escapeHtml(id.slice(-40))}</code>`
    }
    if (accepted.length > 30) html += `<span style="font-size:0.7rem;color:var(--muted);">… +${accepted.length - 30} more</span>`
    html += `</div>`
  } else {
    html += `<div style="font-size:0.75rem;color:var(--muted);">None</div>`
  }
  html += `</div>`

  // Rebutted
  html += `<div class="review-section">
  <h4>🗣️ Rebutted (${rebuttals.length} finding${rebuttals.length !== 1 ? "s" : ""})</h4>`
  if (rebuttals.length > 0) {
    for (const r of rebuttals) {
      html += `<div class="rebuttal-entry">
  <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.25rem;">
    <code style="font-size:0.65rem;">${escapeHtml(r.findingId.slice(-40))}</code>
    <span class="rebuttal-decision ${escapeHtml(r.requestedResolution)}">${escapeHtml(r.requestedResolution)}</span>
  </div>
  <div class="rebuttal-speaker">Drafter</div>
  <div class="rebuttal-text">${escapeHtml(r.argument)}</div>
  ${r.evidence && r.evidence.length > 0 ? `<details class="finding-evidence" style="margin-top:0.25rem;"><summary>📚 Evidence (${r.evidence.length})</summary><ul>${r.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul></details>` : ""}
</div>`
    }
  } else {
    html += `<div style="font-size:0.75rem;color:var(--muted);">None</div>`
  }
  html += `</div>`

  html += `</div></div>`
  return html
}

// ── auditor-rebuttal-responses-round-N-turn-M.json ──

function renderRebuttalResponses(filename: string, data: unknown): string {
  const d = data as Record<string, RebuttalResponseEntry>
  if (!d || typeof d !== "object") return renderJsonCard(data, { defaultOpen: true })

  const roundMatch = filename.match(/round-(\d+)/)
  const roundLabel = roundMatch ? `Round ${roundMatch[1]}` : ""
  const turnMatch = filename.match(/turn-(\d+)/)
  const turnLabel = turnMatch ? `Turn ${turnMatch[1]}` : ""
  const entries = Object.entries(d)

  let html = `<div class="section"><h2>💬 Rebuttal Responses — ${roundLabel}${turnLabel ? ", " + turnLabel : ""} (${entries.length} finding${entries.length !== 1 ? "s" : ""})</h2>
<div class="structured-card">`

  for (const [findingId, response] of entries) {
    const decisionLabel =
      response.decision === "withdraw" ? "✅ WITHDREW" :
      response.decision === "soften" ? "🔽 SOFTENED" :
      "✗ UPHELD"

    html += `<div class="rebuttal-entry">
  <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.3rem;">
    <code style="font-size:0.65rem;">${escapeHtml(findingId.slice(-40))}</code>
    <span class="rebuttal-decision ${escapeHtml(response.decision)}">${decisionLabel}</span>
    <span style="font-size:0.65rem;color:var(--muted);">👤 ${escapeHtml(response.agent)}</span>
  </div>
  <div class="rebuttal-speaker">Auditor response</div>
  <div class="rebuttal-text">${escapeHtml(response.argument)}</div>`

    if (response.updatedFinding) {
      html += `<div style="margin-top:0.4rem;padding:0.4rem 0.6rem;background:var(--code-bg);border-radius:var(--radius-sm);">
  <div style="font-size:0.68rem;font-weight:600;color:var(--muted);margin-bottom:0.2rem;">Updated finding:</div>`
      html += renderFindingRow({ ...response.updatedFinding, findingId, evidence: [], required_fix: response.updatedFinding.required_fix ?? "" } as AuditFinding, true)
      html += `</div>`
    }

    html += `</div>`
  }

  html += `</div></div>`
  return html
}

// ── Dispatcher ──

function renderStructuredJson(filename: string, data: unknown): string {
  if (filename === "request.json") return renderRequestCard(data)
  if (filename === "summary.json") return renderSummaryCard(data)
  if (/^audits-round-\d+\.json$/.test(filename)) return renderAuditRound(filename, data)
  if (/^aggregated-findings-round-\d+\.json$/.test(filename)) return renderConsensusCard(filename, data)
  if (/^drafter-finding-review-round-\d+\.json$/.test(filename)) return renderDrafterReview(filename, data)
  if (/^auditor-rebuttal-responses-round-\d+-turn-\d+\.json$/.test(filename)) return renderRebuttalResponses(filename, data)
  if (/^design-audits-round-\d+\.json$/.test(filename)) return renderAuditRound(filename, data, true)
  if (/^design-consensus-round-\d+\.json$/.test(filename)) return renderConsensusCard(filename, data, true)
  return renderJsonCard(data, { defaultOpen: true })
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

function safeRunPath(runName: string): string {
  const resolved = resolve(RUNS_DIR, runName)
  if (!resolved.startsWith(RUNS_DIR + "/") && resolved !== RUNS_DIR) {
    throw new Error("Path traversal blocked")
  }
  return resolved
}

function safeFilePath(runName: string, filePath: string): string {
  const runDir = safeRunPath(runName)
  const clean = filePath.replace(/^\/+/, "")
  const resolved = resolve(runDir, clean)
  if (!resolved.startsWith(runDir + "/") && resolved !== runDir) {
    throw new Error("Path traversal blocked")
  }
  if (isSqliteFile(basename(resolved))) {
    throw new Error("Sqlite files blocked")
  }
  return resolved
}

// ---------------------------------------------------------------------------
// Data gathering
// ---------------------------------------------------------------------------

async function listRuns(): Promise<RunMeta[]> {
  const entries = await readdir(RUNS_DIR, { withFileTypes: true })
  const dirs = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith(".") && !isSqliteFile(e.name),
  )

  const metas: RunMeta[] = []

  for (const dir of dirs) {
    const dirPath = join(RUNS_DIR, dir.name)
    let requestJson: RequestJson | null = null
    let roundCount = 0
    let hasFinalHtml = false
    let hasFinalMd = false
    let hasLatestDraft = false
    let fileCount = 0
    let mtime = 0

    try {
      const dirStat = await stat(dirPath)
      mtime = dirStat.mtimeMs

      const files = await readdir(dirPath)
      fileCount = files.filter((f) => !isSqliteFile(f) && f !== ".gitkeep").length

      for (const file of files) {
        if (file === "request.json") {
          requestJson = await Bun.file(join(dirPath, file)).json() as RequestJson
        }
        if (file.startsWith("draft-round-") && file.endsWith(".md")) {
          roundCount = Math.max(roundCount, parseInt(file.match(/round-(\d+)/)?.[1] ?? "0") + 1)
        }
        if (file === "final.html") hasFinalHtml = true
        if (file === "final.md") hasFinalMd = true
        if (file === "latest-draft.md") hasLatestDraft = true
      }
    } catch {
      continue
    }

    const topic =
      requestJson?.inputSummary?.title ??
      requestJson?.topic ??
      dir.name

    let status: RunStatus = "running"
    if (hasFinalMd) status = "approved"
    else if (hasLatestDraft) status = "failed"

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
    })
  }

  metas.sort((a, b) => b.mtime - a.mtime)
  return metas
}

function computeStats(runs: RunMeta[]): RunStats {
  return {
    total: runs.length,
    approved: runs.filter((r) => r.status === "approved").length,
    failed: runs.filter((r) => r.status === "failed").length,
    running: runs.filter((r) => r.status === "running").length,
  }
}

async function getRunFiles(runName: string): Promise<string[]> {
  const dirPath = safeRunPath(runName)
  const files = await readdir(dirPath)
  return files
    .filter((f) => !isSqliteFile(f) && f !== ".gitkeep")
    .sort()
}

// ---------------------------------------------------------------------------
// JSON-aware summaries
// ---------------------------------------------------------------------------

/**
 * Try to extract a human-readable label from a JSON artifact file
 * (e.g. "3 findings · outcome: needs_revision") without re-reading
 * the full file — used only when the file is loaded later.
 */
function classifyFile(filename: string): { group: string; icon: string } {
  if (filename === "request.json") return { group: "Metadata", icon: "📋" }
  if (filename === "summary.json") return { group: "Metadata", icon: "📊" }
  if (filename === "failure.json") return { group: "Metadata", icon: "💥" }
  if (filename === "final.md") return { group: "Final Outputs", icon: "✅" }
  if (filename === "latest-draft.md") return { group: "Final Outputs", icon: "❌" }
  if (filename === "final.html") return { group: "Final Outputs", icon: "🏆" }
  if (/^design-audits-round-\d+\.json$/.test(filename)) return { group: "Design", icon: "🎨" }
  if (/^design-consensus-round-\d+\.json$/.test(filename)) return { group: "Design", icon: "🎨" }
  if (/^design-html-round-\d+\.html$/.test(filename)) return { group: "Design", icon: "🎨" }
  if (filename === "design-failure.json") return { group: "Design", icon: "🎨" }
  if (/^draft-round-\d+\.md$/.test(filename)) return { group: "Drafts", icon: "📝" }
  if (/^audits-round-\d+\.json$/.test(filename)) return { group: "Audits", icon: "🔍" }
  if (/^drafter-finding-review-round-\d+\.json$/.test(filename)) return { group: "Drafter Reviews", icon: "👀" }
  if (/^auditor-rebuttal-responses-round-\d+-turn-\d+\.json$/.test(filename)) return { group: "Rebuttal Responses", icon: "💬" }
  if (/^drafter-rebuttal-review-round-\d+-turn-\d+\.json$/.test(filename)) return { group: "Rebuttal Reviews", icon: "🔁" }
  if (/^aggregated-findings-round-\d+\.json$/.test(filename)) return { group: "Aggregated Findings", icon: "📊" }
  return { group: "Other", icon: "📎" }
}

// ---------------------------------------------------------------------------
// CSS  (mobile-first: base = narrow phone, then min-width breakpoints)
// ---------------------------------------------------------------------------

const CSS = /* css */ `
/* ── Reset & variables ── */
:root {
  --bg: #fafafa;
  --fg: #1a1a1a;
  --bg-card: #ffffff;
  --border: #e5e5e5;
  --accent: #2563eb;
  --accent-dim: #dbeafe;
  --green: #16a34a;
  --green-bg: #dcfce7;
  --red: #dc2626;
  --red-bg: #fee2e2;
  --orange: #ea580c;
  --orange-bg: #fff7ed;
  --muted: #6b7280;
  --code-bg: #f3f4f6;
  --radius: 8px;
  --radius-sm: 4px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1117;
    --fg: #e4e4e7;
    --bg-card: #181a1f;
    --border: #272a30;
    --accent: #60a5fa;
    --accent-dim: #1e3050;
    --green: #4ade80;
    --green-bg: #14532d;
    --red: #f87171;
    --red-bg: #7f1d1d;
    --orange: #fb923c;
    --orange-bg: #7c2d12;
    --muted: #9ca3af;
    --code-bg: #0d1016;
  }
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.6;
  -webkit-text-size-adjust: 100%;
}

/* ── Layout (mobile-first: narrow) ── */
body {
  padding: 1rem 0.75rem;
}

h1 { font-size: 1.25rem; font-weight: 700; }
h2 { font-size: 1.1rem; font-weight: 600; margin-top: 1.25rem; margin-bottom: 0.5rem; }
h3 { font-size: 0.95rem; font-weight: 600; margin-top: 1rem; margin-bottom: 0.25rem; color: var(--muted); }

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ── Badges ── */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  white-space: nowrap;
}
.badge-approved { background: var(--green-bg); color: var(--green); }
.badge-failed   { background: var(--red-bg);   color: var(--red); }
.badge-running  { background: var(--orange-bg); color: var(--orange); }

/* ── Cards ── */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  margin-bottom: 0.75rem;
}

/* ── Stats dashboard ── */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  text-align: center;
}
.stat-card .stat-value {
  font-size: 1.5rem;
  font-weight: 800;
  line-height: 1.2;
}
.stat-card .stat-label {
  font-size: 0.7rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 0.15rem;
}
.stat-total  .stat-value { color: var(--accent); }
.stat-approved .stat-value { color: var(--green); }
.stat-failed  .stat-value { color: var(--red); }
.stat-running .stat-value { color: var(--orange); }

/* ── Run cards (index) ── */
.run-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.run-card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.5rem;
}
.run-card-title {
  font-weight: 600;
  font-size: 0.95rem;
  line-height: 1.3;
  word-break: break-word;
  flex: 1;
}
.run-card-title a {
  color: var(--fg);
  text-decoration: none;
}
.run-card-title a:hover { color: var(--accent); text-decoration: underline; }
.run-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.75rem;
  font-size: 0.75rem;
  color: var(--muted);
}
.run-card-meta span {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}

/* ── Run detail header ── */
.header-bar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.header-bar h1 {
  font-size: 1.15rem;
  word-break: break-word;
}
.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
}
.meta-item {
  color: var(--muted);
  font-size: 0.78rem;
}
.meta-item strong { color: var(--fg); font-weight: 600; }

/* ── Back link ── */
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
  color: var(--muted);
}
.back-link:hover { color: var(--accent); }

/* ── JSON details (collapsible) ── */
.json-details {
  margin: 0.25rem 0;
}
.json-summary {
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--muted);
  padding: 0.4rem 0.5rem;
  border-radius: var(--radius-sm);
  user-select: none;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.json-summary::-webkit-details-marker { display: none; }
.json-summary::before {
  content: "▸";
  display: inline-block;
  font-size: 0.7rem;
  transition: transform 0.15s;
  color: var(--muted);
}
details[open] > .json-summary::before {
  transform: rotate(90deg);
}
.json-summary:hover {
  background: var(--code-bg);
}
.json-block {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.75rem;
  margin-top: 0.25rem;
  overflow-x: auto;
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 60vh;
  overflow-y: auto;
}

/* ── Pre / code ── */
pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.75rem;
  overflow-x: auto;
  font-size: 0.78rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
code {
  font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", Menlo, monospace;
  font-size: 0.85em;
}

/* ── Hero link ── */
.hero-link {
  display: block;
  background: var(--accent-dim);
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  padding: 0.75rem 1rem;
  text-align: center;
  font-weight: 600;
  font-size: 0.9rem;
  margin: 0.5rem 0;
}

/* ── File list (grouped) ── */
.file-group {
  margin-bottom: 0.75rem;
}
.file-group-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  padding: 0.25rem 0;
  margin-bottom: 0.15rem;
}
.file-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.file-list li a {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 0.78rem;
  padding: 0.25rem 0.4rem;
  border-radius: var(--radius-sm);
}
.file-list li a:hover {
  background: var(--accent-dim);
  text-decoration: none;
}

/* ── Section spacing ── */
.section { margin-top: 1.25rem; }

/* ── Empty state ── */
.empty-state {
  text-align: center;
  color: var(--muted);
  padding: 3rem 1rem;
  font-size: 0.9rem;
}

/* ── Phase timeline ── */
.phase-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.phase-detail {
  font-size: 0.78rem;
  color: var(--muted);
}

/* ── Quick stats (run detail) ── */
.run-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.4rem;
  margin-bottom: 1rem;
}
.run-stat {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.5rem 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.run-stat-value {
  font-size: 1.1rem;
  font-weight: 750;
  line-height: 1.2;
  color: var(--fg);
}
.run-stat-label {
  font-size: 0.65rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
@media (min-width: 640px) {
  .run-stats-grid { grid-template-columns: repeat(3, 1fr); }
}
@media (min-width: 1024px) {
  .run-stats-grid { grid-template-columns: repeat(4, 1fr); }
}

/* ── Markdown rendered content ── */
.md-content { word-break: break-word; }
.md-content h1 { font-size: 1.2rem; margin: 1rem 0 0.4rem; padding-bottom: 0.25rem; border-bottom: 1px solid var(--border); }
.md-content h2 { font-size: 1.05rem; margin: 0.9rem 0 0.35rem; }
.md-content h3 { font-size: 0.95rem; margin: 0.8rem 0 0.25rem; color: var(--fg); }
.md-content h4 { font-size: 0.88rem; margin: 0.7rem 0 0.2rem; }
.md-content h5, .md-content h6 { font-size: 0.82rem; margin: 0.6rem 0 0.2rem; color: var(--muted); }
.md-content p { margin: 0.4rem 0; }
.md-content ul, .md-content ol { margin: 0.4rem 0; padding-left: 1.25rem; }
.md-content li { margin: 0.1rem 0; }
.md-content blockquote {
  border-left: 3px solid var(--accent);
  padding: 0.2rem 0.6rem;
  margin: 0.4rem 0;
  color: var(--muted);
  background: var(--code-bg);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
.md-content code {
  background: var(--code-bg);
  padding: 0.1rem 0.25rem;
  border-radius: 3px;
  font-size: 0.85em;
}
.md-content pre { margin: 0.4rem 0; }
.md-content pre code { background: none; padding: 0; border-radius: 0; font-size: 0.82rem; }
.md-content a { color: var(--accent); }
.md-content hr { border: none; border-top: 1px solid var(--border); margin: 0.8rem 0; }
.md-content table { margin: 0.4rem 0; font-size: 0.8rem; width: 100%; border-collapse: collapse; }
.md-content th, .md-content td { padding: 0.3rem 0.5rem; text-align: left; border-bottom: 1px solid var(--border); }
.md-content th { color: var(--muted); font-weight: 600; }
.md-content img { max-width: 100%; height: auto; }
.md-content strong { font-weight: 600; }
.md-content input[type="checkbox"] { margin-right: 0.3rem; }

/* ── Structured JSON cards ── */
.structured-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.structured-card + .structured-card { margin-top: 0.75rem; }

/* Outcome banner */
.outcome-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 0.85rem;
  font-weight: 700;
  font-size: 0.9rem;
  border-radius: var(--radius-sm);
}
.outcome-banner.approved { background: var(--green-bg); color: var(--green); }
.outcome-banner.needs-revision { background: var(--orange-bg); color: var(--orange); }
.outcome-banner.failed { background: var(--red-bg); color: var(--red); }

/* Auditor header */
.auditor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.55rem 0.85rem;
  border-bottom: 1px solid var(--border);
  font-weight: 600;
  font-size: 0.85rem;
}
.auditor-vote {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.auditor-vote.approve { color: var(--green); }
.auditor-vote.revise { color: var(--red); }

/* Finding row */
.finding {
  padding: 0.55rem 0.85rem;
  border-bottom: 1px solid var(--border);
}
.finding:last-child { border-bottom: none; }
.finding-header {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  margin-bottom: 0.3rem;
}
.finding-severity {
  flex-shrink: 0;
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  white-space: nowrap;
}
.finding-severity.blocker { background: var(--red-bg); color: var(--red); }
.finding-severity.major  { background: var(--orange-bg); color: var(--orange); }
.finding-severity.minor  { background: var(--code-bg); color: var(--muted); }
.finding-category {
  flex-shrink: 0;
  font-size: 0.65rem;
  color: var(--muted);
  font-weight: 500;
}
.finding-issue {
  font-size: 0.82rem;
  font-weight: 600;
  word-break: break-word;
  flex: 1;
}
.finding-required-fix {
  font-size: 0.75rem;
  color: var(--muted);
  margin-top: 0.2rem;
  padding-left: 0.2rem;
  border-left: 2px solid var(--accent);
}
.finding-evidence {
  margin-top: 0.3rem;
}
.finding-evidence summary {
  cursor: pointer;
  font-size: 0.7rem;
  color: var(--muted);
  font-weight: 600;
}
.finding-evidence ul {
  margin: 0.25rem 0 0 1.2rem;
  font-size: 0.72rem;
  color: var(--muted);
  list-style: disc;
}
.finding-evidence li { margin-bottom: 0.15rem; word-break: break-word; }
.finding-agent {
  font-size: 0.65rem;
  color: var(--muted);
  font-weight: 400;
  margin-top: 0.15rem;
}

/* Summary card */
.summary-table {
  width: 100%;
  font-size: 0.82rem;
}
.summary-table td {
  padding: 0.3rem 0.6rem;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.summary-table td:first-child {
  color: var(--muted);
  font-weight: 500;
  white-space: nowrap;
  width: 1%;
}
.summary-table tr:last-child td { border-bottom: none; }

/* Drafter review card */
.review-section {
  padding: 0.55rem 0.85rem;
  border-bottom: 1px solid var(--border);
}
.review-section:last-child { border-bottom: none; }
.review-section h4 {
  font-size: 0.78rem;
  font-weight: 700;
  margin-bottom: 0.3rem;
  color: var(--fg);
}
.review-item {
  font-size: 0.75rem;
  padding: 0.2rem 0;
  color: var(--muted);
  display: flex;
  gap: 0.35rem;
}
.review-item .mono {
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 0.68rem;
}

/* Rebuttal card */
.rebuttal-entry {
  padding: 0.55rem 0.85rem;
  border-bottom: 1px solid var(--border);
}
.rebuttal-entry:last-child { border-bottom: none; }
.rebuttal-decision {
  display: inline-block;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  margin: 0.25rem 0;
}
.rebuttal-decision.withdraw { background: var(--green-bg); color: var(--green); }
.rebuttal-decision.uphold  { background: var(--red-bg); color: var(--red); }
.rebuttal-decision.soften  { background: var(--orange-bg); color: var(--orange); }
.rebuttal-speaker {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 0.15rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.rebuttal-text {
  font-size: 0.8rem;
  line-height: 1.45;
  word-break: break-word;
}

/* ── Tablet & up ── */
@media (min-width: 640px) {
  body {
    padding: 1.5rem 1.25rem;
    max-width: 960px;
    margin: 0 auto;
  }
  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.25rem; }
  .stats-grid { grid-template-columns: repeat(4, 1fr); gap: 0.75rem; }
  .stat-card { padding: 1rem; }
  .stat-card .stat-value { font-size: 2rem; }
  .run-card {
    padding: 0.85rem 1rem;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
  }
  .run-card-top { flex: 1; }
  .run-card-title { font-size: 1rem; }
  .run-card-meta { justify-content: flex-end; }
  .header-bar { flex-direction: row; justify-content: space-between; align-items: flex-start; }
  .header-bar h1 { font-size: 1.35rem; }
  .file-group { margin-bottom: 1rem; }
}

/* ── Desktop ── */
@media (min-width: 1024px) {
  body { padding: 2rem 1.5rem; }
  .card { padding: 1rem 1.25rem; }
  .json-block { font-size: 0.8rem; }
  .md-content h1 { font-size: 1.4rem; }
  .md-content h2 { font-size: 1.2rem; }
  .md-content h3 { font-size: 1.05rem; }
}
`

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function layout(title: string, body: string, extraHead = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
${extraHead}
</head>
<body>
${body}
</body>
</html>`
}

function badge(status: RunStatus): string {
  const cls =
    status === "approved" ? "badge-approved" :
    status === "failed" ? "badge-failed" :
    "badge-running"
  return `<span class="badge ${cls}">${status}</span>`
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(ms)
}

// ---------------------------------------------------------------------------
// Route: GET /
// ---------------------------------------------------------------------------

async function renderIndex(): Promise<Response> {
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

  // Run cards
  let runCards = ""
  if (runs.length === 0) {
    runCards = `<div class="empty-state">No runs found in <code>${escapeHtml(RUNS_DIR)}</code></div>`
  } else {
    for (const run of runs) {
      const roundLabel =
        run.roundCount > 0
          ? `<span>🔄 ${run.roundCount} round${run.roundCount !== 1 ? "s" : ""}</span>`
          : ""
      const icons: string[] = []
      if (run.hasFinalHtml) icons.push("🏆")
      const iconsStr = icons.length ? " " + icons.join(" ") : ""

      runCards += `<div class="run-card">
  <div class="run-card-top">
    <div class="run-card-title">
      <a href="/runs/${encodeURIComponent(run.name)}">${escapeHtml(run.topic)}${iconsStr}</a>
    </div>
    ${badge(run.status)}
  </div>
  <div class="run-card-meta">
    ${roundLabel}
    <span>📄 ${run.fileCount} file${run.fileCount !== 1 ? "s" : ""}</span>
    <span>🕐 ${formatRelative(run.mtime)}</span>
    <span style="font-size:0.7rem;opacity:0.6">${escapeHtml(run.name.slice(-12))}</span>
  </div>
</div>`
    }
  }

  const body = `
<h1 style="margin-bottom:0.75rem;">📋 Runs</h1>
${statsHtml}
${runCards}`

  const html = layout("Runs — quorum", body)
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

// ---------------------------------------------------------------------------
// Run detail helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function countByPattern(files: string[], pattern: RegExp): number {
  return files.filter((f) => pattern.test(f)).length
}

async function getFileSizes(runName: string, files: string[]): Promise<Map<string, number>> {
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

async function readDesignConsensus(runName: string, files: string[]): Promise<{
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

async function renderRun(name: string): Promise<Response> {
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

  // Overall status
  let status: RunStatus = researchStatus
  let statusLabel = researchStatus
  if (researchStatus === "approved" && design && !design.hasFinalHtml && design.outcome !== "approved") {
    // Research approved but design is still pending/failed
    statusLabel = "approved" // keep green badge
  }
  if (researchStatus === "failed") status = "failed"

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

  statsHtml += `</div>`

  // ── Phase timeline ──
  let phaseHtml = ""

  // Research phase
  let researchIcon = "🔄"
  let researchLabel = "running"
  let researchClass = "badge-running"
  if (researchStatus === "approved") {
    researchIcon = "✅"
    researchLabel = "approved"
    researchClass = "badge-approved"
  } else if (researchStatus === "failed") {
    researchIcon = "❌"
    researchLabel = "failed"
    researchClass = "badge-failed"
  }

  const maxRound = draftCount > 0 ? draftCount - 1 : 0
  const researchLine = `<div class="phase-row">
  <span class="badge ${researchClass}">${researchIcon} Research: ${researchLabel}</span>
  <span class="phase-detail">${maxRound} round${maxRound !== 1 ? "s" : ""}, ${aggregatedCount} consensus</span>
</div>`

  // Design phase
  let designLine = ""
  if (design && design.hasDesignFiles) {
    let designIcon = "🔄"
    let designLabel = design.outcome
    let designClass = "badge-running"
    if (design.outcome === "approved" || design.hasFinalHtml) {
      designIcon = "✅"
      designLabel = "approved"
      designClass = "badge-approved"
    } else if (design.outcome === "failed_non_convergent" || design.hasFailure) {
      designIcon = "❌"
      designLabel = "failed"
      designClass = "badge-failed"
    } else if (design.outcome === "needs_revision") {
      designIcon = "🔧"
      designLabel = "needs revision"
      designClass = "badge-running"
    }

    const sevParts: string[] = []
    if (design.severityBreakdown.blocker) sevParts.push(`${design.severityBreakdown.blocker} blocker`)
    if (design.severityBreakdown.major) sevParts.push(`${design.severityBreakdown.major} major`)
    if (design.severityBreakdown.minor) sevParts.push(`${design.severityBreakdown.minor} minor`)
    const sevStr = sevParts.length > 0 ? ` (${sevParts.join(", ")} unresolved)` : ""

    designLine = `<div class="phase-row">
  <span class="badge ${designClass}">${designIcon} Design: ${designLabel}</span>
  <span class="phase-detail">round ${design.round}${sevStr}</span>
</div>`
  } else if (researchStatus === "approved") {
    designLine = `<div class="phase-row">
  <span class="badge" style="background:var(--code-bg);color:var(--muted);">⏳ Design: not started</span>
</div>`
  }

  if (researchLine || designLine) {
    phaseHtml = `<div class="section">
  <h2>📊 Pipeline</h2>
  <div class="card" style="display:flex;flex-direction:column;gap:0.5rem;">
    ${researchLine}
    ${designLine}
  </div>
</div>`
  }

  // ── Hero: final.html ──
  let heroHtml = ""
  if (hasFinalHtml) {
    heroHtml = `<div class="card">
  <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
    <span style="font-size:1.25rem;">🏆</span>
    <h2 style="margin:0;">Final rendered page</h2>
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
  ✅ View final.md — approved draft (${formatBytes(sz)})
</a>`)
  }
  if (hasLatestDraft) {
    const sz = fileSizes.get("latest-draft.md") ?? 0
    keyLinks.push(`<a class="hero-link" href="/runs/${encodeURIComponent(name)}/raw/latest-draft.md">
  ❌ View latest-draft.md — failed run (${formatBytes(sz)})
</a>`)
  }
  if (hasFailureJson) {
    keyLinks.push(`<a class="hero-link" href="/runs/${encodeURIComponent(name)}/raw/failure.json">
  💥 View failure.json — error details
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
  🎨 View ${latestDesignConsensus} — outcome: ${design.outcome}
</a>`)
    }
  }

  if (keyLinks.length > 0) {
    keyOutputsHtml = `<div class="section">
  <h2>🔑 Key outputs</h2>
  ${keyLinks.join("\n")}
</div>`
  }

  // ── Request info (collapsed by default) ──
  let requestInfoHtml = ""
  if (requestJson) {
    requestInfoHtml = `<div class="section">
  <h2>📋 Request metadata</h2>
  <div class="card">
    ${renderJsonCard(requestJson, { defaultOpen: false })}
  </div>
</div>`
  }

  // ── File listing (grouped, the main content) ──
  const groups = new Map<string, Array<{ name: string; icon: string }>>()
  for (const f of files) {
    const { group, icon } = classifyFile(f)
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push({ name: f, icon })
  }

  const groupOrder = [
    "Final Outputs",
    "Metadata",
    "Drafts",
    "Audits",
    "Drafter Reviews",
    "Rebuttal Responses",
    "Rebuttal Reviews",
    "Aggregated Findings",
    "Design",
    "Other",
  ]

  let fileListHtml = ""
  for (const groupName of groupOrder) {
    const items = groups.get(groupName)
    if (!items || items.length === 0) {
      // Show empty state for expected groups (not "Other")
      if (groupName !== "Other") {
        fileListHtml += `<div class="file-group">
  <div class="file-group-title">${groupName} <span style="font-weight:400;opacity:0.4;">(none)</span></div>
</div>`
      }
      continue
    }
    const itemsHtml = items
      .map((item) => {
        const sz = fileSizes.get(item.name) ?? 0
        const szStr = sz > 0 ? ` <span style="opacity:0.5;font-size:0.7rem;">${formatBytes(sz)}</span>` : ""
        return `<li><a href="/runs/${encodeURIComponent(name)}/raw/${encodeURIComponent(item.name)}">${item.icon} ${escapeHtml(item.name)}${szStr}</a></li>`
      })
      .join("")
    fileListHtml += `<div class="file-group">
  <div class="file-group-title">${groupName} <span style="font-weight:400;opacity:0.6;">(${items.length})</span></div>
  <ul class="file-list">${itemsHtml}</ul>
</div>`
  }

  // ── Assemble body ──
  const inputModeLabel = requestJson?.inputMode
    ? `<span class="meta-item">Input: <strong>${escapeHtml(requestJson.inputMode)}</strong></span>`
    : ""

  const body = `
<a class="back-link" href="/">← Back to runs</a>

<div class="header-bar">
  <div style="flex:1;min-width:0;">
    <h1>${escapeHtml(topic)}</h1>
    <div class="meta-row">
      <span class="meta-item">${badge(status)}</span>
      <span class="meta-item">ID: <strong>${escapeHtml(requestJson?.requestId ?? name)}</strong></span>
      ${inputModeLabel}
    </div>
  </div>
</div>

${phaseHtml}
${statsHtml}
${heroHtml}
${keyOutputsHtml}
${requestInfoHtml}

<div class="section">
  <h2>📎 All files</h2>
  ${fileListHtml}
</div>`

  const html = layout(`${escapeHtml(topic)} — quorum run`, body)

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

// ---------------------------------------------------------------------------
// Route: GET /runs/:name/raw/*
// ---------------------------------------------------------------------------

async function serveRawFile(
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
<p style="margin-bottom:1rem;color:var(--muted);font-size:0.8rem;">
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
<div style="margin-bottom:0.75rem;display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
  <h2 style="margin:0;">${escapeHtml(baseName)}</h2>
  <a href="/runs/${encodeURIComponent(runName)}/raw/${encodeURIComponent(filePath)}?source=1" style="font-size:0.8rem;">View raw source</a>
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

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname

    // GET /
    if (path === "/") {
      try {
        return await renderIndex()
      } catch (e) {
        console.error("GET / error:", e)
        return new Response("Internal error", { status: 500 })
      }
    }

    // GET /runs/:name/raw/*
    const rawMatch = path.match(/^\/runs\/(.+?)\/raw\/(.+)$/)
    if (rawMatch) {
      try {
        return await serveRawFile(
          decodeURIComponent(rawMatch[1]),
          decodeURIComponent(rawMatch[2]),
          url.searchParams,
        )
      } catch (e) {
        console.error("Raw file error:", e)
        return new Response("Internal error", { status: 500 })
      }
    }

    // GET /runs/:name
    const runMatch = path.match(/^\/runs\/(.+)$/)
    if (runMatch) {
      try {
        return await renderRun(decodeURIComponent(runMatch[1]))
      } catch (e) {
        console.error("Run detail error:", e)
        return new Response("Internal error", { status: 500 })
      }
    }

    return new Response("Not found", { status: 404 })
  },
})

console.log(`📋 Runs viewer running at http://${HOST}:${PORT}`)
console.log(`   Serving: ${RUNS_DIR}`)
