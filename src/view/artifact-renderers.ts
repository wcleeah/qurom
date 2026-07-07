import { escapeHtml, renderJsonCard } from "./utils"
import { renderJsonViewer } from "./json-viewer"
import { summaryTable, tableWrap } from "./html"
import type { AggregatedFindings, AuditFinding, AuditRecord, RebuttalEntry, RebuttalResponseEntry } from "./types"

export function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "approved": return "Approved"
    case "approved_with_caveats": return "Approved with caveats"
    case "needs_revision": return "Needs revision"
    case "failed_non_convergent": return "Failed (non-convergent)"
    default: return outcome
  }
}

export function outcomeClass(outcome: string): string {
  if (outcome === "approved") return "approved"
  if (outcome === "failed_non_convergent") return "failed"
  return "needs-revision"
}

export function renderFindingRow(f: AuditFinding, compact?: boolean): string {
  const fixHtml = !compact && f.required_fix
    ? `<div class="finding-required-fix">${escapeHtml(f.required_fix)}</div>`
    : ""

  const evidenceHtml = !compact && f.evidence && f.evidence.length > 0
    ? `<details class="finding-evidence">
  <summary>Evidence (${f.evidence.length} source${f.evidence.length !== 1 ? "s" : ""})</summary>
  <ul>${f.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>
</details>`
    : ""

  const agentHtml = f.agent
    ? `<div class="finding-agent">${escapeHtml(f.agent)}</div>`
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
  if (d.documentPath) {
    const pathLabel = String(d.documentPath).endsWith("/input.md") || String(d.documentPath).endsWith("\\input.md")
      ? "Source document"
      : "Document path"
    rows.push(`<tr><td>${pathLabel}</td><td><code>${escapeHtml(String(d.documentPath))}</code></td></tr>`)
  }
  if (d.documentSource) rows.push(`<tr><td>Document source</td><td>${escapeHtml(String(d.documentSource))}</td></tr>`)
  if (d.originalDocumentPath) {
    rows.push(`<tr><td>Original path</td><td><code>${escapeHtml(String(d.originalDocumentPath))}</code></td></tr>`)
  }
  if (d.inputSummary && typeof d.inputSummary === "object") {
    const s = d.inputSummary as Record<string, unknown>
    if (s.title) rows.push(`<tr><td>Title</td><td>${escapeHtml(String(s.title))}</td></tr>`)
  }
  return `<div class="structured-card">
  <div class="auditor-header">Request</div>
  ${summaryTable(rows)}
</div>`
}

// ── reader-profile-N.json ──

type ReaderProfileData = {
  intent?: { goal?: string; depth?: string; format?: string }
  background?: { summary?: string }
  competence?: {
    inTopic?: { level?: string; summary?: string; evidence?: string[] }
    adjacent?: { summary?: string; evidence?: string[] }
  }
  inferredGaps?: Array<{ concept: string; treatment: string; rationale?: string }>
}

function extractReaderProfileData(data: unknown): ReaderProfileData | undefined {
  const d = data as Record<string, unknown>
  const profile = (d.profile ?? d) as ReaderProfileData
  if (!profile || typeof profile !== "object") return undefined
  if (!profile.intent && !profile.background && !profile.competence) return undefined
  return profile
}

const gapTreatmentClass: Record<string, string> = {
  "must-explain": "concept-level-unknown",
  "brief-recap": "concept-level-heard-of",
  "can-assume": "concept-level-familiar",
}

