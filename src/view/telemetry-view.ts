import { addUsage, emptyUsage } from "../usage"
import { tableWrap } from "./html"
import { getNodeDefinition } from "./node-registry"
import { escapeHtml, formatBytes, formatCostUsd, formatDurationMs, formatElapsed, formatTokenCount, formatUsagePair } from "./utils"
import type { AgentUsageSnapshot, LiveStatus, NodeHistoryEntry, UsageTotals } from "./types"

export function runElapsedMs(liveStatus: LiveStatus | null, nodeHistory: NodeHistoryEntry[]): number | undefined {
  const startedAt = liveStatus?.runStartedAt
    ?? (nodeHistory.length > 0 ? nodeHistory[0]!.startedAt : undefined)
  if (!startedAt) return undefined

  if (liveStatus?.phase === "running") return Date.now() - startedAt

  const last = nodeHistory.at(-1)
  if (last) return last.completedAt - startedAt
  return undefined
}

export function resolveRunTelemetry(
  liveStatus: LiveStatus | null,
  nodeHistory: NodeHistoryEntry[],
): {
  usage: UsageTotals
  usageAvailable: boolean
  costAvailable: boolean
  costEstimated?: boolean
} {
  if (liveStatus?.usageAvailable && liveStatus.usage) {
    return {
      usage: liveStatus.usage,
      usageAvailable: true,
      costAvailable: liveStatus.usage.costAvailable === true,
      costEstimated: liveStatus.usage.costEstimated,
    }
  }

  const usage = emptyUsage()
  let usageAvailable = false
  for (const entry of nodeHistory) {
    if (!entry.usageAvailable || !entry.usage) continue
    usageAvailable = true
    addUsage(usage, entry.usage)
  }
  return {
    usage,
    usageAvailable,
    costAvailable: usage.costAvailable === true,
    costEstimated: usage.costEstimated,
  }
}

/** @deprecated Use resolveRunTelemetry */
export function resolveRunUsage(
  liveStatus: LiveStatus | null,
  nodeHistory: NodeHistoryEntry[],
): { usage: UsageTotals; usageAvailable: boolean } {
  const resolved = resolveRunTelemetry(liveStatus, nodeHistory)
  return { usage: resolved.usage, usageAvailable: resolved.usageAvailable }
}

export function nodeHistoryTotalsForNode(
  nodeHistory: NodeHistoryEntry[],
  nodeName: string,
): {
  durationMs: number
  usage: UsageTotals
  usageAvailable: boolean
  costAvailable: boolean
  costEstimated?: boolean
  usageByAgent: Record<string, AgentUsageSnapshot>
} {
  const def = getNodeDefinition(nodeName)
  const aliases = new Set([nodeName, ...(def?.liveNodeAliases ?? []), def?.id, def?.pipelineLabel].filter(Boolean) as string[])
  const entries = nodeHistory.filter((entry) => aliases.has(entry.node))

  let durationMs = 0
  const usage = emptyUsage()
  let usageAvailable = false
  const usageByAgent: Record<string, AgentUsageSnapshot> = {}

  for (const entry of entries) {
    durationMs += entry.durationMs ?? (entry.completedAt - entry.startedAt)
    if (entry.usageAvailable && entry.usage) {
      usageAvailable = true
      addUsage(usage, entry.usage)
    }
    if (entry.usageByAgent) {
      for (const [agent, snapshot] of Object.entries(entry.usageByAgent)) {
        if (!snapshot.usageAvailable) continue
        usageAvailable = true
        const existing = usageByAgent[agent] ?? { ...emptyUsage(), usageAvailable: false }
        addUsage(existing, snapshot)
        existing.usageAvailable = true
        usageByAgent[agent] = existing
      }
    }
  }

  return {
    durationMs,
    usage,
    usageAvailable,
    costAvailable: usage.costAvailable === true,
    costEstimated: usage.costEstimated,
    usageByAgent,
  }
}

function formatTelemetryUsageLabel(usage: UsageTotals, usageAvailable: boolean): string {
  if (!usageAvailable) return ""
  return formatUsagePair(usage, true)
}

export type RunTelemetryExtras = {
  fileCount?: number
  totalBytes?: number
}

export function renderRunTelemetryStrip(
  liveStatus: LiveStatus | null,
  nodeHistory: NodeHistoryEntry[],
  extras?: RunTelemetryExtras,
): string {
  const elapsedMs = runElapsedMs(liveStatus, nodeHistory)
  const { usage, usageAvailable, costAvailable } = resolveRunTelemetry(liveStatus, nodeHistory)
  const hasFileStats = extras?.fileCount !== undefined || extras?.totalBytes !== undefined
  if (!elapsedMs && !usageAvailable && !costAvailable && !hasFileStats) return ""

  const parts: string[] = []
  if (elapsedMs !== undefined) parts.push(`${formatElapsed(elapsedMs)} elapsed`)
  const usageLabel = formatTelemetryUsageLabel(usage, usageAvailable || costAvailable)
  if (usageLabel) parts.push(usageLabel)
  if (extras?.fileCount !== undefined) {
    parts.push(`${extras.fileCount} file${extras.fileCount !== 1 ? "s" : ""}`)
  }
  if (extras?.totalBytes !== undefined) {
    parts.push(formatBytes(extras.totalBytes))
  }

  return `<div class="telemetry-strip">
  ${parts.map((part) => `<span class="telemetry-chip">${escapeHtml(part)}</span>`).join("")}
</div>`
}

