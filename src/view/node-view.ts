import {
  designRoundNumbers,
  renderDesignHtmlScope,
  renderDiscoverReaderScope,
  readerInterviewArtifactFiles,
  renderDraftFullDraftScope,
  renderInteractiveEnhanceScope,
  renderReadingExperienceEnhanceScope,
} from "./node-content-view"
import { renderFileBrowser } from "./file-browser"
import { GRAPH_NODES, filesForNode, filesForNodeRound, filesForRebuttalsViewer, getNodeDefinition, isNodeActive, isNodeComplete, isRebuttalsViewerNode, nodeKpis, rebuttalsTelemetryNodeId, resolveLiveNode, REBUTTALS_VIEWER_NODE_ID } from "./node-registry"
import { indexRunArtifacts, roundHasRebuttalActivity, type RoundArtifacts } from "./run-artifacts"
import { renderAgentActivity } from "./components"
import {
  buildRoundAuditVoteRows,
  readAuditBundle,
  renderAllAuditRounds,
  renderAuditorFindingsBlocks,
  renderAuditVoteTable,
  renderRoundAuditVoteTable,
} from "./audit-view"
import { renderConsensusRound, renderDrafterReview, renderRebuttalsRound, type RebuttalsRoundData, type RebuttalReviewTurnData } from "./artifact-renderers"
import type { AggregatedFindings } from "./types"
import {
  renderNodeSessionUsageTable,
  renderNodeTelemetryMeta,
  sessionTotalsForLiveNode,
  sessionTotalsForNode,
  sessionUsageForHistoryEntry,
} from "./telemetry-view"
import { safeFilePath } from "./paths"
import type { SessionTelemetryFile } from "../session-telemetry"
import { escapeHtml, formatDurationMs, formatElapsed, formatUsagePair } from "./utils"
import type { LiveStatus, NodeHistoryEntry, RebuttalEntry, RebuttalResponseEntry, RunStatus } from "./types"

type NodeScope = "total" | number

export function researchRoundNumbers(
  files: string[],
  liveStatus: LiveStatus | null,
  nodeHistory: NodeHistoryEntry[] = [],
): number[] {
  const index = indexRunArtifacts(files)
  const rounds = new Set<number>()
  for (const round of index.rounds) rounds.add(round.round)
  for (const entry of nodeHistory) rounds.add(entry.round)
  if (liveStatus?.phase === "running" && liveStatus.round !== undefined) {
    rounds.add(liveStatus.round)
  }
  return [...rounds].sort((a, b) => a - b)
}

export function renderGlobalResearchRoundStrip(
  runName: string,
  files: string[],
  liveStatus: LiveStatus | null,
  nodeHistory: NodeHistoryEntry[] = [],
  options?: { rounds?: number[]; ariaLabel?: string },
): string {
  const rounds = options?.rounds ?? researchRoundNumbers(files, liveStatus, nodeHistory)
  if (rounds.length === 0) return ""

  const currentRound = liveStatus?.phase === "running" ? liveStatus.round : undefined
  const defaultTab = currentRound !== undefined ? String(currentRound) : "total"

  let tabs = `<button type="button" class="round-chip${defaultTab === "total" ? " active" : ""}" data-round-tab="total" role="tab" aria-selected="${defaultTab === "total" ? "true" : "false"}">
  <span class="round-chip-num">Total</span>
</button>`

  for (const roundNum of rounds) {
    const isCurrent = currentRound === roundNum
    const tabActive = defaultTab === String(roundNum)
    tabs += `<button type="button" class="round-chip${tabActive ? " active" : ""}" data-round-tab="${roundNum}" role="tab" aria-selected="${tabActive ? "true" : "false"}">
  <span class="round-chip-num">R${roundNum}</span>
  ${isCurrent ? `<span class="round-chip-live">●</span>` : ""}
</button>`
  }

  return `<div class="global-round-nav">
  <div class="round-strip global-round-strip" data-round-tablist data-run-round-tabs="${escapeHtml(runName)}" role="tablist" aria-label="${escapeHtml(options?.ariaLabel ?? "Round scope")}">${tabs}</div>
</div>`
}

