import { renderAllAuditRounds } from "./audit-view"
import { renderConsensusCard } from "./artifact-renderers"
import { classifyFile } from "./data"
import { safeFilePath } from "./paths"
import { outcomeClassForRound, outcomeLabelForRound, indexRunArtifacts, maxRebuttalTurn, roundHasRebuttals, summarizeAuditRoundData, summarizeConsensusData, type RoundArtifacts } from "./run-artifacts"
import { escapeHtml, formatBytes } from "./utils"
import type { LiveStatus } from "./types"

function artifactLink(runName: string, file: string, label: string, size?: number): string {
  const sz = size !== undefined && size > 0 ? ` · ${formatBytes(size)}` : ""
  return `<a href="/runs/${encodeURIComponent(runName)}/raw/${encodeURIComponent(file)}">${escapeHtml(label)}</a><span class="dim-text tiny-text">${escapeHtml(sz)}</span>`
}

function stepRow(label: string, detail: string, done: boolean, active?: boolean): string {
  const icon = active ? "●" : done ? "✓" : "○"
  const cls = active ? "round-step active" : done ? "round-step done" : "round-step"
  return `<div class="${cls}"><span class="round-step-icon">${icon}</span> <span class="round-step-label">${escapeHtml(label)}</span> <span class="round-step-detail dim-text">${detail}</span></div>`
}

export async function renderRoundStrip(
  runName: string,
  files: string[],
  liveStatus: LiveStatus | null,
): Promise<string> {
  const index = indexRunArtifacts(files)
  if (index.rounds.length === 0) return ""

  const currentRound = liveStatus?.phase === "running" ? liveStatus.round : index.maxRound

  let chips = ""
  for (const round of index.rounds) {
    const isCurrent = round.round === currentRound && liveStatus?.phase === "running"
    const cls = isCurrent ? "round-chip active" : "round-chip"
    let outcomeText = isCurrent ? "in progress" : "…"
    if (round.consensus) {
      try {
        const raw = await Bun.file(safeFilePath(runName, round.consensus)).text()
        outcomeText = outcomeLabelForRound(summarizeConsensusData(JSON.parse(raw)).outcome)
      } catch {
        outcomeText = "view"
      }
    }
    chips += `<a class="${cls}" href="/runs/${encodeURIComponent(runName)}/round/${round.round}">
  <span class="round-chip-num">R${round.round}</span>
  ${isCurrent ? `<span class="round-chip-live">●</span>` : ""}
  <span class="round-chip-outcome dim-text">${escapeHtml(outcomeText)}</span>
</a>`
  }

  return `<div class="section"><h2>Research rounds</h2><div class="round-strip">${chips}</div></div>`
}

