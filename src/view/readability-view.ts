import type { ReadabilityReport, ReadabilityUnit, ScoreCriterion } from "../readability/schema"
import { isPosthocReadabilityReport, SCORE_CRITERIA } from "../readability/schema"
import {
  DEFAULT_READABILITY_THRESHOLDS,
  tripThresholdFor,
  type ReadabilityThresholds,
} from "../readability/criteria"
import { escapeHtml } from "./utils"

function barWidth(score: number) {
  return Math.max(4, Math.min(100, (score / 2) * 100))
}

function formatScore(value: number) {
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
}

function skipLabel(reason: string) {
  switch (reason) {
    case "disabled": return "Skipped (readability review disabled)"
    case "no_api_key": return "Skipped (no TypeSafe API key)"
    case "error": return "Skipped after an error"
    default: return `Skipped (${reason})`
  }
}

function reportThresholds(report: ReadabilityReport): ReadabilityThresholds {
  return report.thresholds ?? DEFAULT_READABILITY_THRESHOLDS
}

function probabilityList(record: Record<string, number> | undefined) {
  if (!record) return ""
  const items = Object.entries(record)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `<li><code>${escapeHtml(key)}</code> ${escapeHtml(formatScore(value))}</li>`)
    .join("")
  return items ? `<ul class="readability-probs">${items}</ul>` : ""
}

function legendList(record: Record<string, string> | undefined) {
  if (!record) return ""
  const items = Object.entries(record)
    .map(([key, value]) => `<li><code>${escapeHtml(key)}</code> ${escapeHtml(value)}</li>`)
    .join("")
  return items ? `<ul class="readability-legend">${items}</ul>` : ""
}

function renderScoreBar(criterion: ScoreCriterion, unit: ReadabilityUnit, thresholds: ReadabilityThresholds) {
  const answer = unit.scores[criterion]
  const width = barWidth(answer.score)
  const dim = answer.score < tripThresholdFor(criterion, thresholds)
  return `<div class="readability-score${dim ? " dim" : ""}">
  <span class="readability-score-label">${escapeHtml(criterion)}</span>
  <span class="readability-score-track"><span class="readability-score-fill" style="width:${width}%"></span></span>
  <span class="readability-score-value">${escapeHtml(formatScore(answer.score))}</span>
</div>`
}

function renderQuote(quote: string) {
  return `<blockquote class="readability-quote">${escapeHtml(quote)}</blockquote>`
}

function renderHotspot(report: ReadabilityReport) {
  if (report.hotspots.length === 0) return ""
  const items = report.hotspots.map((hotspot) => {
    const section = hotspot.section.trim() || "Untitled"
    return `<li class="readability-hotspot">
  <div class="readability-hotspot-meta">
    <code>${escapeHtml(hotspot.unitId)}</code>
    <span>${escapeHtml(section)}</span>
    <span class="readability-chip">${escapeHtml(hotspot.criterion)} ${escapeHtml(formatScore(hotspot.score))}</span>
    <span class="readability-chip">conf ${escapeHtml(formatScore(hotspot.confidence))}</span>
    <span class="readability-remedy">${escapeHtml(hotspot.remedy)}</span>
  </div>
  ${renderQuote(hotspot.quote)}
</li>`
  }).join("")
  return `<h3>Hotspots (${report.hotspots.length})</h3>
<ul class="readability-hotspot-list">${items}</ul>`
}

function renderUnit(unit: ReadabilityUnit, thresholds: ReadabilityThresholds) {
  const bars = SCORE_CRITERIA.map((criterion) => renderScoreBar(criterion, unit, thresholds)).join("")
  const scoreDetails = SCORE_CRITERIA.map((criterion) => {
    const answer = unit.scores[criterion]
    return `<div class="readability-score-detail">
  <h4>${escapeHtml(criterion)} · ${escapeHtml(formatScore(answer.score))} (conf ${escapeHtml(formatScore(answer.confidence))})</h4>
  ${legendList(answer.legend)}
  ${probabilityList(answer.probabilities)}
</div>`
  }).join("")
  const gates = [
    unit.gates.inversionEarned !== undefined ? `inversion earned ${formatScore(unit.gates.inversionEarned)}` : "",
    unit.gates.densityIsOneMove !== undefined ? `one move ${formatScore(unit.gates.densityIsOneMove)}` : "",
    unit.gates.dictionIsDomainTerm !== undefined ? `domain term ${formatScore(unit.gates.dictionIsDomainTerm)}` : "",
  ].filter(Boolean)
  const section = unit.section.trim() || "Untitled"
  const cached = unit.cached ? `<span class="readability-chip">cached</span>` : ""
  return `<article class="readability-unit">
  <div class="readability-unit-meta">
    <code>${escapeHtml(unit.id)}</code>
    <span>${escapeHtml(section)}</span>
    <span class="readability-remedy">${escapeHtml(unit.remedy.choice)}</span>
    ${cached}
  </div>
  ${renderQuote(unit.quote)}
  <details>
    <summary>Scores and details</summary>
    <div class="readability-heatmap">${bars}</div>
    ${gates.length ? `<p class="dim-text readability-gates">${escapeHtml(gates.join(" · "))}</p>` : ""}
    ${scoreDetails}
    <h4>Remedy probabilities</h4>
    ${probabilityList(unit.remedy.probabilities)}
  </details>
</article>`
}

