import { escapeHtml, renderJsonCard } from "./utils"
import type { AggregatedFindings, AuditFinding, AuditRecord, RebuttalEntry, RebuttalResponseEntry } from "./types"

export function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "approved": return "✅ Approved"
    case "approved_with_caveats": return "⚠️ Approved with caveats"
    case "needs_revision": return "🔧 Needs revision"
    case "failed_non_convergent": return "❌ Failed (non-convergent)"
    default: return `📋 ${outcome}`
  }
}

export function outcomeClass(outcome: string): string {
  if (outcome === "approved") return "approved"
  if (outcome === "failed_non_convergent") return "failed"
  return "needs-revision"
}

export function renderFindingRow(f: AuditFinding, compact?: boolean): string {
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

export function renderRequestCard(data: unknown): string {
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

// ── reader-profile.json ──

export function renderReaderProfileCard(data: unknown): string {
  // The interviewer writes the per-turn JSON to reader-profile.json each turn
  // (auditor pattern). On the final turn the file holds the full turn object
  // with `profile: { learningGoal, concepts: [...] }`.
  const d = data as Record<string, unknown>
  const profile = (d.profile ?? d) as { learningGoal?: string; concepts?: Array<{ concept: string; level: string; evidence?: string }> }
  const concepts = Array.isArray(profile.concepts) ? profile.concepts : []
  const goal = profile.learningGoal ? escapeHtml(String(profile.learningGoal)) : "<span class=\"placeholder-muted\">(not specified)</span>"
  const levelClass: Record<string, string> = { familiar: "concept-level-familiar", "heard-of": "concept-level-heard-of", unknown: "concept-level-unknown" }
  const conceptRows = concepts.map((c) => {
    const lvl = escapeHtml(String(c.level))
    const ev = c.evidence ? escapeHtml(String(c.evidence)) : ""
    return `<tr><td>${escapeHtml(c.concept)}</td><td class="${levelClass[c.level] ?? "concept-level-default"}">${lvl}</td><td class="evidence-muted">${ev}</td></tr>`
  }).join("")
  return `<div class="structured-card">
  <div class="auditor-header">🎙 Reader profile</div>
  <table class="summary-table">
    <tr><td>Learning goal</td><td colspan="2">${goal}</td></tr>
    ${concepts.length > 0 ? `<tr><th>Concept</th><th>Level</th><th>Evidence</th></tr>${conceptRows}` : "<tr><td colspan=\"3\" class=\"placeholder-muted\">(interview did not complete)</td></tr>"}
  </table>
</div>`
}

// ── summary.json ──

export function renderSummaryCard(data: unknown): string {
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

export function renderAuditRound(filename: string, data: unknown, isDesign?: boolean): string {
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
      html += `<div class="audit-summary">${escapeHtml(audit.summary)}</div>`
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

export function renderConsensusCard(filename: string, data: unknown, isDesign?: boolean): string {
  const d = data as AggregatedFindings
  if (!d || typeof d !== "object") return renderJsonCard(data, { defaultOpen: true })

  const roundMatch = filename.match(/round-(\d+)/)
  const roundLabel = roundMatch ? `Round ${roundMatch[1]}` : ""
  const phaseIcon = isDesign ? "🎨" : "📊"
  const phaseLabel = isDesign ? "Design Consensus" : "Consensus"
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
    html += `<div class="structured-summary-wrap"><table class="summary-table">${rows.join("")}</table></div>`
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

export function renderDrafterReview(filename: string, data: unknown): string {
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
    html += `<div class="chip-list">`
    for (const id of accepted.slice(0, 30)) {
      html += `<code class="id-chip">${escapeHtml(id.slice(-40))}</code>`
    }
    if (accepted.length > 30) html += `<span class="more-count">… +${accepted.length - 30} more</span>`
    html += `</div>`
  } else {
    html += `<div class="empty-inline">None</div>`
  }
  html += `</div>`

  // Rebutted
  html += `<div class="review-section">
  <h4>🗣️ Rebutted (${rebuttals.length} finding${rebuttals.length !== 1 ? "s" : ""})</h4>`
  if (rebuttals.length > 0) {
    for (const r of rebuttals) {
      html += `<div class="rebuttal-entry">
  <div class="rebuttal-entry-header">
    <code class="short-id">${escapeHtml(r.findingId.slice(-40))}</code>
    <span class="rebuttal-decision ${escapeHtml(r.requestedResolution)}">${escapeHtml(r.requestedResolution)}</span>
  </div>
  <div class="rebuttal-speaker">Drafter</div>
  <div class="rebuttal-text">${escapeHtml(r.argument)}</div>
  ${r.evidence && r.evidence.length > 0 ? `<details class="finding-evidence"><summary>📚 Evidence (${r.evidence.length})</summary><ul>${r.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul></details>` : ""}
</div>`
    }
  } else {
    html += `<div class="empty-inline">None</div>`
  }
  html += `</div>`

  html += `</div></div>`
  return html
}

// ── auditor-rebuttal-responses-round-N-turn-M.json ──

export function renderRebuttalResponses(filename: string, data: unknown): string {
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
  <div class="rebuttal-entry-header">
    <code class="short-id">${escapeHtml(findingId.slice(-40))}</code>
    <span class="rebuttal-decision ${escapeHtml(response.decision)}">${decisionLabel}</span>
    <span class="short-id muted-text">👤 ${escapeHtml(response.agent)}</span>
  </div>
  <div class="rebuttal-speaker">Auditor response</div>
  <div class="rebuttal-text">${escapeHtml(response.argument)}</div>`

    if (response.updatedFinding) {
      html += `<div class="updated-finding">
  <div class="updated-finding-title">Updated finding:</div>`
      html += renderFindingRow({ ...response.updatedFinding, findingId, evidence: [], required_fix: response.updatedFinding.required_fix ?? "" } as AuditFinding, true)
      html += `</div>`
    }

    html += `</div>`
  }

  html += `</div></div>`
  return html
}

// ── Dispatcher ──

export function renderStructuredJson(filename: string, data: unknown): string {
  if (filename === "request.json") return renderRequestCard(data)
  if (filename === "reader-profile.json") return renderReaderProfileCard(data)
  if (filename === "summary.json") return renderSummaryCard(data)
  if (/^audits-round-\d+\.json$/.test(filename)) return renderAuditRound(filename, data)
  if (/^aggregated-findings-round-\d+\.json$/.test(filename)) return renderConsensusCard(filename, data)
  if (/^drafter-finding-review-round-\d+\.json$/.test(filename)) return renderDrafterReview(filename, data)
  if (/^auditor-rebuttal-responses-round-\d+-turn-\d+\.json$/.test(filename)) return renderRebuttalResponses(filename, data)
  if (/^design-audits-round-\d+\.json$/.test(filename)) return renderAuditRound(filename, data, true)
  if (/^design-consensus-round-\d+\.json$/.test(filename)) return renderConsensusCard(filename, data, true)
  return renderJsonCard(data, { defaultOpen: true })
}
