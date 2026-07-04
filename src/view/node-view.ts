import { renderFileBrowser } from "./file-browser"
import { GRAPH_NODES, filesForNode, getNodeDefinition, isNodeActive, isNodeComplete, nodeKpis, resolveLiveNode } from "./node-registry"
import { indexRunArtifacts, maxRebuttalTurn, roundHasRebuttals } from "./run-artifacts"
import { renderAgentActivity } from "./components"
import { renderAllAuditRounds } from "./audit-view"
import { renderConsensusCard, renderDrafterReview } from "./artifact-renderers"
import { tableWrap } from "./html"
import { safeFilePath } from "./paths"
import { escapeHtml, formatElapsed } from "./utils"
import type { LiveStatus, NodeHistoryEntry, RunStatus } from "./types"

export function renderNodeGrid(
  runName: string,
  files: string[],
  liveStatus: LiveStatus | null,
  researchStatus: RunStatus = "running",
): string {
  const index = indexRunArtifacts(files)
  const activeNode = resolveLiveNode(liveStatus)

  let cards = ""
  for (const node of GRAPH_NODES) {
    if (node.phase === "setup" && node.order > 4) continue
    const nodeId = node.pipelineLabel ?? node.id
    const active = activeNode === node.id || isNodeActive(liveStatus, node.id)
    const completed = isNodeComplete(node.id, files, researchStatus, liveStatus, index)
    const kpis = nodeKpis(node.id, files, index)

    let statusIcon = "○"
    if (active) statusIcon = "●"
    else if (completed) statusIcon = "✓"

    const kpiHtml = kpis.slice(0, 2).map((k) =>
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
): string {
  const def = getNodeDefinition(nodeName)
  const aliases = new Set([nodeName, ...(def?.liveNodeAliases ?? []), def?.id, def?.pipelineLabel].filter(Boolean) as string[])
  const filtered = entries.filter((e) => aliases.has(e.node))
  if (filtered.length === 0) return ""

  let html = `<div class="section"><h2>Execution history</h2><div class="card stack-card stack-card-history">`
  for (const entry of [...filtered].reverse()) {
    const elapsed = entry.completedAt - entry.startedAt
    const elapsedStr = elapsed > 1000 ? `${(elapsed / 1000).toFixed(1)}s` : `${elapsed}ms`
    const icon = entry.status === "completed" ? "✓" : "✗"
    html += `<div class="node-history-row">
  <span class="node-history-icon ${entry.status === "completed" ? "success-text" : "danger-text"}">${icon}</span>
  <span class="node-history-link">${escapeHtml(entry.node)}</span>
  <span class="node-history-meta">${elapsedStr}</span>
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

export async function renderNodeDashboard(
  runName: string,
  nodeName: string,
  files: string[],
  fileSizes: Map<string, number>,
  liveStatus: LiveStatus | null,
): Promise<{ body: string; live: string }> {
  const def = getNodeDefinition(nodeName) ?? getNodeDefinition(nodeName.replace(/Prompt|Resume$/, ""))
  const resolvedId = def?.id ?? nodeName
  const index = indexRunArtifacts(files)
  const nodeFiles = filesForNode(resolvedId, files, index)
  const active = isNodeActive(liveStatus, resolvedId)
  const focusRound = liveStatus?.phase === "running" ? liveStatus.round : undefined

  let body = ""
  let live = ""

  if (resolvedId === "runParallelAudits" && index.rounds.some((r) => r.audits)) {
    body += `<div class="section"><h2>Audits by round</h2>
${await renderAllAuditRounds(runName, index.rounds, focusRound)}
</div>`
  }

  if (resolvedId === "reviewFindingsByDrafter") {
    const reviews = index.rounds.filter((r) => r.review)
    if (reviews.length > 0) {
      body += `<div class="section"><h2>Drafter reviews by round</h2>`
      for (const round of reviews) {
        if (!round.review) continue
        try {
          const raw = await Bun.file(safeFilePath(runName, round.review)).text()
          body += renderDrafterReview(round.review, JSON.parse(raw))
        } catch { /* skip */ }
      }
      body += `</div>`
    }
  }

  if (resolvedId === "aggregateConsensus") {
    const consensusRounds = index.rounds.filter((r) => r.consensus)
    if (consensusRounds.length > 0) {
      body += `<div class="section"><h2>Consensus by round</h2>`
      for (const round of consensusRounds) {
        if (!round.consensus) continue
        try {
          const raw = await Bun.file(safeFilePath(runName, round.consensus)).text()
          body += renderConsensusCard(round.consensus, JSON.parse(raw))
        } catch { /* skip */ }
      }
      body += `</div>`
    }
  }

  if ((resolvedId === "runTargetedRebuttals" || resolvedId === "reviewRebuttalResponses") && index.rounds.some(roundHasRebuttals)) {
    body += `<div class="section"><h2>Rebuttal turns by round</h2><div class="card stack-card stack-card-tight">`
    for (const round of index.rounds) {
      if (!roundHasRebuttals(round)) continue
      const turns = round.rebuttalTurns.map((t) => {
        const links: string[] = []
        if (t.responses) links.push(`<a href="/runs/${encodeURIComponent(runName)}/raw/${encodeURIComponent(t.responses)}">T${t.turn} responses</a>`)
        if (t.drafterReview) links.push(`<a href="/runs/${encodeURIComponent(runName)}/raw/${encodeURIComponent(t.drafterReview)}">T${t.turn} review</a>`)
        return links.join(" · ")
      }).filter(Boolean)
      body += `<div class="round-step done">
  <a href="/runs/${encodeURIComponent(runName)}/round/${round.round}">Round ${round.round}</a>
  · ${maxRebuttalTurn(round)} turn${maxRebuttalTurn(round) !== 1 ? "s" : ""}: ${turns.join(" | ")}
</div>`
    }
    body += `</div></div>`
  }

  const kpis = nodeKpis(resolvedId, files, index)
  if (kpis.length > 0) {
    let kpiRows = kpis.map((k) => `<tr><td>${escapeHtml(k.label)}</td><td>${escapeHtml(k.value)}</td></tr>`).join("")
    body += `<div class="section"><h2>Summary</h2><div class="card">${tableWrap(`<table class="summary-table">${kpiRows}</table>`)}</div></div>`
  }

  if (nodeFiles.length > 0) {
    const subsetSizes = new Map<string, number>()
    for (const f of nodeFiles) subsetSizes.set(f, fileSizes.get(f) ?? 0)
    body += `<div class="section"><h2>Artifacts</h2>${renderFileBrowser({ runName, files: nodeFiles, fileSizes: subsetSizes })}</div>`
  }

  if (active && liveStatus) {
    const elapsed = liveStatus.nodeStartedAt ? formatElapsed(Date.now() - liveStatus.nodeStartedAt) : ""
    live += `<div class="card active-run-hero">
  <span class="badge badge-running">● Running</span>
  <span class="dim-text">${escapeHtml(resolvedId)} · ${escapeHtml(elapsed)}</span>
</div>`
    live += renderAgentActivity(liveStatus)
  }

  return { body, live }
}

export function renderNodeMiniPipeline(runName: string, currentNode: string, files: string[]): string {
  const researchNodes = GRAPH_NODES.filter((n) => n.phase === "research" && n.order <= 14)
  const index = indexRunArtifacts(files)
  const currentDef = getNodeDefinition(currentNode)
  const currentId = currentDef?.id ?? currentNode

  let html = `<div class="round-nav">`
  for (const node of researchNodes.slice(0, 8)) {
    const done = filesForNode(node.id, files, index).length > 0
    const cls = node.id === currentId ? "round-nav-chip active" : done ? "round-nav-chip done" : "round-nav-chip"
    const linkId = node.pipelineLabel ?? node.id
    html += `<a class="${cls}" href="/runs/${encodeURIComponent(runName)}/node/${encodeURIComponent(linkId)}">${escapeHtml(node.label.split(" ")[0])}</a>`
  }
  html += `</div>`
  return html
}