export function renderNodeGrid(
  runName: string,
  files: string[],
  liveStatus: LiveStatus | null,
  researchStatus: RunStatus = "running",
  nodeHistory: NodeHistoryEntry[] = [],
  sessionTelemetry?: SessionTelemetryFile | null,
): string {
  const index = indexRunArtifacts(files)
  const activeNode = resolveLiveNode(liveStatus)

  let cards = ""
  for (const node of GRAPH_NODES) {
    if (node.phase === "setup" && node.order > 4) continue
    if (node.id === "runTargetedRebuttals") continue
    const nodeId = node.pipelineLabel ?? node.id
    const active = activeNode === node.id || isNodeActive(liveStatus, node.id)
    const completed = isNodeComplete(node.id, files, researchStatus, liveStatus, index)
    const kpis = nodeKpis(node.id, files, index)
    const telemetryNode = node.id === REBUTTALS_VIEWER_NODE_ID ? rebuttalsTelemetryNodeId() : node.id
    const totals = sessionTotalsForNode(sessionTelemetry, nodeHistory, telemetryNode)
    if (totals.durationMs > 0) {
      kpis.unshift({ label: "Time", value: formatDurationMs(totals.durationMs) })
    }
    if (totals.usageAvailable || totals.costAvailable) {
      kpis.unshift({ label: "Usage", value: formatUsagePair(totals.usage, true) })
    }

    let statusIcon = "○"
    if (active) statusIcon = "●"
    else if (completed) statusIcon = "✓"

    const kpiHtml = kpis.slice(0, 3).map((k) =>
      `<span class="node-grid-kpi">${escapeHtml(k.label)}: <strong>${escapeHtml(k.value)}</strong></span>`
    ).join("")

    cards += `<a class="node-grid-card${active ? " active" : ""}" href="/runs/${encodeURIComponent(runName)}/node/${encodeURIComponent(nodeId)}">
  <div class="node-grid-title"><span class="pipeline-icon">${statusIcon}</span> ${escapeHtml(node.label)}</div>
  ${kpiHtml ? `<div class="node-grid-kpis">${kpiHtml}</div>` : ""}
</a>`
  }

  return `<div class="section"><h2>Nodes</h2><div class="node-grid">${cards}</div></div>`
}

export function renderNodeExecutionHistory(
  entries: NodeHistoryEntry[],
  nodeName: string,
  _runName: string,
  sessionTelemetry?: SessionTelemetryFile | null,
): string {
  const def = getNodeDefinition(nodeName)
  const aliases = new Set([nodeName, ...(def?.liveNodeAliases ?? []), def?.id, def?.pipelineLabel].filter(Boolean) as string[])
  const filtered = entries.filter((e) => aliases.has(e.node))
  if (filtered.length === 0) return ""

  let html = `<div class="section"><h2>Execution history</h2><div class="card stack-card stack-card-history">`
  for (const entry of [...filtered].reverse()) {
    const elapsed = entry.durationMs ?? (entry.completedAt - entry.startedAt)
    const elapsedStr = formatDurationMs(elapsed)
    const usage = sessionUsageForHistoryEntry(sessionTelemetry, entry)
    const usageStr = usage.usageAvailable || usage.costAvailable
      ? ` · ${formatUsagePair(usage, true)}`
      : ""
    const icon = entry.status === "completed" ? "✓" : "✗"
    html += `<div class="node-history-row">
  <span class="node-history-icon ${entry.status === "completed" ? "success-text" : "danger-text"}">${icon}</span>
  <span class="node-history-link">${escapeHtml(entry.node)}</span>
  <span class="node-history-meta">${elapsedStr}${usageStr}</span>
  ${entry.round > 0 || entry.round === 0 ? `<span class="node-history-extra">· round ${entry.round}</span>` : ""}
  ${entry.rebuttalTurn ? `<span class="node-history-extra">· turn ${entry.rebuttalTurn}</span>` : ""}
  ${entry.summary ? `<span class="node-history-extra">· ${escapeHtml(formatSummary(entry.summary))}</span>` : ""}
  ${entry.error ? `<span class="node-history-error">${escapeHtml(entry.error.slice(0, 80))}</span>` : ""}
</div>`
  }
  html += `</div></div>`
  return html
}

