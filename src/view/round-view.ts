import { buildRoundAuditVoteRows, renderRoundAuditVoteTable } from "./audit-view"
import { safeFilePath } from "./paths"
import { outcomeClassForRound, outcomeLabelForRound, indexRunArtifacts, summarizeConsensusData, type RoundArtifacts } from "./run-artifacts"
import { escapeHtml } from "./utils"
import type { LiveStatus } from "./types"

type RoundStripMeta = {
  round: RoundArtifacts
  isCurrent: boolean
  outcomeText: string
  outcomeClass: string
}

async function loadRoundStripMeta(
  runName: string,
  round: RoundArtifacts,
  isCurrent: boolean,
): Promise<RoundStripMeta> {
  let outcomeText = isCurrent ? "in progress" : "…"
  let outcomeClass = "badge-running"
  if (round.consensus) {
    try {
      const raw = await Bun.file(safeFilePath(runName, round.consensus)).text()
      const consensus = summarizeConsensusData(JSON.parse(raw))
      outcomeText = outcomeLabelForRound(consensus.outcome)
      outcomeClass = outcomeClassForRound(consensus.outcome)
    } catch {
      outcomeText = "view"
    }
  }
  return { round, isCurrent, outcomeText, outcomeClass }
}

export async function renderRoundStrip(
  runName: string,
  files: string[],
  liveStatus: LiveStatus | null,
): Promise<string> {
  const index = indexRunArtifacts(files)
  if (index.rounds.length === 0) return ""

  const currentRound = liveStatus?.phase === "running" ? liveStatus.round : index.maxRound
  const defaultActiveRound = index.rounds.some((r) => r.round === currentRound)
    ? currentRound
    : index.maxRound

  const metas: RoundStripMeta[] = []
  for (const round of index.rounds) {
    const isCurrent = round.round === currentRound && liveStatus?.phase === "running"
    metas.push(await loadRoundStripMeta(runName, round, isCurrent))
  }

  let tabs = ""
  let panels = ""
  for (const meta of metas) {
    const { round, isCurrent, outcomeText, outcomeClass } = meta
    const tabActive = round.round === defaultActiveRound
    tabs += `<button type="button" class="round-chip${tabActive ? " active" : ""}" data-round-tab="${round.round}" role="tab" aria-selected="${tabActive ? "true" : "false"}">
  <span class="round-chip-num">R${round.round}</span>
  ${isCurrent ? `<span class="round-chip-live">●</span>` : ""}
  <span class="round-chip-outcome dim-text">${escapeHtml(outcomeText)}</span>
</button>`

    const auditRows = await buildRoundAuditVoteRows(runName, round, liveStatus, { isCurrentRound: isCurrent })
    const panelBody = auditRows.length > 0
      ? renderRoundAuditVoteTable(auditRows)
      : `<p class="empty-inline dim-text">No audit data yet.</p>`

    panels += `<div class="round-audit-panel" data-round-panel="${round.round}" role="tabpanel"${tabActive ? "" : " hidden"}>
  <div class="round-audit-panel-head">
    <span class="badge ${outcomeClass}">${escapeHtml(outcomeText)}</span>
  </div>
  ${panelBody}
</div>`
  }

  return `<div class="section">
  <div class="round-strip-head">
    <h2>Research rounds</h2>
  </div>
  <div class="round-strip" data-round-tablist role="tablist" aria-label="Research rounds">${tabs}</div>
  <div class="round-audit-panels">${panels}</div>
</div>`
}

export function renderLiveStatusMeta(liveStatus: LiveStatus | null): string {
  if (!liveStatus || liveStatus.phase !== "running") return ""
  const parts: string[] = [`Round ${liveStatus.round}/${liveStatus.maxRounds}`]
  if (liveStatus.rebuttalTurn !== undefined && liveStatus.rebuttalTurn > 0) {
    parts.push(`Rebuttal turn ${liveStatus.rebuttalTurn}`)
  }
  if (liveStatus.activeRebuttalCount !== undefined && liveStatus.activeRebuttalCount > 0) {
    parts.push(`${liveStatus.activeRebuttalCount} active rebuttal${liveStatus.activeRebuttalCount !== 1 ? "s" : ""}`)
  }
  if (liveStatus.unresolvedFindingCount !== undefined && liveStatus.unresolvedFindingCount > 0) {
    parts.push(`${liveStatus.unresolvedFindingCount} unresolved`)
  }
  if (liveStatus.researchPhase) {
    parts.push(liveStatus.researchPhase.replace(/_/g, " "))
  }
  return `<span class="meta-item live-meta">${parts.map((p) => escapeHtml(p)).join(" · ")}</span>`
}
