import { estimateCursorCostFromUsage } from "../cursor-pricing"
import { addUsage, emptyUsage, type UsageTotals } from "../usage"
import { type SessionPromptAccounting, type SessionTelemetryFile } from "../session-telemetry"
import { tableWrap } from "./html"
import { getNodeDefinition, resolveLiveNode } from "./node-registry"
import { escapeHtml, formatBytes, formatCostUsd, formatDurationMs, formatElapsed, formatTokenCount, formatTokenPair, formatUsagePair } from "./utils"
import type { AgentUsageSnapshot, LiveStatus, NodeHistoryEntry } from "./types"

function nodeAliases(nodeName: string): Set<string> {
  const def = getNodeDefinition(nodeName)
  return new Set([nodeName, ...(def?.liveNodeAliases ?? []), def?.id, def?.pipelineLabel].filter(Boolean) as string[])
}

function fillMissingCursorCost(
  usage: UsageTotals,
  usageSource: SessionTelemetryFile["sessions"][number]["calls"][number]["usageSource"],
  model?: string,
): UsageTotals {
  if (usage.costAvailable) return usage
  if (usageSource === "opencode-import" || usageSource === "turso-import") return usage
  if (!model) return usage
  const estimated = estimateCursorCostFromUsage(model, usage)
  if (!estimated.costAvailable) return usage
  return {
    ...usage,
    costUsd: estimated.costUsd,
    costAvailable: true,
    costEstimated: true,
  }
}

function normalizeUsageForDisplay(
  usage: UsageTotals,
  usageSource?: SessionTelemetryFile["sessions"][number]["calls"][number]["usageSource"],
  model?: string,
): UsageTotals {
  const withCost = fillMissingCursorCost(usage, usageSource, model)
  if ((usageSource === "turso-import" || usageSource === "opencode-import") && withCost.costAvailable) {
    return { ...withCost, costEstimated: false }
  }
  if (usageSource === "csv-import" && withCost.costAvailable && !withCost.costEstimated) {
    return { ...withCost, costEstimated: false }
  }
  return withCost
}

function addSessionCallUsage(
  target: UsageTotals,
  call: SessionTelemetryFile["sessions"][number]["calls"][number],
  session?: SessionTelemetryFile["sessions"][number],
) {
  if (!call.usage) return
  addUsage(target, normalizeUsageForDisplay(
    call.usage,
    call.usageSource,
    call.resolvedModel ?? session?.requestedModel,
  ))
}

/** Sum each session's calls once. Keep-alive sessions that touch several nodes still count once. */
export function sumSessionsForDisplay(
  sessions: SessionTelemetryFile["sessions"],
): UsageTotals & { usageAvailable: boolean } {
  const usage: UsageTotals & { usageAvailable: boolean } = {
    ...emptyUsage(),
    usageAvailable: false,
  }
  for (const session of sessions) {
    for (const call of session.calls) {
      if (!call.usage) continue
      usage.usageAvailable = true
      addSessionCallUsage(usage, call, session)
    }
  }
  return usage
}

type SessionRecord = SessionTelemetryFile["sessions"][number]
type SessionCall = SessionRecord["calls"][number]

export function canonicalNodeId(nodeName: string): string | undefined {
  return getNodeDefinition(nodeName)?.id
}

function sessionActivityTimestamps(session: SessionRecord): number[] {
  const times: number[] = []
  if (session.createdAt) {
    const created = Date.parse(session.createdAt)
    if (Number.isFinite(created)) times.push(created)
  }
  for (const call of session.calls) {
    if (!call.completedAt) continue
    const timestamp = Date.parse(call.completedAt)
    if (Number.isFinite(timestamp)) times.push(timestamp)
  }
  for (const prompt of session.prompts ?? []) {
    const timestamp = Date.parse(prompt.at)
    if (Number.isFinite(timestamp)) times.push(timestamp)
  }
  return times
}

/** Graph nodes this session touched. Association only — spend stays on the session. */
export function relatedNodeIdsForSession(
  session: SessionRecord,
  nodeHistory: NodeHistoryEntry[] = [],
): string[] {
  const ids = new Set<string>()
  const add = (raw?: string) => {
    const id = raw ? canonicalNodeId(raw) : undefined
    if (id) ids.add(id)
  }

  add(session.node)
  for (const call of session.calls) add(call.node)
  for (const prompt of session.prompts ?? []) add(prompt.node)

  for (const timestamp of sessionActivityTimestamps(session)) {
    for (const entry of nodeHistory) {
      if (timestamp >= entry.startedAt && timestamp <= entry.completedAt) add(entry.node)
    }
  }

  return [...ids].sort((a, b) => {
    const orderA = getNodeDefinition(a)?.order ?? 999
    const orderB = getNodeDefinition(b)?.order ?? 999
    return orderA - orderB || a.localeCompare(b)
  })
}