function formatSummary(summary: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(summary)) {
    if (v === undefined) continue
    parts.push(`${k}: ${v}`)
  }
  return parts.join(", ").slice(0, 120)
}

function emptyRoundArtifacts(round: number): RoundArtifacts {
  return { round, perAgentAudits: [], rebuttalTurns: [], perAgentRebuttalInputs: [] }
}

function renderArtifactsSection(
  runName: string,
  files: string[],
  fileSizes: Map<string, number>,
): string {
  if (files.length === 0) return ""
  const subsetSizes = new Map<string, number>()
  for (const f of files) subsetSizes.set(f, fileSizes.get(f) ?? 0)
  return `<div class="section"><h2>Artifacts</h2>${renderFileBrowser({ runName, files, fileSizes: subsetSizes, hideSubgroupHeadings: true })}</div>`
}

async function renderAuditRoundPanelBody(
  runName: string,
  round: RoundArtifacts,
  liveStatus: LiveStatus | null,
  isCurrentRound: boolean,
): Promise<string> {
  if (round.audits) {
    const data = await readAuditBundle(runName, round.audits)
    if (data) {
      const rawHref = `/runs/${encodeURIComponent(runName)}/raw/${encodeURIComponent(round.audits)}`
      const expanded = isCurrentRound
      return `<div class="audit-round-panel">
  <div class="audit-round-panel-header">
    <a class="tiny-text" href="${rawHref}">${escapeHtml(round.audits)}</a>
  </div>
  ${renderAuditVoteTable(data)}
  <details class="audit-findings-details"${expanded ? " open" : ""}>
    <summary>Findings by auditor (${data.reduce((n, a) => n + (a.findings?.length ?? 0), 0)} total)</summary>
    ${renderAuditorFindingsBlocks(data)}
  </details>
</div>`
    }
  }

  const rows = await buildRoundAuditVoteRows(runName, round, liveStatus, { isCurrentRound })
  if (rows.length === 0) {
    return `<p class="empty-inline dim-text">No auditor results yet.</p>`
  }
  return renderRoundAuditVoteTable(rows)
}

async function loadAgentRebuttals(
  runName: string,
  files: string[],
): Promise<Array<{ agent: string; rebuttals: RebuttalEntry[] }>> {
  const agentRebuttals: Array<{ agent: string; rebuttals: RebuttalEntry[] }> = []
  for (const file of files) {
    try {
      const raw = await Bun.file(safeFilePath(runName, file)).text()
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) continue
      const agentMatch = file.match(/^rebuttals-([\w-]+)-round-\d+\.json$/)
      agentRebuttals.push({
        agent: agentMatch?.[1] ?? file,
        rebuttals: parsed,
      })
    } catch { /* skip */ }
  }
  return agentRebuttals
}

async function loadRebuttalTurnData(
  runName: string,
  entry: RoundArtifacts,
): Promise<RebuttalReviewTurnData[]> {
  const turnData: RebuttalReviewTurnData[] = []
  for (const turnArt of entry.rebuttalTurns) {
    if (!turnArt.drafterReview && !turnArt.responses) continue
    let responses: Record<string, RebuttalResponseEntry> | undefined
    let review: { acceptedFindingIds: string[]; rebuttals: RebuttalEntry[] } | undefined
    if (turnArt.responses) {
      try {
        const raw = await Bun.file(safeFilePath(runName, turnArt.responses)).text()
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          responses = parsed
        }
      } catch { /* skip */ }
    }
    if (turnArt.drafterReview) {
      try {
        const raw = await Bun.file(safeFilePath(runName, turnArt.drafterReview)).text()
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          review = parsed
        }
      } catch { /* skip */ }
    }
    if (responses || review) {
      turnData.push({ turn: turnArt.turn, responses, review })
    }
  }
  return turnData
}