export async function renderRoundDetailPage(
  runName: string,
  roundNum: number,
  files: string[],
  fileSizes: Map<string, number>,
  liveStatus: LiveStatus | null,
): Promise<string> {
  const index = indexRunArtifacts(files)
  const round = index.rounds.find((r) => r.round === roundNum)
  if (!round) {
    return `<div class="empty-state">Round ${roundNum} not found for this run.</div>`
  }

  const isLive = liveStatus?.phase === "running" && liveStatus.round === roundNum
  let consensusSummary: { outcome?: string; unresolvedCount: number; approvedAgentCount: number } = {
    unresolvedCount: 0,
    approvedAgentCount: 0,
  }
  if (round.consensus) {
    try {
      const raw = await Bun.file(safeFilePath(runName, round.consensus)).text()
      consensusSummary = summarizeConsensusData(JSON.parse(raw))
    } catch { /* ignore */ }
  }

  let auditSummary = { auditorCount: 0, totalFindings: 0, findingsBySeverity: {} as Record<string, number>, votes: {} as Record<string, string> }
  if (round.audits) {
    try {
      const raw = await Bun.file(safeFilePath(runName, round.audits)).text()
      auditSummary = summarizeAuditRoundData(JSON.parse(raw))
    } catch { /* ignore */ }
  }

  const outcome = consensusSummary.outcome
  const badgeClass = outcomeClassForRound(outcome)
  const outcomeBanner = `<div class="structured-card">
  <div class="outcome-banner-row">
    <span class="badge ${badgeClass}">${escapeHtml(outcomeLabelForRound(outcome))}</span>
    ${isLive ? `<span class="badge badge-running">● live</span>` : ""}
    ${consensusSummary.unresolvedCount > 0 ? `<span class="dim-text">${consensusSummary.unresolvedCount} unresolved</span>` : ""}
    ${maxRebuttalTurn(round) > 0 ? `<span class="dim-text">${maxRebuttalTurn(round)} rebuttal turn${maxRebuttalTurn(round) !== 1 ? "s" : ""}</span>` : ""}
  </div>
</div>`

  const rebuttalTurns = round.rebuttalTurns
  const rebuttalDetail = rebuttalTurns.length > 0
    ? `${rebuttalTurns.length} turn${rebuttalTurns.length !== 1 ? "s" : ""}`
    : roundHasRebuttals(round) ? "in progress" : "—"

  let stepsHtml = stepRow("Draft", round.draft ? escapeHtml(round.draft) : "—", !!round.draft, isLive && liveStatus?.node === "draftFullDraft")
  stepsHtml += stepRow(
    "Audits",
    round.audits
      ? `${auditSummary.auditorCount} auditors · ${auditSummary.totalFindings} findings`
      : "—",
    !!round.audits,
    isLive && liveStatus?.node === "runParallelAudits",
  )
  stepsHtml += stepRow("Drafter review", round.review ?? "—", !!round.review, isLive && liveStatus?.node === "reviewFindingsByDrafter")
  stepsHtml += stepRow("Rebuttals", rebuttalDetail, roundHasRebuttals(round), isLive && (liveStatus?.node === "runTargetedRebuttals" || liveStatus?.node === "reviewRebuttalResponses"))
  stepsHtml += stepRow("Consensus", outcome ? outcomeLabelForRound(outcome) : "—", !!round.consensus, isLive && liveStatus?.node === "aggregateConsensus")
  stepsHtml += stepRow("Revise carry-forward", round.unresolved ? `${round.unresolved}` : "—", !!round.unresolved, isLive && liveStatus?.node === "reviseDraft")

  let auditPanelHtml = ""
  if (round.audits) {
    auditPanelHtml = `<div class="section"><h2>Auditor votes &amp; findings</h2>
${await renderAllAuditRounds(runName, [round], roundNum)}
</div>`
  }

  let consensusPanelHtml = ""
  if (round.consensus) {
    try {
      const raw = await Bun.file(safeFilePath(runName, round.consensus)).text()
      consensusPanelHtml = `<div class="section"><h2>Consensus outcome</h2>${renderConsensusCard(round.consensus, JSON.parse(raw))}</div>`
    } catch { /* ignore */ }
  }

  let rebuttalLadder = ""
  if (rebuttalTurns.length > 0) {
    rebuttalLadder = `<div class="section"><h3>Rebuttal turns</h3><div class="card stack-card stack-card-tight">`
    for (const turn of rebuttalTurns) {
      const parts: string[] = []
      if (turn.responses) parts.push(artifactLink(runName, turn.responses, `Auditor responses T${turn.turn}`, fileSizes.get(turn.responses)))
      if (turn.drafterReview) parts.push(artifactLink(runName, turn.drafterReview, `Drafter review T${turn.turn}`, fileSizes.get(turn.drafterReview)))
      rebuttalLadder += `<div class="round-step done"><span class="round-step-label">Turn ${turn.turn}</span> ${parts.join(" · ")}</div>`
    }
    rebuttalLadder += `</div></div>`
  }

  let artifactsHtml = `<div class="section"><h3>Artifacts</h3><ul class="file-list">`
  const roundFiles = collectRoundFiles(round)
  for (const f of roundFiles) {
    const cls = classifyFile(f)
    const sz = fileSizes.get(f) ?? 0
    artifactsHtml += `<li><a href="/runs/${encodeURIComponent(runName)}/raw/${encodeURIComponent(f)}">
  <span class="file-main"><span class="file-label">${escapeHtml(cls.label)}</span>
  <span class="file-desc">${escapeHtml(cls.description)} · <span class="file-name">${escapeHtml(f)}</span></span></span>
  <span class="file-size">${escapeHtml(sz > 0 ? formatBytes(sz) : "")}</span>
</a></li>`
  }
  artifactsHtml += `</ul></div>`

  const roundNav = index.rounds.map((r) => {
    const cls = r.round === roundNum ? "round-nav-chip active" : "round-nav-chip"
    return `<a class="${cls}" href="/runs/${encodeURIComponent(runName)}/round/${r.round}">R${r.round}</a>`
  }).join("")

  return `<div class="header-bar">
  <h1>Round ${roundNum}</h1>
  <p class="muted-note dim-text">Run: ${escapeHtml(runName)}</p>
</div>
<div class="round-nav">${roundNav}</div>
${outcomeBanner}
<div class="section"><h2>Sub-steps</h2><div class="card stack-card stack-card-tight">${stepsHtml}</div></div>
${auditPanelHtml}
${consensusPanelHtml}
${rebuttalLadder}
${artifactsHtml}`
}

function collectRoundFiles(round: RoundArtifacts): string[] {
  const files: string[] = []
  if (round.draft) files.push(round.draft)
  if (round.audits) files.push(round.audits)
  files.push(...round.perAgentAudits)
  if (round.review) files.push(round.review)
  for (const turn of round.rebuttalTurns) {
    if (turn.responses) files.push(turn.responses)
    if (turn.drafterReview) files.push(turn.drafterReview)
    files.push(...turn.perAgentResponses)
  }
  files.push(...round.perAgentRebuttalInputs)
  if (round.disputed) files.push(round.disputed)
  if (round.consensus) files.push(round.consensus)
  if (round.unresolved) files.push(round.unresolved)
  return files
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