export function formatRelatedNodeLabels(nodeIds: string[]): string {
  if (nodeIds.length === 0) return "—"
  return nodeIds.map((id) => getNodeDefinition(id)?.label ?? id).join(", ")
}

function sessionRelatedToNode(
  session: SessionRecord,
  nodeHistory: NodeHistoryEntry[],
  nodeName: string,
  round?: number,
  liveStatus?: LiveStatus | null,
): boolean {
  const aliases = nodeAliases(nodeName)
  const nodeId = getNodeDefinition(nodeName)?.id ?? nodeName
  const related = relatedNodeIdsForSession(session, nodeHistory)
  const scopeEntries = nodeHistoryEntriesForNodeScope(nodeHistory, nodeName)
  const scopeIds = new Set<string>([nodeId, ...aliases])
  for (const entry of scopeEntries) {
    scopeIds.add(canonicalNodeId(entry.node) ?? entry.node)
  }
  const active = liveStatus?.phase === "running"
    && (resolveLiveNode(liveStatus) === nodeId || (liveStatus.node !== undefined && aliases.has(liveStatus.node)))

  const matchesNode = related.some((id) => scopeIds.has(id))
    || (active && session.node !== undefined && aliases.has(session.node))
  if (!matchesNode) return false
  if (round === undefined) return true

  if (session.round === round && session.node && scopeIds.has(canonicalNodeId(session.node) ?? session.node)) {
    return true
  }
  if (session.calls.some((call) => call.round === round && call.node && scopeIds.has(canonicalNodeId(call.node) ?? call.node))) {
    return true
  }
  if (session.prompts?.some((prompt) => prompt.round === round && prompt.node && scopeIds.has(canonicalNodeId(prompt.node) ?? prompt.node))) {
    return true
  }

  const roundEntries = nodeHistoryEntriesForNodeScope(nodeHistory, nodeName, round)
  const times = sessionActivityTimestamps(session)
  return roundEntries.some((entry) =>
    times.some((timestamp) => timestamp >= entry.startedAt && timestamp <= entry.completedAt),
  )
}

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
    && ((call.node && aliases.has(call.node) && (call.round === round || call.round == null))
      || (session.round === round && session.node && aliases.has(session.node)))) {
    return true
  }

  return false
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

function sessionMatchesDraftScope(
  session: SessionRecord,
  entries: NodeHistoryEntry[],
): boolean {
  if (session.node !== "draftFullDraft" && session.node !== "reviseDraft") return false

  const nodeEntries = entries.filter((entry) => entry.node === session.node)
  if (nodeEntries.length === 0) return true
  if (session.round === undefined) return true
  return nodeEntries.some((entry) => entry.round === session.round)
}