async function renderNodeScopeBody(
  scope: NodeScope,
  runName: string,
  _nodeName: string,
  resolvedId: string,
  files: string[],
  fileSizes: Map<string, number>,
  liveStatus: LiveStatus | null,
  nodeHistory: NodeHistoryEntry[],
  sessionTelemetry: SessionTelemetryFile | null | undefined,
  roundScoped: boolean,
): Promise<string> {
  const index = indexRunArtifacts(files)
  const round = scope === "total" ? undefined : scope
  const isCurrentRound = round !== undefined
    && liveStatus?.phase === "running"
    && liveStatus.round === round
  let content = ""

  if (resolvedId === "discoverReader") {
    content += await renderDiscoverReaderScope(runName, files, liveStatus)
  }

  if (resolvedId === "draftFullDraft") {
    content += await renderDraftFullDraftScope(runName, files, scope, liveStatus)
  }

  if (resolvedId === "runDesignHtml") {
    content += await renderDesignHtmlScope(runName, files, scope, liveStatus)
  }

  if (resolvedId === "interactiveEnhance") {
    if (scope === "total") {
      content += await renderInteractiveEnhanceScope(runName, files, liveStatus)
    }
  }

  if (resolvedId === "readingExperienceEnhance") {
    if (scope === "total") {
      content += await renderReadingExperienceEnhanceScope(runName, files, liveStatus)
    }
  }

  if (resolvedId === "runParallelAudits") {
    if (scope === "total") {
      const roundsWithAudits = index.rounds.filter((r) => r.audits)
      if (roundsWithAudits.length > 0) {
        content += `<div class="section"><h2>All audit rounds</h2>
${await renderAllAuditRounds(runName, roundsWithAudits, liveStatus?.phase === "running" ? liveStatus.round : undefined, { includeNav: false })}
</div>`
      } else if (liveStatus?.phase === "running" && resolveLiveNode(liveStatus) === "runParallelAudits") {
        const roundArt = index.rounds.find((r) => r.round === liveStatus.round) ?? emptyRoundArtifacts(liveStatus.round)
        content += `<div class="section"><h2>Round ${liveStatus.round} audits</h2>
${await renderAuditRoundPanelBody(runName, roundArt, liveStatus, true)}
</div>`
      }
    } else {
      const roundArt = index.rounds.find((r) => r.round === scope) ?? emptyRoundArtifacts(scope)
      content += `<div class="section"><h2>Round ${scope} audits</h2>
${await renderAuditRoundPanelBody(runName, roundArt, liveStatus, isCurrentRound)}
</div>`
    }
  }

  if (resolvedId === "reviewFindingsByDrafter") {
    const reviews = scope === "total"
      ? index.rounds.filter((r) => r.review)
      : index.rounds.filter((r) => r.round === round && r.review)
    if (reviews.length > 0) {
      content += `<div class="section"><h2>${scope === "total" ? "Drafter reviews by round" : `Round ${round} drafter review`}</h2>`
      for (const entry of reviews) {
        if (!entry.review) continue
        try {
          const raw = await Bun.file(safeFilePath(runName, entry.review)).text()
          content += renderDrafterReview(entry.review, JSON.parse(raw), {
            roundHeading: scope === "total" ? "h3" : false,
          })
        } catch { /* skip */ }
      }
      content += `</div>`
    }
  }

  if (resolvedId === "aggregateConsensus") {
    const consensusRounds = scope === "total"
      ? index.rounds.filter((r) => r.consensus)
      : index.rounds.filter((r) => r.round === round && r.consensus)
    if (consensusRounds.length > 0) {
      content += `<div class="section"><h2>${scope === "total" ? "Consensus by round" : `Round ${round} consensus`}</h2>`
      for (const entry of consensusRounds) {
        if (!entry.consensus) continue
        try {
          const raw = await Bun.file(safeFilePath(runName, entry.consensus)).text()
          content += renderConsensusRound(entry.round, JSON.parse(raw) as AggregatedFindings, {
            roundHeading: scope === "total" ? "h3" : false,
          })
        } catch { /* skip */ }
      }
      content += `</div>`
    }
  }

  if (isRebuttalsViewerNode(resolvedId)) {
    const rebuttalRounds = scope === "total"
      ? index.rounds.filter(roundHasRebuttalActivity)
      : index.rounds.filter((r) => r.round === round && roundHasRebuttalActivity(r))
    if (rebuttalRounds.length > 0) {
      content += `<div class="section"><h2>${scope === "total" ? "Rebuttals by round" : `Round ${round} rebuttals`}</h2>`
      for (const entry of rebuttalRounds) {
        const roundData: RebuttalsRoundData = {
          roundNum: entry.round,
          agentRebuttals: await loadAgentRebuttals(runName, entry.perAgentRebuttalInputs),
          turns: await loadRebuttalTurnData(runName, entry),
        }
        const turnHeading = scope === "total" || roundData.turns.length > 1 ? "h4" as const : false
        content += renderRebuttalsRound(roundData, {
          roundHeading: scope === "total" ? "h3" : false,
          turnHeading,
        })
      }
      content += `</div>`
    }
  }

  if (
    scope !== "total"
    && !roundScoped
    && !content
    && resolvedId !== "interactiveEnhance"
    && resolvedId !== "readingExperienceEnhance"
  ) {
    content += `<p class="muted-note dim-text">This step applies to the full run.</p>`
  }

  const telemetryNode = isRebuttalsViewerNode(resolvedId) ? rebuttalsTelemetryNodeId() : resolvedId
  const telemetryHtml = renderNodeTelemetryMeta(liveStatus, nodeHistory, telemetryNode, sessionTelemetry, round)
  let body = telemetryHtml ?? ""
  body += content
  body += renderNodeSessionUsageTable(sessionTelemetry, nodeHistory, telemetryNode, round, liveStatus)

  const nodeFiles = resolvedId === "discoverReader"
    ? await readerInterviewArtifactFiles(runName, files)
    : isRebuttalsViewerNode(resolvedId)
      ? filesForRebuttalsViewer(files, index, round)
      : round !== undefined
        ? filesForNodeRound(resolvedId, files, index, round)
        : filesForNode(resolvedId, files, index)
  body += renderArtifactsSection(runName, nodeFiles, fileSizes)

  return body
}

