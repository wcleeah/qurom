import { renderJsonPayload } from "./json-viewer"
import { escapeHtml } from "./utils"

export type DebugLogEntry = {
  ts: string
  type: string
  [key: string]: unknown
}

function debugLogBadgeClass(type: string): string {
  const lower = type.toLowerCase()
  if (lower.includes("error") || lower.includes("drift") || lower.includes("failed")) {
    return "badge badge-failed"
  }
  if (lower.includes("complete")) return "badge badge-approved"
  if (lower.includes("start")) return "badge badge-running"
  return "badge"
}

function formatDebugTime(ts: string): string {
  if (!ts) return "—"
  if (ts.length >= 23) return ts.slice(11, 23)
  return ts
}

export function renderDebugLogHtml(entries: DebugLogEntry[]): string {
  const items = entries.map((entry) => {
    const { ts, type, ...data } = entry
    const badgeClass = debugLogBadgeClass(type)
    const payloadKeys = Object.keys(data)
    const summary = `<span class="debug-log-time">${escapeHtml(formatDebugTime(ts))}</span><span class="${badgeClass} debug-log-type">${escapeHtml(type)}</span>`

    if (payloadKeys.length === 0) {
      return `<div class="debug-log-entry debug-log-entry-flat">${summary}</div>`
    }

    return `<details class="debug-log-entry">
  <summary class="debug-log-summary">${summary}</summary>
  <div class="debug-log-payload">${renderJsonPayload(data)}</div>
</details>`
  }).join("")

  return `<div class="debug-log-viewer structured-card">
  <div class="debug-log-toolbar">
    <span class="json-viewer-meta">${entries.length} entr${entries.length !== 1 ? "ies" : "y"} · newest first</span>
  </div>
  <div class="debug-log-scroll">${items}</div>
</div>`
}