export function renderReaderProfileSummary(data: unknown): string {
  const profile = extractReaderProfileData(data)
  if (!profile) return ""

  const goal = profile.intent?.goal
    ? escapeHtml(String(profile.intent.goal))
    : "<span class=\"placeholder-muted\">(intent not yet clear)</span>"
  const depth = profile.intent?.depth ? escapeHtml(String(profile.intent.depth)) : "—"
  const background = profile.background?.summary
    ? escapeHtml(String(profile.background.summary))
    : "<span class=\"placeholder-muted\">(background not yet clear)</span>"
  const inTopicLevel = profile.competence?.inTopic?.level
    ? escapeHtml(String(profile.competence.inTopic.level))
    : "—"
  const inTopicSummary = profile.competence?.inTopic?.summary
    ? escapeHtml(String(profile.competence.inTopic.summary))
    : "—"
  const adjacent = profile.competence?.adjacent?.summary
    ? escapeHtml(String(profile.competence.adjacent.summary))
    : "—"
  const gaps = Array.isArray(profile.inferredGaps) ? profile.inferredGaps : []
  const gapRows = gaps.length > 0
    ? gaps.map((g) => {
      const treatment = escapeHtml(String(g.treatment))
      const rationale = g.rationale ? escapeHtml(String(g.rationale)) : ""
      return `<tr><td>${escapeHtml(String(g.concept))}</td><td class="${gapTreatmentClass[g.treatment] ?? "concept-level-default"}">${treatment}</td><td class="evidence-muted">${rationale}</td></tr>`
    }).join("")
    : "<tr><td colspan=\"3\" class=\"placeholder-muted\">(gaps not yet inferred)</td></tr>"

  return tableWrap(`<table class="summary-table summary-table-wide reader-profile-summary">
    <tr><td>Goal</td><td colspan="2">${goal}</td></tr>
    <tr><td>Depth</td><td colspan="2">${depth}</td></tr>
    <tr><td>Background</td><td colspan="2">${background}</td></tr>
    <tr><td>In-topic</td><td>${inTopicLevel}</td><td>${inTopicSummary}</td></tr>
    <tr><td>Adjacent</td><td colspan="2">${adjacent}</td></tr>
    <tr><th>Gap</th><th>Treatment</th><th>Rationale</th></tr>
    ${gapRows}
  </table>`)
}

export function renderReaderProfileCard(data: unknown): string {
  const d = data as Record<string, unknown>
  const done = d.done === true
  const summary = renderReaderProfileSummary(d)
  if (!summary) {
    return `<div class="structured-card">
  <div class="auditor-header">Reader profile</div>
  <p class="placeholder-muted">(interview in progress — no profile synthesized yet)</p>
</div>`
  }
  const status = done
    ? "Reader profile"
    : "Reader profile (in progress)"
  return `<div class="structured-card">
  <div class="auditor-header">${status}</div>
  ${summary}
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
  ${summaryTable(rows)}
</div>`
}

// ── audits-round-N.json ──