export async function renderNodeDashboard(
  runName: string,
  nodeName: string,
  files: string[],
  fileSizes: Map<string, number>,
  liveStatus: LiveStatus | null,
  nodeHistory: NodeHistoryEntry[] = [],
  sessionTelemetry?: SessionTelemetryFile | null,
): Promise<{ body: string; live: string }> {
  const def = getNodeDefinition(nodeName) ?? getNodeDefinition(nodeName.replace(/Prompt|Resume$/, ""))
  const resolvedId = def?.id ?? nodeName
  const active = isRebuttalsViewerNode(resolvedId)
    ? isNodeActive(liveStatus, "runTargetedRebuttals") || isNodeActive(liveStatus, REBUTTALS_VIEWER_NODE_ID)
    : isNodeActive(liveStatus, resolvedId)
  const showRoundPanels = def?.phase === "research" || def?.roundScoped === true
  const rounds = showRoundPanels
    ? nodePageRoundNumbers(resolvedId, files, liveStatus, nodeHistory)
    : []

  let body = ""
  let live = ""

  if (rounds.length > 0 && showRoundPanels) {
    let panels = `<div class="node-scope-panel" data-round-panel="total" role="tabpanel">${await renderNodeScopeBody(
      "total",
      runName,
      nodeName,
      resolvedId,
      files,
      fileSizes,
      liveStatus,
      nodeHistory,
      sessionTelemetry,
      def?.roundScoped ?? false,
    )}</div>`

    for (const roundNum of rounds) {
      panels += `<div class="node-scope-panel" data-round-panel="${roundNum}" role="tabpanel" hidden>${await renderNodeScopeBody(
        roundNum,
        runName,
        nodeName,
        resolvedId,
        files,
        fileSizes,
        liveStatus,
        nodeHistory,
        sessionTelemetry,
        def?.roundScoped ?? false,
      )}</div>`
    }

    body = `<div class="node-scope-panels">${panels}</div>`
  } else {
    body = await renderNodeScopeBody(
      "total",
      runName,
      nodeName,
      resolvedId,
      files,
      fileSizes,
      liveStatus,
      nodeHistory,
      sessionTelemetry,
      def?.roundScoped ?? false,
    )
  }

  if (active && liveStatus) {
    const totals = sessionTotalsForLiveNode(sessionTelemetry, liveStatus)
    const elapsed = liveStatus.nodeStartedAt ? formatElapsed(Date.now() - liveStatus.nodeStartedAt) : ""
    const usageLabel = totals.usageAvailable || totals.costAvailable
      ? ` · ${formatUsagePair(totals.usage, true)}`
      : ""
    live += `<div class="card active-run-hero">
  <span class="badge badge-running">● Running</span>
  <span class="dim-text">${escapeHtml(resolvedId)} · ${escapeHtml(elapsed)}${escapeHtml(usageLabel)}</span>
</div>`
    live += renderAgentActivity(liveStatus, sessionTelemetry)
  }

  return { body, live }
}

