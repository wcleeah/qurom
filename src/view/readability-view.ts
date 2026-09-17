import type { ReadabilityReport, ReadabilityUnit, ScoreCriterion } from "../readability/schema"
import { SCORE_CRITERIA } from "../readability/schema"
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
  <blockquote>${escapeHtml(hotspot.quote)}</blockquote>
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
  return `<details class="readability-unit">
  <summary>
    <code>${escapeHtml(unit.id)}</code>
    <span>${escapeHtml(section)}</span>
    <span class="readability-remedy">${escapeHtml(unit.remedy.choice)}</span>
  </summary>
  <div class="readability-heatmap">${bars}</div>
  ${gates.length ? `<p class="dim-text readability-gates">${escapeHtml(gates.join(" · "))}</p>` : ""}
  ${scoreDetails}
  <h4>Remedy probabilities</h4>
  ${probabilityList(unit.remedy.probabilities)}
  <blockquote>${escapeHtml(unit.quote)}</blockquote>
</details>`
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
  const tryLabel = typeof report.try === "number" ? `Try ${report.try}` : ""
  const roundMatch = filename.match(/round-(\d+)/)
  const roundLabel = roundMatch ? `Round ${roundMatch[1]}` : ""
  const thresholds = reportThresholds(report)
  const units = (report.units ?? []).map((unit) => renderUnit(unit, thresholds)).join("")

  return `<div class="section readability-report">
  <h2>Readability review — ${escapeHtml(roundLabel)}${tryLabel ? `, ${escapeHtml(tryLabel)}` : ""}</h2>
  <div class="readability-summary">
    <span class="readability-status ${statusClass}">${escapeHtml(status)}</span>
    ${report.model ? `<span class="dim-text">${escapeHtml(report.model)}</span>` : ""}
    <span class="dim-text">${report.units.length} unit${report.units.length === 1 ? "" : "s"}</span>
    ${typeof report.try === "number" ? `<span class="dim-text">Try ${report.try}</span>` : ""}
  </div>
  ${report.fused ? `<p class="readability-fuse-note">Max tries reached. The draft continues to audits with leftover hotspots.</p>` : ""}
  ${report.skipped?.detail ? `<p class="dim-text">${escapeHtml(report.skipped.detail)}</p>` : ""}
  ${renderHotspot(report)}
  ${units ? `<h3>All units</h3><div class="readability-units">${units}</div>` : ""}
</div>`
}