function formatAgentCostCell(snapshot: UsageTotals): string {
  if (!snapshot.costAvailable) return "—"
  return formatCostUsd(snapshot.costUsd ?? 0, { estimated: snapshot.costEstimated })
}

export function renderAgentUsageTable(
  usageByAgent: Record<string, AgentUsageSnapshot>,
  liveAgents?: LiveStatus["agents"],
): string {
  const rows = Object.entries(usageByAgent)
    .filter(([, snapshot]) => snapshot.usageAvailable)
    .sort(([a], [b]) => a.localeCompare(b))

  if (rows.length === 0 && liveAgents) {
    const liveRows = Object.entries(liveAgents)
      .filter(([, agent]) => agent.usageAvailable)
      .sort(([a], [b]) => a.localeCompare(b))
    if (liveRows.length === 0) return ""

    let table = `<table class="summary-table summary-table-wide summary-table-compact"><thead><tr><th>Agent</th><th>Status</th><th>Tokens in</th><th>Tokens out</th><th>Cost</th></tr></thead><tbody>`
    for (const [name, agent] of liveRows) {
      table += `<tr>
  <td>${escapeHtml(name)}</td>
  <td>${escapeHtml(agent.status)}</td>
  <td>${escapeHtml(formatTokenCount(agent.tokensIn))}</td>
  <td>${escapeHtml(formatTokenCount(agent.tokensOut))}</td>
  <td>${escapeHtml(formatAgentCostCell(agent))}</td>
</tr>`
    }
    table += "</tbody></table>"
    return `<div class="section"><h2>Agent token usage</h2>${tableWrap(table)}</div>`
  }

  if (rows.length === 0) return ""

  let table = `<table class="summary-table summary-table-wide summary-table-compact"><thead><tr><th>Agent</th><th>Tokens in</th><th>Tokens out</th><th>Cost</th></tr></thead><tbody>`
  for (const [agent, snapshot] of rows) {
    table += `<tr>
  <td>${escapeHtml(agent)}</td>
  <td>${escapeHtml(formatTokenCount(snapshot.tokensIn))}</td>
  <td>${escapeHtml(formatTokenCount(snapshot.tokensOut))}</td>
  <td>${escapeHtml(formatAgentCostCell(snapshot))}</td>
</tr>`
  }
  table += "</tbody></table>"
  return `<div class="section"><h2>Agent token usage</h2>${tableWrap(table)}</div>`
}

export function renderNodeTelemetryMeta(
  liveStatus: LiveStatus | null,
  nodeHistory: NodeHistoryEntry[],
  nodeName: string,
): string {
  const def = getNodeDefinition(nodeName)
  const nodeId = def?.id ?? nodeName
  const active = liveStatus?.phase === "running" && liveStatus.node === nodeId

  if (active && liveStatus) {
    const elapsed = liveStatus.nodeStartedAt ? formatElapsed(Date.now() - liveStatus.nodeStartedAt) : undefined
    const parts: string[] = []
    if (elapsed) parts.push(`${elapsed} elapsed`)
    if (liveStatus.nodeUsage) {
      const label = formatTelemetryUsageLabel(
        liveStatus.nodeUsage,
        liveStatus.nodeUsageAvailable || liveStatus.nodeUsage.costAvailable === true,
      )
      if (label) parts.push(label)
    }
    if (parts.length === 0) return ""
    return `<div class="telemetry-strip telemetry-strip-compact">${parts.map((part) => `<span class="telemetry-chip">${escapeHtml(part)}</span>`).join("")}</div>`
  }

  const totals = nodeHistoryTotalsForNode(nodeHistory, nodeName)
  if (totals.durationMs <= 0 && !totals.usageAvailable && !totals.costAvailable) return ""

  const parts: string[] = []
  if (totals.durationMs > 0) parts.push(`${formatDurationMs(totals.durationMs)} total`)
  const usageLabel = formatTelemetryUsageLabel(totals.usage, totals.usageAvailable || totals.costAvailable)
  if (usageLabel) parts.push(usageLabel)
  if (parts.length === 0) return ""
  return `<div class="telemetry-strip telemetry-strip-compact">${parts.map((part) => `<span class="telemetry-chip">${escapeHtml(part)}</span>`).join("")}</div>`
}

export function nodeTelemetrySuffix(
  nodeHistory: NodeHistoryEntry[],
  nodeId: string,
): string {
  const totals = nodeHistoryTotalsForNode(nodeHistory, nodeId)
  const parts: string[] = []
  if (totals.durationMs > 0) parts.push(formatDurationMs(totals.durationMs))
  const usageLabel = formatTelemetryUsageLabel(totals.usage, totals.usageAvailable || totals.costAvailable)
  if (usageLabel) parts.push(usageLabel)
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : ""
}