function callBelongsToNode(
  call: SessionCall,
  session: SessionRecord,
  aliases: Set<string>,
  entries: NodeHistoryEntry[],
  nodeId: string,
): boolean {
  if (!call.usage) return false

  if (call.node) return aliases.has(call.node)

  if (nodeId === "draftFullDraft") {
    return sessionMatchesDraftScope(session, entries)
      || entries.some((entry) => callMatchesNodeEntry(call, entry))
  }

  if (entries.some((entry) => callMatchesNodeEntry(call, entry))) return true

  if (entries.length === 0 && session.node && aliases.has(session.node)) return true

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
      addSessionCallUsage(snapshot, call, session)
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

  for (const session of sessionTelemetry.sessions) {
    const agent = usageByAgent[session.role] ?? { ...emptyUsage(), usageAvailable: false }
    for (const call of session.calls) {
      if (!callBelongsToNode(call, session, aliases, entries, nodeId)) continue
      usageAvailable = true
      addSessionCallUsage(usage, call, session)
      addSessionCallUsage(agent, call, session)
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
      addSessionCallUsage(usage, call, session)
      addSessionCallUsage(agent, call, session)
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

function graphClockMs(liveStatus: LiveStatus | null, nodeHistory: NodeHistoryEntry[], now = Date.now()): number {
  if (liveStatus?.phase === "running") {
    if (liveStatus.awaitingReaderReply || liveStatus.pausedAt != null) {
      return liveStatus.pausedAt
        ?? liveStatus.nodeStartedAt
        ?? liveStatus.runStartedAt
        ?? now
    }
    return now
  }
  const last = (liveStatus?.nodeHistory ?? nodeHistory).at(-1)
  return last?.completedAt ?? liveStatus?.runStartedAt ?? now
}

/** Elapsed time the graph was moving: wall clock minus interview / idle waits. */
export function runElapsedMs(
  liveStatus: LiveStatus | null,
  nodeHistory: NodeHistoryEntry[],
  now = Date.now(),
): number | undefined {
  const startedAt = liveStatus?.runStartedAt
    ?? (nodeHistory.length > 0 ? nodeHistory[0]!.startedAt : undefined)
  if (!startedAt) return undefined

  const pausedMs = liveStatus?.pausedMs ?? 0
  return Math.max(0, graphClockMs(liveStatus, nodeHistory, now) - startedAt - pausedMs)
}

export function nodeActiveElapsedMs(liveStatus: LiveStatus | null, now = Date.now()): number | undefined {
  if (!liveStatus?.nodeStartedAt) return undefined
  const clock = graphClockMs(liveStatus, liveStatus.nodeHistory ?? [], now)
  return Math.max(0, clock - liveStatus.nodeStartedAt)
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

  const usage = sumSessionsForDisplay(sessionTelemetry.sessions)
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

  return sessionTelemetry.sessions.filter((session) =>
    sessionRelatedToNode(session, nodeHistory, nodeName, round, liveStatus),
  )
}

function renderSessionUsageTableBody(
  sessions: SessionTelemetryFile["sessions"],
  nodeHistory: NodeHistoryEntry[] = [],
  options?: { includeRunTotal?: boolean },
): string {
  const withUsage = sessions.filter((session) => session.calls.some((call) => call.usage))
  if (withUsage.length === 0) return ""

  let table = `<table class="summary-table summary-table-wide summary-table-compact"><thead><tr><th>Time</th><th>Role</th><th>Nodes</th><th>Provider</th><th>Model</th><th>Parameters</th><th>Calls</th><th>Tokens</th><th>Cost</th></tr></thead><tbody>`

  for (const session of [...withUsage].sort(
    (a, b) => sessionLatestActivityMs(b) - sessionLatestActivityMs(a),
  )) {
    const usage = emptyUsage()
    let usageAvailable = false
    for (const call of session.calls) {
      if (!call.usage) continue
      usageAvailable = true
      addSessionCallUsage(usage, call, session)
    }
    const usageLabel = usageAvailable ? formatTokenPair(usage, true) : "—"
    const models = [...new Set(session.calls.map((call) => call.resolvedModel).filter(Boolean))]
    const nodes = formatRelatedNodeLabels(relatedNodeIdsForSession(session, nodeHistory))
    table += `<tr>
  <td class="dim-text tiny-text">${escapeHtml(formatSessionActivityTime(session))}</td>
  <td>${escapeHtml(session.role)}</td>
  <td class="session-nodes">${escapeHtml(nodes)}</td>
  <td>${escapeHtml(session.provider)}</td>
  <td>${escapeHtml(models.join(", ") || "—")}</td>
  <td>${escapeHtml(formatModelParams(session.modelParams))}</td>
  <td>${session.calls.length}</td>
  <td>${escapeHtml(usageLabel)}</td>
  <td>${escapeHtml(formatAgentCostCell(usage))}</td>
</tr>`
  }

  table += "</tbody>"
  if (options?.includeRunTotal) {
    const runUsage = sumSessionsForDisplay(withUsage)
    const callCount = withUsage.reduce((total, session) => total + session.calls.length, 0)
    table += `<tfoot><tr>
  <th colspan="6">Run total</th>
  <td>${callCount}</td>
  <td>${escapeHtml(formatTokenPair(runUsage, true))}</td>
  <td>${escapeHtml(formatAgentCostCell(runUsage))}</td>
</tr></tfoot>`
  }
  table += "</table>"
  return tableWrap(table)
}

function formatStandingContextCell(prompt: SessionPromptAccounting): string {
  const parts: string[] = []
  if (prompt.standingContextIncluded != null) {
    parts.push(prompt.standingContextIncluded ? "standing included" : "standing omitted")
  }
  if (prompt.frontendSkillIncluded != null) {
    parts.push(prompt.frontendSkillIncluded ? "skill included" : "skill omitted")
  }
  return parts.join(" · ") || "—"
}

function formatKeepAliveCell(prompt: SessionPromptAccounting): string {
  if (!prompt.keepAlive) return "one-shot"
  return prompt.keepAliveFresh ? "fresh" : "follow-up"
}

function formatPromptSizeCell(prompt: SessionPromptAccounting): string {
  const chars = `${formatTokenCount(prompt.promptChars)} chars`
  const estimate = `~${formatTokenCount(prompt.estimatedPromptTokens)} tok`
  if (prompt.inputFileCount > 0) {
    const files = `${prompt.inputFileCount} file${prompt.inputFileCount === 1 ? "" : "s"} · ${formatBytes(prompt.inputFileBytes)}`
    const inline = prompt.inlined ? "inlined" : "attached"
    return `${chars} (${estimate}) · ${files} ${inline}`
  }
  return `${chars} (${estimate})`
}

function renderPromptAccountingTableBody(sessions: SessionTelemetryFile["sessions"]): string {
  const rows: Array<{ session: SessionTelemetryFile["sessions"][number]; prompt: SessionPromptAccounting }> = []
  for (const session of sessions) {
    for (const prompt of session.prompts ?? []) rows.push({ session, prompt })
  }
  if (rows.length === 0) return ""

  rows.sort((a, b) => b.prompt.at.localeCompare(a.prompt.at))

  let table = `<table class="summary-table summary-table-wide summary-table-compact"><thead><tr><th>Time</th><th>Role</th><th>Node</th><th>Session</th><th>Repeated context</th><th>Prompt</th></tr></thead><tbody>`
  for (const { session, prompt } of rows) {
    const time = prompt.at.replace("T", " ").slice(0, 19) + " UTC"
    const node = prompt.node ?? session.node ?? "—"
    table += `<tr>
  <td class="dim-text tiny-text">${escapeHtml(time)}</td>
  <td>${escapeHtml(session.role)}</td>
  <td>${escapeHtml(node)}</td>
  <td>${escapeHtml(formatKeepAliveCell(prompt))}</td>
  <td>${escapeHtml(formatStandingContextCell(prompt))}</td>
  <td>${escapeHtml(formatPromptSizeCell(prompt))}</td>
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
  const table = renderSessionUsageTableBody(sessions, nodeHistory)
  if (!table) return ""
  return `<div class="section"><h2>Related agent sessions</h2>
<p class="muted-note dim-text">Spend is counted for the whole session. Keep-alive sessions list every node they touched.</p>
${table}</div>`
}

export function renderSessionTelemetryTable(
  sessionTelemetry: SessionTelemetryFile | null | undefined,
  nodeHistory: NodeHistoryEntry[] = [],
): string {
  if (!sessionTelemetry?.sessions.length) return ""
  const usageTable = renderSessionUsageTableBody(sessionTelemetry.sessions, nodeHistory, { includeRunTotal: true })
  const promptTable = renderPromptAccountingTableBody(sessionTelemetry.sessions)
  if (!usageTable && !promptTable) return ""
  const sections: string[] = []
  if (usageTable) sections.push(`<div class="section"><h2>Agent sessions</h2>
<p class="muted-note dim-text">The run total is the sum of these sessions, counted once even when a session relates to several nodes.</p>
${usageTable}</div>`)
  if (promptTable) sections.push(`<div class="section"><h2>Prompt accounting</h2>${promptTable}</div>`)
  return sections.join("")
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
    const elapsedMs = nodeActiveElapsedMs(liveStatus)
    const elapsed = elapsedMs !== undefined ? formatElapsed(elapsedMs) : undefined
    if (!elapsed) return ""
    return `<div class="telemetry-strip telemetry-strip-compact"><span class="telemetry-chip">${escapeHtml(`${elapsed} elapsed`)}</span></div>`
  }

  if (active && round === undefined && liveStatus) {
    const elapsedMs = nodeActiveElapsedMs(liveStatus)
    const elapsed = elapsedMs !== undefined ? formatElapsed(elapsedMs) : undefined
    if (!elapsed) return ""
    return `<div class="telemetry-strip telemetry-strip-compact"><span class="telemetry-chip">${escapeHtml(`${elapsed} elapsed`)}</span></div>`
  }

  const totals = round !== undefined
    ? sessionTotalsForNodeRound(sessionTelemetry, nodeHistory, nodeName, round)
    : sessionTotalsForNode(sessionTelemetry, nodeHistory, nodeName)
  if (totals.durationMs <= 0) return ""

  return `<div class="telemetry-strip telemetry-strip-compact"><span class="telemetry-chip">${escapeHtml(`${formatDurationMs(totals.durationMs)} total`)}</span></div>`
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
