import { addUsage, emptyUsage, type UsageTotals } from "../usage"
import { sumSessionTelemetryUsage, type SessionTelemetryFile } from "../session-telemetry"
import { tableWrap } from "./html"
import { getNodeDefinition, resolveLiveNode } from "./node-registry"
import { escapeHtml, formatBytes, formatCostUsd, formatDurationMs, formatElapsed, formatTokenCount, formatTokenPair, formatUsagePair } from "./utils"
import type { AgentUsageSnapshot, LiveStatus, NodeHistoryEntry } from "./types"

function nodeAliases(nodeName: string): Set<string> {
  const def = getNodeDefinition(nodeName)
  return new Set([nodeName, ...(def?.liveNodeAliases ?? []), def?.id, def?.pipelineLabel].filter(Boolean) as string[])
}

function normalizeUsageForDisplay(
  usage: UsageTotals,
  usageSource?: SessionTelemetryFile["sessions"][number]["calls"][number]["usageSource"],
): UsageTotals {
  if ((usageSource === "turso-import" || usageSource === "opencode-import") && usage.costAvailable) {
    return { ...usage, costEstimated: false }
  }
  if (usageSource === "csv-import" && usage.costAvailable && !usage.costEstimated) {
    return { ...usage, costEstimated: false }
  }
  return usage
}

function addSessionCallUsage(
  target: UsageTotals,
  call: SessionTelemetryFile["sessions"][number]["calls"][number],
) {
  if (!call.usage) return
  addUsage(target, normalizeUsageForDisplay(call.usage, call.usageSource))
}

type SessionRecord = SessionTelemetryFile["sessions"][number]
type SessionCall = SessionRecord["calls"][number]

function callMatchesNodeEntry(call: SessionCall, entry: NodeHistoryEntry): boolean {
  if (!call.completedAt || !call.usage) return false
  const timestamp = Date.parse(call.completedAt)
  if (!Number.isFinite(timestamp)) return false
  return timestamp >= entry.startedAt && timestamp <= entry.completedAt
}

function callMatchesNodeRound(
  call: SessionCall,
  session: SessionRecord,
  aliases: Set<string>,
  roundEntries: NodeHistoryEntry[],
  round: number,
): boolean {
  if (!call.usage) return false

  for (const entry of roundEntries) {
    if (callMatchesNodeEntry(call, entry)) return true
  }

  if (roundEntries.length === 0
    && session.round === round
    && session.node
    && aliases.has(session.node)) {
    return true
  }

  return false
}

function filterSessionForNodeRound(
  session: SessionRecord,
  aliases: Set<string>,
  roundEntries: NodeHistoryEntry[],
  round: number,
): SessionRecord | null {
  const calls = session.calls.filter((call) => callMatchesNodeRound(call, session, aliases, roundEntries, round))
  if (calls.length === 0) return null
  return { ...session, calls }
}

/** Map a research-round tab to the node-history windows that produced that round's draft. */
export function nodeHistoryEntriesForNodeScope(
  nodeHistory: NodeHistoryEntry[],
  nodeName: string,
  round?: number,
): NodeHistoryEntry[] {
  const nodeId = getNodeDefinition(nodeName)?.id ?? nodeName

  if (nodeId === "draftFullDraft") {
    if (round === undefined) {
      return nodeHistory.filter((entry) => entry.node === "draftFullDraft" || entry.node === "reviseDraft")
    }
    if (round === 0) {
      return nodeHistory.filter((entry) => entry.node === "draftFullDraft" && entry.round === 0)
    }
    return nodeHistory.filter((entry) => entry.node === "reviseDraft" && entry.round === round - 1)
  }

  if (nodeId === "reviewRebuttalResponses") {
    const rebuttalReviewNodes = new Set(["reviewRebuttalResponses", "runTargetedRebuttals"])
    const entries = nodeHistory.filter((entry) => rebuttalReviewNodes.has(entry.node))
    if (round === undefined) return entries
    return entries.filter((entry) => entry.round === round)
  }

  const aliases = nodeAliases(nodeName)
  const entries = nodeHistory.filter((entry) => aliases.has(entry.node))
  if (round === undefined) return entries
  return entries.filter((entry) => entry.round === round)
}

function sessionMatchesNodeScopeEntries(
  session: SessionRecord,
  entries: NodeHistoryEntry[],
): boolean {
  for (const call of session.calls) {
    if (!call.usage) continue
    for (const entry of entries) {
      if (callMatchesNodeEntry(call, entry)) return true
    }
  }
  return false
}