export function renderReadabilityInterpretationGuide() {
  return `<div class="section readability-guide">
  <h2>How to read these results</h2>
  <p>Each unit is one paragraph. Jev scores it 0–2 on convolution, inversion, diction, formality, and density. Higher means more first-pass processing cost for a fluent non-native English reader. Dim bars sit below the trip threshold (1.3, or 1.6 for formality).</p>
  <p>A paragraph becomes a <strong>hotspot</strong> only when a score trips with enough confidence, any matching justification gate does not save it, and the suggested remedy is not <code>keep</code>. Pass means zero hotspots. Cached units reused a previous passing score for the same unchanged paragraph and were not sent to Jev again.</p>
  <p class="dim-text">Remedies: <code>unnest</code> flatten clauses; <code>split</code> more than one move; <code>uninvert</code> restore subject–verb order; <code>simplify_words</code> same claim, plainer diction; <code>lower_register</code> drop performative formality only.</p>
</div>`
}

export function renderReadabilityReport(filename: string, data: unknown): string {
  const report = data as ReadabilityReport
  if (!report || typeof report !== "object" || !Array.isArray(report.units)) {
    return ""
  }

  const hotspotCount = report.hotspots?.length ?? 0
  const status = report.skipped
    ? skipLabel(report.skipped.reason)
    : report.fused
      ? `Continued with ${hotspotCount} leftover hotspot${hotspotCount === 1 ? "" : "s"}`
      : report.passed
        ? "Passed"
        : `${hotspotCount} hotspot${hotspotCount === 1 ? "" : "s"}`
  const statusClass = report.skipped
    ? "skipped"
    : report.fused
      ? "fused"
      : report.passed
        ? "passed"
        : "needs-edit"
  const isPosthoc = report.kind === "posthoc" || isPosthocReadabilityReport(filename)
  const tryLabel = !isPosthoc && typeof report.try === "number" ? `Try ${report.try}` : ""
  const roundMatch = filename.match(/round-(\d+)/)
  const roundLabel = !isPosthoc && roundMatch ? `Round ${roundMatch[1]}` : ""
  const title = isPosthoc
    ? "Post-run review"
    : `Readability review${roundLabel ? ` — ${roundLabel}` : ""}${tryLabel ? `, ${tryLabel}` : ""}`
  const thresholds = reportThresholds(report)
  const units = (report.units ?? []).map((unit) => renderUnit(unit, thresholds)).join("")

  return `<div class="section readability-report">
  <h2>${escapeHtml(title)}</h2>
  <div class="readability-summary">
    <span class="readability-status ${statusClass}">${escapeHtml(status)}</span>
    ${report.model ? `<span class="dim-text">${escapeHtml(report.model)}</span>` : ""}
    ${report.sourceFile ? `<span class="dim-text">Source: ${escapeHtml(report.sourceFile)}</span>` : ""}
    <span class="dim-text">${report.units.length} unit${report.units.length === 1 ? "" : "s"}</span>
    ${!isPosthoc && typeof report.try === "number" ? `<span class="dim-text">Try ${report.try}</span>` : ""}
  </div>
  ${isPosthoc ? `<p class="muted-note dim-text">Score only — the article was not rewritten.</p>` : ""}
  ${report.fused ? `<p class="readability-fuse-note">Max tries reached. The draft continues to audits with leftover hotspots.</p>` : ""}
  ${report.skipped?.detail ? `<p class="dim-text">${escapeHtml(report.skipped.detail)}</p>` : ""}
  ${renderHotspot(report)}
  ${units ? `<h3>All units</h3><div class="readability-units">${units}</div>` : ""}
</div>`
}
