import { marked } from "marked"

export const SQLITE_RX = /\.sqlite\b/

export function isSqliteFile(name: string): boolean {
  return SQLITE_RX.test(name)
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function contentType(filename: string): string {
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

export function escapeHtmlLight(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}


/**
 * Render a JSON value as a structured, collapsible block.
 * If the JSON is an object with a small set of top-level keys, extract a
 * human-readable summary line.  Otherwise just show "N entries".
 */
export function renderJsonCard(
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

export function renderMarkdown(src: string): string {
  try {
    return marked.parse(src, { async: false }) as string
  } catch {
    return `<pre><code>${escapeHtml(src)}</code></pre>`
  }
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export function formatDurationMs(ms: number): string {
  if (ms >= 60_000) {
    const m = Math.floor(ms / 60_000)
    const s = Math.round((ms % 60_000) / 1000)
    return s > 0 ? `${m}m ${s}s` : `${m}m`
  }
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function formatTokenPair(
  usage: { tokensIn: number; tokensOut: number } | undefined,
  available?: boolean,
): string {
  if (!available || !usage) return "—"
  return `${formatTokenCount(usage.tokensIn)} in / ${formatTokenCount(usage.tokensOut)} out`
}

export function formatUsagePair(
  usage: { tokensIn: number; tokensOut: number; costUsd?: number; costAvailable?: boolean; costEstimated?: boolean } | undefined,
  available?: boolean,
): string {
  if (!available || !usage) return "—"
  const tokens = formatTokenPair(usage, true)
  if (!usage.costAvailable) return tokens
  return `${tokens} · ${formatCostUsd(usage.costUsd ?? 0, { estimated: usage.costEstimated })}`
}

export function formatCostUsd(amount: number, opts?: { estimated?: boolean }): string {
  const abs = Math.abs(amount)
  let formatted: string
  if (abs >= 1) formatted = `$${amount.toFixed(2)}`
  else if (abs >= 0.01) formatted = `$${amount.toFixed(3)}`
  else formatted = `$${amount.toFixed(4)}`
  return opts?.estimated ? `~${formatted} est.` : formatted
}

export function formatUsageAndCostPair(
  usage: { tokensIn: number; tokensOut: number; costUsd?: number; costAvailable?: boolean; costEstimated?: boolean } | undefined,
  usageAvailable?: boolean,
): string {
  return formatUsagePair(usage, usageAvailable)
}

export function statusDot(status: string): string {
  if (status === "running") return "●"
  if (status === "complete") return "✓"
  if (status === "error") return "✗"
  return "○"
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