export function renderAuditRound(filename: string, data: unknown, isDesign?: boolean): string {
  const audits = data as AuditRecord[]
  if (!Array.isArray(audits)) return renderJsonCard(data, { defaultOpen: true })

  const roundMatch = filename.match(/round-(\d+)/)
  const roundLabel = roundMatch ? `Round ${roundMatch[1]}` : ""
  const phaseLabel = isDesign ? "Design Audits" : "Audits"

  let html = `<div class="section"><h2>${phaseLabel} — ${roundLabel} (${audits.length} auditor${audits.length !== 1 ? "s" : ""})</h2>`

  for (const audit of audits) {
    const totalFindings = audit.findings?.length ?? 0

    html += `<div class="structured-card">
  <div class="auditor-header">
    <span>${escapeHtml(audit.agent)}</span>
    <span class="auditor-vote ${escapeHtml(audit.vote)}">${audit.vote}${totalFindings > 0 ? ` · ${totalFindings} finding${totalFindings !== 1 ? "s" : ""}` : ""}</span>
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

function renderConsensusBody(d: AggregatedFindings, _isDesign?: boolean): string {
  let html = `<div class="outcome-banner ${outcomeClass(d.outcome)}">${outcomeLabel(d.outcome)}</div>`

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
    html += `<div class="structured-summary-wrap">${summaryTable(rows)}</div>`
  }

  if (d.unresolvedFindings?.length > 0) {
    html += `<div class="review-section">
  <h4>Unresolved findings (${d.unresolvedFindings.length})</h4>`
    for (const f of d.unresolvedFindings) {
      html += renderFindingRow(f, true)
    }
    html += `</div>`
  }

  return html
}

export function renderConsensusRound(
  roundNum: number,
  data: AggregatedFindings,
  options?: { roundHeading?: "h2" | "h3" | false; title?: string; isDesign?: boolean },
): string {
  const roundHeading = options?.roundHeading ?? "h3"
  const nested = roundHeading === "h3"
  let html = `<div class="section${nested ? " section-nested" : ""}">`
  if (roundHeading !== false) {
    html += `<${roundHeading}>${escapeHtml(options?.title ?? `Round ${roundNum}`)}</${roundHeading}>`
  }
  html += `<div class="structured-card">`
  html += renderConsensusBody(data, options?.isDesign)
  html += `</div></div>`
  return html
}

export function renderConsensusCard(filename: string, data: unknown, isDesign?: boolean): string {
  const d = data as AggregatedFindings
  if (!d || typeof d !== "object") return renderJsonCard(data, { defaultOpen: true })

  const roundMatch = filename.match(/round-(\d+)/)
  const roundLabel = roundMatch ? `Round ${roundMatch[1]}` : ""
  const phaseLabel = isDesign ? "Design Consensus" : "Consensus"

  if (roundMatch) {
    return renderConsensusRound(parseInt(roundMatch[1], 10), d, {
      roundHeading: "h2",
      title: `${phaseLabel} — ${roundLabel}`,
      isDesign,
    })
  }

  let html = `<div class="section"><h2>${phaseLabel}${roundLabel ? ` — ${escapeHtml(roundLabel)}` : ""}</h2>
<div class="structured-card">`
  html += renderConsensusBody(d, isDesign)
  html += `</div></div>`
  return html
}

// ── drafter-finding-review-round-N.json ──

function renderRebuttalEntryBlock(r: RebuttalEntry, speaker: string): string {
  return `<div class="rebuttal-entry">
  <div class="rebuttal-entry-header">
    <code class="short-id">${escapeHtml(r.findingId.slice(-40))}</code>
    <span class="rebuttal-decision ${escapeHtml(r.requestedResolution)}">${escapeHtml(r.requestedResolution)}</span>
  </div>
  <div class="rebuttal-speaker">${escapeHtml(speaker)}</div>
  <div class="rebuttal-text">${escapeHtml(r.argument)}</div>
  ${r.evidence && r.evidence.length > 0 ? `<details class="finding-evidence"><summary>Evidence (${r.evidence.length})</summary><ul>${r.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul></details>` : ""}
</div>`
}

function agentFromRebuttalsFile(filename: string): string {
  const match = filename.match(/^rebuttals-([\w-]+)-round-\d+\.json$/)
  return match?.[1] ?? filename
}

export function renderTargetedRebuttalsRound(
  roundNum: number,
  agentRebuttals: Array<{ agent: string; rebuttals: RebuttalEntry[] }>,
  options?: { roundHeading?: "h3" | false },
): string {
  if (agentRebuttals.length === 0) return ""

  const roundHeading = options?.roundHeading ?? "h3"
  let html = `<div class="section${roundHeading === "h3" ? " section-nested" : ""}">`
  if (roundHeading !== false) {
    html += `<h3>Round ${roundNum}</h3>`
  }
  html += `<div class="structured-card">`

  for (const { agent, rebuttals } of agentRebuttals) {
    html += `<div class="review-section">
  <h4>${escapeHtml(agent)} (${rebuttals.length} finding${rebuttals.length !== 1 ? "s" : ""})</h4>`
    if (rebuttals.length > 0) {
      for (const r of rebuttals) {
        html += renderRebuttalEntryBlock(r, "Drafter rebuttal")
      }
    } else {
      html += `<div class="empty-inline">None</div>`
    }
    html += `</div>`
  }

  html += `</div></div>`
  return html
}

export function renderRebuttalsInputFile(filename: string, data: unknown): string {
  if (!Array.isArray(data)) return renderJsonCard(data, { defaultOpen: true })
  const roundMatch = filename.match(/round-(\d+)/)
  const agent = agentFromRebuttalsFile(filename)
  const roundLabel = roundMatch ? `Round ${roundMatch[1]}` : ""
  const rebuttals = data as RebuttalEntry[]

  let html = `<div class="section"><h2>Rebuttals — ${escapeHtml(agent)}${roundLabel ? `, ${roundLabel}` : ""}</h2>
<div class="structured-card">
<div class="review-section">
  <h4>${escapeHtml(agent)} (${rebuttals.length} finding${rebuttals.length !== 1 ? "s" : ""})</h4>`
  if (rebuttals.length > 0) {
    for (const r of rebuttals) {
      html += renderRebuttalEntryBlock(r, "Drafter rebuttal")
    }
  } else {
    html += `<div class="empty-inline">None</div>`
  }
  html += `</div></div></div>`
  return html
}

function renderDrafterReviewBody(
  accepted: string[],
  rebuttals: RebuttalEntry[],
  rebuttalSpeaker = "Drafter",
): string {
  let html = `<div class="review-section">
  <h4>Accepted (${accepted.length} finding${accepted.length !== 1 ? "s" : ""})</h4>`
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

  html += `<div class="review-section">
  <h4>Rebutted (${rebuttals.length} finding${rebuttals.length !== 1 ? "s" : ""})</h4>`
  if (rebuttals.length > 0) {
    for (const r of rebuttals) {
      html += renderRebuttalEntryBlock(r, rebuttalSpeaker)
    }
  } else {
    html += `<div class="empty-inline">None</div>`
  }
  html += `</div>`
  return html
}

function renderAuditorResponsesSection(responses: Record<string, RebuttalResponseEntry>): string {
  const entries = Object.entries(responses)
  if (entries.length === 0) return ""

  let html = `<div class="review-section">
  <h4>Auditor responses (${entries.length} finding${entries.length !== 1 ? "s" : ""})</h4>`
  for (const [findingId, response] of entries) {
    const decisionLabel =
      response.decision === "withdraw" ? "WITHDREW" :
      response.decision === "soften" ? "SOFTENED" :
      "UPHELD"

    html += `<div class="rebuttal-entry">
  <div class="rebuttal-entry-header">
    <code class="short-id">${escapeHtml(findingId.slice(-40))}</code>
    <span class="rebuttal-decision ${escapeHtml(response.decision)}">${decisionLabel}</span>
    <span class="short-id muted-text">${escapeHtml(response.agent)}</span>
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
  html += `</div>`
  return html
}

export type RebuttalReviewTurnData = {
  turn: number
  responses?: Record<string, RebuttalResponseEntry>
  review?: { acceptedFindingIds: string[]; rebuttals: RebuttalEntry[] }
}

function renderRebuttalReviewTurnBlock(
  turn: number,
  data: RebuttalReviewTurnData,
  options?: { turnHeading?: "h4" | false },
): string {
  const turnHeading = options?.turnHeading ?? "h4"
  const hasResponses = data.responses && Object.keys(data.responses).length > 0
  const hasReview = data.review !== undefined
  if (!hasResponses && !hasReview) return ""

  let html = `<div class="section-nested">`
  if (turnHeading !== false) {
    html += `<h4>Turn ${turn}</h4>`
  }
  html += `<div class="structured-card">`
  if (hasResponses) {
    html += renderAuditorResponsesSection(data.responses!)
  }
  if (hasReview) {
    html += renderDrafterReviewBody(
      data.review!.acceptedFindingIds ?? [],
      data.review!.rebuttals ?? [],
    )
  }
  html += `</div></div>`
  return html
}

function renderWrittenRebuttalsSection(agentRebuttals: Array<{ agent: string; rebuttals: RebuttalEntry[] }>): string {
  if (agentRebuttals.length === 0) return ""

  let html = `<div class="section-nested"><h4>Written rebuttals</h4><div class="structured-card">`
  for (const { agent, rebuttals } of agentRebuttals) {
    html += `<div class="review-section">
  <h4>${escapeHtml(agent)} (${rebuttals.length} finding${rebuttals.length !== 1 ? "s" : ""})</h4>`
    if (rebuttals.length > 0) {
      for (const r of rebuttals) {
        html += renderRebuttalEntryBlock(r, "Drafter rebuttal")
      }
    } else {
      html += `<div class="empty-inline">None</div>`
    }
    html += `</div>`
  }
  html += `</div></div>`
  return html
}

export type RebuttalsRoundData = {
  roundNum: number
  agentRebuttals: Array<{ agent: string; rebuttals: RebuttalEntry[] }>
  turns: RebuttalReviewTurnData[]
}

export function renderRebuttalsRound(
  data: RebuttalsRoundData,
  options?: { roundHeading?: "h3" | false; turnHeading?: "h4" | false },
): string {
  const hasWrite = data.agentRebuttals.some(({ rebuttals }) => rebuttals.length > 0)
  const turnBlocks = data.turns
    .map((turn) => renderRebuttalReviewTurnBlock(turn.turn, turn, { turnHeading: options?.turnHeading }))
    .filter(Boolean)
  if (!hasWrite && turnBlocks.length === 0) return ""

  const roundHeading = options?.roundHeading ?? "h3"
  let html = `<div class="section${roundHeading === "h3" ? " section-nested" : ""}">`
  if (roundHeading !== false) {
    html += `<h3>Round ${data.roundNum}</h3>`
  }
  if (hasWrite) {
    html += renderWrittenRebuttalsSection(data.agentRebuttals)
  }
  html += turnBlocks.join("")
  html += `</div>`
  return html
}

export function renderRebuttalReviewRound(
  roundNum: number,
  turns: RebuttalReviewTurnData[],
  options?: { roundHeading?: "h3" | false; turnHeading?: "h4" | false },
): string {
  const turnBlocks = turns
    .map((turn) => renderRebuttalReviewTurnBlock(turn.turn, turn, { turnHeading: options?.turnHeading }))
    .filter(Boolean)
  if (turnBlocks.length === 0) return ""

  const roundHeading = options?.roundHeading ?? "h3"
  let html = `<div class="section${roundHeading === "h3" ? " section-nested" : ""}">`
  if (roundHeading !== false) {
    html += `<h3>Round ${roundNum}</h3>`
  }
  html += turnBlocks.join("")
  html += `</div>`
  return html
}

export function renderDrafterReview(
  filename: string,
  data: unknown,
  options?: { roundHeading?: "h2" | "h3" | "h4" | false; title?: string },
): string {
  const d = data as { acceptedFindingIds?: string[]; rebuttals?: RebuttalEntry[] }
  if (!d || typeof d !== "object") return renderJsonCard(data, { defaultOpen: true })

  const roundMatch = filename.match(/round-(\d+)/)
  const roundLabel = roundMatch ? `Round ${roundMatch[1]}` : ""
  const accepted = d.acceptedFindingIds ?? []
  const rebuttals = d.rebuttals ?? []
  const roundHeading = options?.roundHeading ?? "h2"
  const nested = roundHeading === "h3" || roundHeading === "h4"

  let html = `<div class="section${nested ? " section-nested" : ""}">`
  if (roundHeading !== false) {
    html += `<${roundHeading}>${escapeHtml(options?.title ?? `Drafter Review — ${roundLabel}`)}</${roundHeading}>`
  }
  html += `<div class="structured-card">`
  html += renderDrafterReviewBody(accepted, rebuttals)
  html += `</div></div>`
  return html
}

export function renderDrafterRebuttalReviewFile(filename: string, data: unknown): string {
  const roundMatch = filename.match(/round-(\d+)/)
  const turnMatch = filename.match(/turn-(\d+)/)
  const roundLabel = roundMatch ? `Round ${roundMatch[1]}` : ""
  const turnLabel = turnMatch ? `Turn ${turnMatch[1]}` : ""
  return renderDrafterReview(filename, data, {
    title: `Drafter Rebuttal Review — ${roundLabel}${turnLabel ? `, ${turnLabel}` : ""}`,
  })
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

  let html = `<div class="section"><h2>Rebuttal Responses — ${escapeHtml(roundLabel)}${turnLabel ? `, ${turnLabel}` : ""} (${entries.length} finding${entries.length !== 1 ? "s" : ""})</h2>
<div class="structured-card">`
  html += renderAuditorResponsesSection(d)
  html += `</div></div>`
  return html
}

// ── Dispatcher ──

export function renderStructuredJson(filename: string, data: unknown): string {
  if (filename === "request.json") return renderRequestCard(data)
  if (/^reader-profile(?:-\d+)?\.json$/.test(filename)) return renderReaderProfileCard(data)
  if (filename === "summary.json") return renderSummaryCard(data)
  if (/^audits-round-\d+\.json$/.test(filename)) return renderAuditRound(filename, data)
  if (/^aggregated-findings-round-\d+\.json$/.test(filename)) return renderConsensusCard(filename, data)
  if (/^drafter-finding-review-round-\d+\.json$/.test(filename)) return renderDrafterReview(filename, data)
  if (/^drafter-rebuttal-review-round-\d+-turn-\d+\.json$/.test(filename)) return renderDrafterRebuttalReviewFile(filename, data)
  if (/^rebuttals-[\w-]+-round-\d+\.json$/.test(filename)) return renderRebuttalsInputFile(filename, data)
  if (/^auditor-rebuttal-responses-round-\d+-turn-\d+\.json$/.test(filename)) return renderRebuttalResponses(filename, data)
  return renderJsonViewer(data)
}