const MINI_PIPELINE_NODE_IDS = [
  "discoverReader",
  "draftFullDraft",
  "runParallelAudits",
  "reviewFindingsByDrafter",
  REBUTTALS_VIEWER_NODE_ID,
  "aggregateConsensus",
  "computeConfidence",
  "runDesignHtml",
  "interactiveEnhance",
  "readingExperienceEnhance",
  "finalizeDesign",
] as const

function miniPipelineNodeDone(nodeId: string, files: string[], index: ReturnType<typeof indexRunArtifacts>): boolean {
  if (nodeId === REBUTTALS_VIEWER_NODE_ID) {
    return filesForRebuttalsViewer(files, index).length > 0
  }
  if (nodeId === "finalizeDesign") {
    return files.includes("final.html") || filesForNode(nodeId, files, index).length > 0
  }
  return filesForNode(nodeId, files, index).length > 0
}

export function renderNodeMiniPipeline(runName: string, currentNode: string, files: string[]): string {
  const currentDef = getNodeDefinition(currentNode)
  const currentId = currentDef?.id ?? currentNode
  const highlightedId = currentId === "reviseDraft"
    ? "draftFullDraft"
    : isRebuttalsViewerNode(currentId)
      ? REBUTTALS_VIEWER_NODE_ID
      : currentId

  const pipelineNodes = MINI_PIPELINE_NODE_IDS
    .map((id) => GRAPH_NODES.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
  const index = indexRunArtifacts(files)

  let html = `<div class="round-nav">`
  for (const node of pipelineNodes) {
    const done = miniPipelineNodeDone(node.id, files, index)
    const cls = node.id === highlightedId ? "round-nav-chip active" : done ? "round-nav-chip done" : "round-nav-chip"
    const linkId = node.pipelineLabel ?? node.id
    const navLabel = node.miniLabel ?? node.label.split(" ")[0]
    html += `<a class="${cls}" href="/runs/${encodeURIComponent(runName)}/node/${encodeURIComponent(linkId)}">${escapeHtml(navLabel)}</a>`
  }
  html += `</div>`
  return html
}

export function nodePageRoundNumbers(
  nodeId: string,
  files: string[],
  liveStatus: LiveStatus | null,
  nodeHistory: NodeHistoryEntry[] = [],
): number[] {
  if (nodeId === "runDesignHtml") {
    return designRoundNumbers(files, liveStatus)
  }
  return researchRoundNumbers(files, liveStatus, nodeHistory)
}