function sessionMatchesNode(
  session: SessionTelemetryFile["sessions"][number],
  aliases: Set<string>,
  nodeEntries: NodeHistoryEntry[],
): boolean {
  if (session.node && aliases.has(session.node)) return true

  for (const entry of nodeEntries) {
    for (const call of session.calls) {
      if (!call.completedAt) continue
      const timestamp = Date.parse(call.completedAt)
      if (Number.isFinite(timestamp) && timestamp >= entry.startedAt && timestamp <= entry.completedAt) {
        return true
      }
    }
  }

  return false
}

function sessionLatestActivityMs(session: SessionRecord): number {
  let latest = 0
  for (const call of session.calls) {
    if (!call.completedAt) continue
    const timestamp = Date.parse(call.completedAt)
    if (Number.isFinite(timestamp) && timestamp > latest) latest = timestamp
  }
  if (latest === 0 && session.createdAt) {
    const created = Date.parse(session.createdAt)
    if (Number.isFinite(created)) latest = created
  }
  return latest
}

function formatSessionActivityTime(session: SessionTelemetryFile["sessions"][number]): string {
  const latest = sessionLatestActivityMs(session)
  if (latest <= 0) return "—"
  return `${new Date(latest).toISOString().replace("T", " ").slice(0, 19)} UTC`
}

export function usageByRoleFromSession(
  sessionTelemetry: SessionTelemetryFile | null | undefined,
): Record<string, AgentUsageSnapshot> {
  const usageByAgent: Record<string, AgentUsageSnapshot> = {}
  if (!sessionTelemetry?.sessions.length) return usageByAgent

  for (const session of sessionTelemetry.sessions) {
    const snapshot = usageByAgent[session.role] ?? { ...emptyUsage(), usageAvailable: false }
    for (const call of session.calls) {
      if (!call.usage) continue
      addSessionCallUsage(snapshot, call)
      snapshot.usageAvailable = true
    }
    if (snapshot.usageAvailable) usageByAgent[session.role] = snapshot
  }

  return usageByAgent
}

export function sessionTotalsForNode(
  sessionTelemetry: SessionTelemetryFile | null | undefined,
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
  const aliases = nodeAliases(nodeName)
  const entries = nodeHistoryEntriesForNodeScope(nodeHistory, nodeName)
  const durationMs = entries.reduce((total, entry) => total + (entry.durationMs ?? (entry.completedAt - entry.startedAt)), 0)

  const usage = emptyUsage()
  let usageAvailable = false
  const usageByAgent: Record<string, AgentUsageSnapshot> = {}

  if (!sessionTelemetry?.sessions.length) {
    return { durationMs, usage, usageAvailable: false, costAvailable: false, usageByAgent }
  }

  const nodeId = getNodeDefinition(nodeName)?.id ?? nodeName
  const matchSession = nodeId === "draftFullDraft"
    ? (session: SessionRecord) => sessionMatchesNodeScopeEntries(session, entries)
    : (session: SessionRecord) => sessionMatchesNode(session, aliases, entries)

  for (const session of sessionTelemetry.sessions) {
    if (!matchSession(session)) continue

    const agent = usageByAgent[session.role] ?? { ...emptyUsage(), usageAvailable: false }
    for (const call of session.calls) {
      if (!call.usage) continue
      if (nodeId === "draftFullDraft") {
        const inScope = entries.some((entry) => callMatchesNodeEntry(call, entry))
        if (!inScope) continue
      }
      usageAvailable = true
      addSessionCallUsage(usage, call)
      addSessionCallUsage(agent, call)
      agent.usageAvailable = true
    }
    if (agent.usageAvailable) usageByAgent[session.role] = agent
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

export function sessionTotalsForNodeRound(
  sessionTelemetry: SessionTelemetryFile | null | undefined,
  nodeHistory: NodeHistoryEntry[],
  nodeName: string,
  round: number,
): {
  durationMs: number
  usage: UsageTotals
  usageAvailable: boolean
  costAvailable: boolean
  costEstimated?: boolean
  usageByAgent: Record<string, AgentUsageSnapshot>
} {
  const aliases = nodeAliases(nodeName)
  const roundEntries = nodeHistoryEntriesForNodeScope(nodeHistory, nodeName, round)
  const durationMs = roundEntries.reduce(
    (total, entry) => total + (entry.durationMs ?? (entry.completedAt - entry.startedAt)),
    0,
  )

  const usage = emptyUsage()
  let usageAvailable = false
  const usageByAgent: Record<string, AgentUsageSnapshot> = {}

  if (!sessionTelemetry?.sessions.length) {
    return { durationMs, usage, usageAvailable: false, costAvailable: false, usageByAgent }
  }

  for (const session of sessionTelemetry.sessions) {
    const agent = usageByAgent[session.role] ?? { ...emptyUsage(), usageAvailable: false }
    for (const call of session.calls) {
      if (!callMatchesNodeRound(call, session, aliases, roundEntries, round)) continue
      usageAvailable = true
      addSessionCallUsage(usage, call)
      addSessionCallUsage(agent, call)
      agent.usageAvailable = true
    }
    if (agent.usageAvailable) usageByAgent[session.role] = agent
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

export function sessionTotalsForLiveNode(
  sessionTelemetry: SessionTelemetryFile | null | undefined,
  liveStatus: LiveStatus | null,
): {
  usage: UsageTotals
  usageAvailable: boolean
  costAvailable: boolean
  costEstimated?: boolean
  usageByAgent: Record<string, AgentUsageSnapshot>
} {
  const usage = emptyUsage()
  let usageAvailable = false
  const usageByAgent: Record<string, AgentUsageSnapshot> = {}
  if (!sessionTelemetry?.sessions.length || !liveStatus?.node) {
    return { usage, usageAvailable: false, costAvailable: false, usageByAgent }
  }

  const aliases = nodeAliases(liveStatus.node)
  for (const session of sessionTelemetry.sessions) {
    if (!session.node || !aliases.has(session.node)) continue
    const agent = usageByAgent[session.role] ?? { ...emptyUsage(), usageAvailable: false }
    for (const call of session.calls) {
      if (!call.usage) continue
      usageAvailable = true
      addSessionCallUsage(usage, call)
      addSessionCallUsage(agent, call)
      agent.usageAvailable = true
    }
    if (agent.usageAvailable) usageByAgent[session.role] = agent
  }

  return {
    usage,
    usageAvailable,
    costAvailable: usage.costAvailable === true,
    costEstimated: usage.costEstimated,
    usageByAgent,
  }
}

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
  sessionTelemetry?: SessionTelemetryFile | null,
): {
  usage: UsageTotals
  usageAvailable: boolean
  costAvailable: boolean
  costEstimated?: boolean
} {
  if (!sessionTelemetry?.sessions.length) {
    return { usage: emptyUsage(), usageAvailable: false, costAvailable: false }
  }

  const usage = sumSessionTelemetryUsage({
    version: 1,
    sessions: sessionTelemetry.sessions.map((session) => ({
      ...session,
      calls: session.calls.map((call) => ({
        ...call,
        usage: call.usage
          ? normalizeUsageForDisplay(call.usage, call.usageSource)
          : undefined,
      })),
    })),
  })

  return {
    usage,
    usageAvailable: usage.usageAvailable,
    costAvailable: usage.costAvailable === true,
    costEstimated: usage.costEstimated === true,
  }
}

/** @deprecated Use resolveRunTelemetry(sessionTelemetry) */
export function resolveRunUsage(
  _liveStatus: LiveStatus | null,
  _nodeHistory: NodeHistoryEntry[],
  sessionTelemetry?: SessionTelemetryFile | null,
): { usage: UsageTotals; usageAvailable: boolean } {
  const resolved = resolveRunTelemetry(sessionTelemetry)
  return { usage: resolved.usage, usageAvailable: resolved.usageAvailable }
}

/** @deprecated Use sessionTotalsForNode */
export function nodeHistoryTotalsForNode(
  nodeHistory: NodeHistoryEntry[],
  nodeName: string,
  sessionTelemetry?: SessionTelemetryFile | null,
) {
  return sessionTotalsForNode(sessionTelemetry, nodeHistory, nodeName)
}

function formatTelemetryUsageLabel(usage: UsageTotals, usageAvailable: boolean): string {
  if (!usageAvailable) return ""
  return formatUsagePair(usage, true)
}

export type RunTelemetryExtras = {
  fileCount?: number
  totalBytes?: number
}

function formatModelParams(params?: Array<{ id: string; value: string }>): string {
  if (!params?.length) return "—"
  return params.map((entry) => `${entry.id}=${entry.value}`).join(", ")
}

export function sessionsForNodeScope(
  sessionTelemetry: SessionTelemetryFile | null | undefined,
  nodeHistory: NodeHistoryEntry[],
  nodeName: string,
  round?: number,
  liveStatus?: LiveStatus | null,
): SessionTelemetryFile["sessions"] {
  if (!sessionTelemetry?.sessions.length) return []

  const aliases = nodeAliases(nodeName)
  const nodeId = getNodeDefinition(nodeName)?.id ?? nodeName
  const scopeEntries = nodeHistoryEntriesForNodeScope(nodeHistory, nodeName)
  const active = liveStatus?.phase === "running"
    && (resolveLiveNode(liveStatus) === nodeId || (liveStatus.node !== undefined && aliases.has(liveStatus.node)))

  const hasUsage = (session: SessionTelemetryFile["sessions"][number]) =>
    session.calls.some((call) => call.usage)

  if (round !== undefined) {
    const roundEntries = nodeHistoryEntriesForNodeScope(nodeHistory, nodeName, round)
    return sessionTelemetry.sessions
      .map((session) => filterSessionForNodeRound(session, aliases, roundEntries, round))
      .filter((session): session is SessionRecord => session !== null)
  }

  if (active && liveStatus) {
    return sessionTelemetry.sessions.filter(
      (session) => session.node !== undefined && aliases.has(session.node) && hasUsage(session),
    )
  }

  if (nodeId === "draftFullDraft") {
    return sessionTelemetry.sessions
      .map((session) => {
        const calls = session.calls.filter((call) =>
          call.usage && scopeEntries.some((entry) => callMatchesNodeEntry(call, entry)),
        )
        if (calls.length === 0) return null
        return { ...session, calls }
      })
      .filter((session): session is SessionRecord => session !== null)
  }

  return sessionTelemetry.sessions.filter(
    (session) => sessionMatchesNode(session, aliases, scopeEntries) && hasUsage(session),
  )
}

function renderSessionUsageTableBody(sessions: SessionTelemetryFile["sessions"]): string {
  const withUsage = sessions.filter((session) => session.calls.some((call) => call.usage))
  if (withUsage.length === 0) return ""

  let table = `<table class="summary-table summary-table-wide summary-table-compact"><thead><tr><th>Time</th><th>Role</th><th>Provider</th><th>Model</th><th>Parameters</th><th>Calls</th><th>Tokens</th><th>Cost</th></tr></thead><tbody>`

  for (const session of [...withUsage].sort(
    (a, b) => sessionLatestActivityMs(b) - sessionLatestActivityMs(a),
  )) {
    const usage = emptyUsage()
    let usageAvailable = false
    for (const call of session.calls) {
      if (!call.usage) continue
      usageAvailable = true
      addSessionCallUsage(usage, call)
    }
    const usageLabel = usageAvailable ? formatTokenPair(usage, true) : "—"
    const models = [...new Set(session.calls.map((call) => call.resolvedModel).filter(Boolean))]
    table += `<tr>
  <td class="dim-text tiny-text">${escapeHtml(formatSessionActivityTime(session))}</td>
  <td>${escapeHtml(session.role)}</td>
  <td>${escapeHtml(session.provider)}</td>
  <td>${escapeHtml(models.join(", ") || "—")}</td>
  <td>${escapeHtml(formatModelParams(session.modelParams))}</td>
  <td>${session.calls.length}</td>
  <td>${escapeHtml(usageLabel)}</td>
  <td>${escapeHtml(formatAgentCostCell(usage))}</td>
</tr>`
  }

  table += "</tbody></table>"
  return tableWrap(table)
}

export function renderNodeSessionUsageTable(
  sessionTelemetry: SessionTelemetryFile | null | undefined,
  nodeHistory: NodeHistoryEntry[],
  nodeName: string,
  round?: number,
  liveStatus?: LiveStatus | null,
): string {
  const sessions = sessionsForNodeScope(sessionTelemetry, nodeHistory, nodeName, round, liveStatus)
  const table = renderSessionUsageTableBody(sessions)
  if (!table) return ""
  return `<div class="section"><h2>Agent token usage</h2>${table}</div>`
}

export function sessionUsageForHistoryEntry(
  sessionTelemetry: SessionTelemetryFile | null | undefined,
  entry: NodeHistoryEntry,
): UsageTotals & { usageAvailable: boolean } {
  const usage = emptyUsage()
  let usageAvailable = false
  if (!sessionTelemetry?.sessions.length) return { ...usage, usageAvailable: false }

  for (const session of sessionTelemetry.sessions) {
    for (const call of session.calls) {
      if (!call.usage || !call.completedAt) continue
      const timestamp = Date.parse(call.completedAt)
      if (!Number.isFinite(timestamp) || timestamp < entry.startedAt || timestamp > entry.completedAt) continue
      if (session.node && session.node !== entry.node) continue
      usageAvailable = true
      addSessionCallUsage(usage, call)
    }
  }

  return { ...usage, usageAvailable }
}

export function renderSessionTelemetryTable(sessionTelemetry: SessionTelemetryFile | null | undefined): string {
  if (!sessionTelemetry?.sessions.length) return ""
  const table = renderSessionUsageTableBody(sessionTelemetry.sessions)
  if (!table) return ""
  return `<div class="section"><h2>Session model telemetry</h2>${table}</div>`
}

export function renderRunTelemetryStrip(
  liveStatus: LiveStatus | null,
  nodeHistory: NodeHistoryEntry[],
  extras?: RunTelemetryExtras,
  sessionTelemetry?: SessionTelemetryFile | null,
): string {
  const elapsedMs = runElapsedMs(liveStatus, nodeHistory)
  const { usage, usageAvailable, costAvailable } = resolveRunTelemetry(sessionTelemetry)
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
): string {
  const rows = Object.entries(usageByAgent)
    .filter(([, snapshot]) => snapshot.usageAvailable)
    .sort(([a], [b]) => a.localeCompare(b))

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
  sessionTelemetry?: SessionTelemetryFile | null,
  round?: number,
): string {
  const def = getNodeDefinition(nodeName)
  const nodeId = def?.id ?? nodeName
  const active = liveStatus?.phase === "running" && liveStatus.node === nodeId
  const activeRound = active && round !== undefined && liveStatus!.round === round

  if (activeRound && liveStatus) {
    const elapsed = liveStatus.nodeStartedAt ? formatElapsed(Date.now() - liveStatus.nodeStartedAt) : undefined
    const totals = sessionTotalsForNodeRound(sessionTelemetry, nodeHistory, nodeName, round)
    const parts: string[] = []
    if (elapsed) parts.push(`${elapsed} elapsed`)
    const usageLabel = formatTelemetryUsageLabel(totals.usage, totals.usageAvailable || totals.costAvailable)
    if (usageLabel) parts.push(usageLabel)
    if (parts.length === 0) return ""
    return `<div class="telemetry-strip telemetry-strip-compact">${parts.map((part) => `<span class="telemetry-chip">${escapeHtml(part)}</span>`).join("")}</div>`
  }

  if (active && round === undefined && liveStatus) {
    const elapsed = liveStatus.nodeStartedAt ? formatElapsed(Date.now() - liveStatus.nodeStartedAt) : undefined
    const totals = sessionTotalsForLiveNode(sessionTelemetry, liveStatus)
    const parts: string[] = []
    if (elapsed) parts.push(`${elapsed} elapsed`)
    const usageLabel = formatTelemetryUsageLabel(totals.usage, totals.usageAvailable || totals.costAvailable)
    if (usageLabel) parts.push(usageLabel)
    if (parts.length === 0) return ""
    return `<div class="telemetry-strip telemetry-strip-compact">${parts.map((part) => `<span class="telemetry-chip">${escapeHtml(part)}</span>`).join("")}</div>`
  }

  const totals = round !== undefined
    ? sessionTotalsForNodeRound(sessionTelemetry, nodeHistory, nodeName, round)
    : sessionTotalsForNode(sessionTelemetry, nodeHistory, nodeName)
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
  sessionTelemetry?: SessionTelemetryFile | null,
): string {
  const totals = sessionTotalsForNode(sessionTelemetry, nodeHistory, nodeId)
  const parts: string[] = []
  if (totals.durationMs > 0) parts.push(formatDurationMs(totals.durationMs))
  const usageLabel = formatTelemetryUsageLabel(totals.usage, totals.usageAvailable || totals.costAvailable)
  if (usageLabel) parts.push(usageLabel)
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : ""
}

export function usageLabelForRole(
  sessionTelemetry: SessionTelemetryFile | null | undefined,
  role: string,
): string {
  const byRole = usageByRoleFromSession(sessionTelemetry)
  const snapshot = byRole[role]
  if (!snapshot?.usageAvailable && !snapshot?.costAvailable) return ""
  return formatUsagePair(snapshot, snapshot.usageAvailable || snapshot.costAvailable === true)
}
