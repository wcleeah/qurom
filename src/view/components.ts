import { tableWrap } from "./html"
import { safeFilePath } from "./paths"
import { answeredQuestionsFromTranscript } from "../reader-transcript"
import { renderReaderProfileSummary } from "./artifact-renderers"
import { indexRunArtifacts } from "./run-artifacts"
import { getNodeDefinition, isNodeActive, resolveLiveNode } from "./node-registry"
import { nodeTelemetrySuffix } from "./telemetry-view"
import { escapeHtml, formatDurationMs, formatTokenCount, formatUsagePair, statusDot } from "./utils"
import type { LiveAgentStatus, LiveStatus, NodeHistoryEntry, RunStatus } from "./types"

export function renderLivePipeline(
  liveStatus: LiveStatus | null,
  files: string[],
  researchStatus: RunStatus,
  runName?: string,
  nodeHistory: NodeHistoryEntry[] = [],
): string {
  const activeNode = resolveLiveNode(liveStatus)
  const liveAgents = liveStatus?.agents ?? {}
  const artifactIndex = indexRunArtifacts(files)
  const currentRound = liveStatus?.phase === "running" ? liveStatus.round : artifactIndex.maxRound

  const hasFile = (pattern: RegExp) => files.some((f) => pattern.test(f))
  const hasReaderProfile = hasFile(/^reader-profile(?:-\d+)?\.json$/)
  const hasDraft = hasFile(/^draft-round-\d+\.md$/)
  const hasAudits = hasFile(/^audits-round-\d+\.json$/)
  const hasDrafterReview = hasFile(/^drafter-finding-review-round-\d+\.json$/)
  const hasRebuttals = hasFile(/^auditor-rebuttal-responses-round-\d+-turn-\d+\.json$/)
    || hasFile(/^auditor-rebuttal-responses-[\w-]+-round-\d+\.json$/)
  const hasRebuttalReview = hasFile(/^drafter-rebuttal-review-round-\d+-turn-\d+\.json$/)
  const hasAggregated = hasFile(/^aggregated-findings-round-\d+\.json$/)
  const hasFinalMd = hasFile(/^final\.md$/)
  const hasLatestDraft = hasFile(/^latest-draft\.md$/)

  function roundComplete(pattern: RegExp, round: number): boolean {
    return files.some((f) => {
      const m = f.match(pattern)
      if (!m?.[1]) return false
      return parseInt(m[1], 10) <= round
    })
  }

  function pipelineTelemetryMeta(linkId: string, active: boolean): string {
    if (active && liveStatus) {
      const parts: string[] = []
      if (liveStatus.nodeStartedAt && resolveLiveNode(liveStatus) === linkId) {
        parts.push(formatDurationMs(Date.now() - liveStatus.nodeStartedAt))
      }
      if (liveStatus.nodeUsageAvailable && liveStatus.nodeUsage) {
        parts.push(formatUsagePair(liveStatus.nodeUsage, true))
      }
      return parts.length > 0 ? ` · ${parts.join(" · ")}` : ""
    }
    return nodeTelemetrySuffix(nodeHistory, linkId)
  }

  function nodeRow(
    num: number,
    label: string,
    linkId: string,
    completed: boolean,
    active: boolean,
    meta?: string,
    agentList?: string,
  ): string {
    const icon = active ? "●" : completed ? "✓" : "○"
    const cls = active ? "pipeline-node active" : "pipeline-node"
    const linkable = runName && (completed || active)
    const labelHtml = linkable
      ? `<a href="/runs/${encodeURIComponent(runName)}/node/${encodeURIComponent(linkId)}">${escapeHtml(label)}</a>`
      : escapeHtml(label)
    const telemetryMeta = pipelineTelemetryMeta(linkId, active)
    const combinedMeta = `${meta ?? ""}${telemetryMeta}`.trim()
    return `<div class="${cls}">
  <div class="pipeline-node-label"><span class="pipeline-icon">${icon}</span> ${num}. ${labelHtml}${combinedMeta ? ` <span class="pipeline-node-meta">${combinedMeta}</span>` : ""}</div>
  ${agentList ? `<div class="pipeline-agent-list">${agentList}</div>` : ""}
</div>`
  }

  function agentListHtml(agents: Record<string, LiveAgentStatus>): string {
    return Object.entries(agents)
      .sort(([, a], [, b]) => {
        const order: Record<string, number> = { running: 0, complete: 1, error: 2, idle: 3 }
        return (order[a.status] ?? 3) - (order[b.status] ?? 3)
      })
      .map(([name, agent]) => {
        const tokens = agent.usageAvailable
          ? ` · ${formatTokenCount(agent.tokensIn)}/${formatTokenCount(agent.tokensOut)} tok`
          : ""
        return `<span class="pipeline-agent-item">${statusDot(agent.status)} ${escapeHtml(name)}${agent.tool ? ` · ${escapeHtml(agent.tool)}` : ""}${tokens}</span>`
      })
      .join("\n")
  }

  const interviewActive = isNodeActive(liveStatus, "discoverReader")
  const profileReady = hasReaderProfile && !interviewActive
  const researchDone = researchStatus === "approved" || researchStatus === "failed"
  const terminalLabel = researchStatus === "approved" ? "finalizeApprovedDraft" : researchStatus === "failed" ? "finalizeFailedRun" : "finalize"
  const auditRoundCount = files.filter((f) => /^audits-round-\d+\.json$/.test(f)).length
  const draftRoundCount = files.filter((f) => /^draft-round-\d+\.md$/.test(f)).length
  const rebuttalTurnCount = files.filter((f) => /^auditor-rebuttal-responses-round-\d+-turn-\d+\.json$/.test(f)).length

  const auditsComplete = currentRound >= 0 && roundComplete(/^audits-round-(\d+)\.json$/, currentRound) && hasAudits
  const reviewComplete = currentRound >= 0 && roundComplete(/^drafter-finding-review-round-(\d+)\.json$/, currentRound) && hasDrafterReview
  const rebuttalsComplete = hasRebuttals
  const rebuttalReviewComplete = hasRebuttalReview
  const aggregatedComplete = currentRound >= 0 && roundComplete(/^aggregated-findings-round-(\d+)\.json$/, currentRound) && hasAggregated

  let html = '<div class="section"><h2>Pipeline</h2><div class="card stack-card stack-card-tight">'

  html += nodeRow(1, "ingestRequest", "ingestRequest", true, activeNode === "ingestRequest")
  html += nodeRow(2, "summarizeInputDocument", "summarizeInputDocument", researchStatus !== "running" || hasFile(/./), activeNode === "summarizeInputDocument")
  html += nodeRow(3, "prepareOutputPath", "prepareOutputPath", hasFile(/./), activeNode === "prepareOutputPath")
  html += nodeRow(4, "discoverReader", "discoverReader", profileReady, interviewActive,
    profileReady ? "· profile ready" : (interviewActive ? "· interviewing" : ""),
    interviewActive ? agentListHtml(liveAgents) : "")
  html += nodeRow(5, "draftFullDraft", "draftFullDraft", hasDraft, activeNode === "draftFullDraft",
    hasDraft ? `· ${draftRoundCount} round${draftRoundCount !== 1 ? "s" : ""}` : "",
    activeNode === "draftFullDraft" ? agentListHtml(liveAgents) : "")
  html += nodeRow(6, "runParallelAudits", "runParallelAudits", auditsComplete, activeNode === "runParallelAudits",
    hasAudits ? `· ${auditRoundCount} audit round${auditRoundCount !== 1 ? "s" : ""}` : "",
    activeNode === "runParallelAudits" ? agentListHtml(liveAgents) : "")
  html += nodeRow(7, "reviewFindingsByDrafter", "reviewFindingsByDrafter", reviewComplete, activeNode === "reviewFindingsByDrafter",
    "", activeNode === "reviewFindingsByDrafter" ? agentListHtml(liveAgents) : "")
  html += nodeRow(8, "runTargetedRebuttals", "runTargetedRebuttals", rebuttalsComplete, activeNode === "runTargetedRebuttals",
    rebuttalTurnCount > 0 ? `· ${rebuttalTurnCount} turn${rebuttalTurnCount !== 1 ? "s" : ""}` : "",
    activeNode === "runTargetedRebuttals" ? agentListHtml(liveAgents) : "")
  html += nodeRow(9, "reviewRebuttalResponses", "reviewRebuttalResponses", rebuttalReviewComplete, activeNode === "reviewRebuttalResponses",
    "", activeNode === "reviewRebuttalResponses" ? agentListHtml(liveAgents) : "")
  html += nodeRow(10, "aggregateConsensus", "aggregateConsensus", aggregatedComplete, activeNode === "aggregateConsensus")
  html += nodeRow(11, "computeConfidence", "computeConfidence", hasFile(/^confidence\.json$/) || aggregatedComplete, activeNode === "computeConfidence")
  html += nodeRow(12, researchDone ? terminalLabel : "reviseDraft", researchDone ? terminalLabel : "reviseDraft", researchDone, activeNode === "reviseDraft" || activeNode === "finalizeApprovedDraft" || activeNode === "finalizeFailedRun")
  html += nodeRow(13, "summarizeOutputArtifact", "summarizeOutputArtifact", hasFinalMd || hasLatestDraft, activeNode === "summarizeOutputArtifact")

  const hasDesignHtml = hasFile(/^design-html-round-\d+\.html$/)
  const designMeta = researchStatus === "approved" ? "(pending)" : researchStatus === "running" ? "(after research)" : ""
  html += nodeRow(14, "runDesignHtml", "runDesignHtml", hasDesignHtml, activeNode === "runDesignHtml",
    hasDesignHtml ? "" : designMeta, activeNode === "runDesignHtml" ? agentListHtml(liveAgents) : "")
  html += nodeRow(15, "interactiveEnhance", "interactiveEnhance", hasDesignHtml, activeNode === "interactiveEnhance",
    "", activeNode === "interactiveEnhance" ? agentListHtml(liveAgents) : "")
  const hasFinalHtmlFile = files.includes("final.html")
  if (hasDesignHtml) {
    html += nodeRow(16, "finalizeDesign", "finalizeDesign", hasFinalHtmlFile, activeNode === "finalizeDesign",
      hasFinalHtmlFile ? "· final.html written" : "",
      activeNode === "finalizeDesign" ? agentListHtml(liveAgents) : "")
  }

  html += '</div></div>'
  return html
}

export function renderAgentActivity(liveStatus: LiveStatus | null): string {
  if (!liveStatus || !liveStatus.agents || Object.keys(liveStatus.agents).length === 0) return ""

  const agents = Object.entries(liveStatus.agents)
    .filter(([, a]) => a.toolCalls.length > 0 || a.reasoning)
  if (agents.length === 0) return ""

  let html = '<div class="section"><h2>Agent Activity</h2>'

  for (const [name, agent] of agents) {
    html += `<div class="card card-compact"><div class="agent-card-title">${statusDot(agent.status)} ${escapeHtml(name)} <span class="agent-card-status">(${agent.status})</span>${agent.usageAvailable ? ` <span class="agent-card-tokens dim-text">${escapeHtml(formatUsagePair({ tokensIn: agent.tokensIn, tokensOut: agent.tokensOut }, true))}</span>` : ""}</div>`

    if (agent.reasoning) {
      html += `<details class="markdown-preview agent-reasoning"><summary>Reasoning</summary><pre>${escapeHtml(agent.reasoning)}</pre></details>`
    }

    if (agent.toolCalls.length > 0) {
      let toolTable = '<table class="summary-table summary-table-wide summary-table-compact"><thead><tr><th>Tool</th><th>Status</th><th>Input</th><th>Output</th></tr></thead><tbody>'
      for (const tc of agent.toolCalls.slice(-10).reverse()) {
        const statusIcon = tc.status === "running" ? "●" : tc.status === "completed" ? "✓" : "✗"
        toolTable += `<tr>
  <td><code>${escapeHtml(tc.tool)}</code></td>
  <td class="${tc.status === "running" ? "running-text" : tc.status === "completed" ? "success-text" : "danger-text"}">${statusIcon} ${tc.status}</td>
  <td class="tiny-text cell-truncate">${escapeHtml(tc.inputSummary ?? "")}</td>
  <td class="tiny-text cell-truncate">${tc.error ? `<span class="danger-text">${escapeHtml(tc.error.slice(0, 60))}</span>` : escapeHtml(tc.outputSummary ?? "")}</td>
</tr>`
      }
      toolTable += "</tbody></table>"
      html += tableWrap(toolTable)
    }

    html += '</div>'
  }

  html += '</div>'
  return html
}

export function renderNodeHistory(
  history: NodeHistoryEntry[],
  runName: string,
): string {
  if (!history.length) return ""

  const nodes = [...history].reverse()

  let html = '<div class="section"><h2>Node History</h2><div class="card stack-card stack-card-history">'

  for (const entry of nodes) {
    const elapsed = entry.durationMs ?? (entry.completedAt - entry.startedAt)
    const elapsedStr = formatDurationMs(elapsed)
    const usageStr = entry.usageAvailable && entry.usage
      ? ` · ${formatUsagePair(entry.usage, true)}`
      : ""
    const icon = entry.status === "completed" ? "✓" : "✗"
    const linkNode = getNodeDefinition(entry.node)?.pipelineLabel ?? entry.node
    html += `<div class="node-history-row">
  <span class="node-history-icon ${entry.status === "completed" ? "success-text" : "danger-text"}">${icon}</span>
  <a class="node-history-link" href="/runs/${encodeURIComponent(runName)}/node/${encodeURIComponent(linkNode)}">${escapeHtml(entry.node)}</a>
  <span class="node-history-meta">${elapsedStr}${usageStr}</span>
  ${entry.round >= 0 ? `<span class="node-history-extra">· round ${entry.round}</span>` : ""}
  ${entry.rebuttalTurn ? `<span class="node-history-extra">· turn ${entry.rebuttalTurn}</span>` : ""}
  ${entry.summary ? `<span class="node-history-extra">· ${escapeHtml(JSON.stringify(entry.summary))}</span>` : ""}
  ${entry.error ? `<span class="node-history-error">${escapeHtml(entry.error.slice(0, 80))}</span>` : ""}
</div>`
  }

  html += '</div></div>'
  return html
}

export function renderInterviewChatCard(runName: string, liveStatus: LiveStatus | null): string {
  const awaiting = liveStatus?.awaitingReaderReply
  if (!awaiting) return ""
  const fullTranscript = awaiting.transcript ?? []
  const newQuestions = awaiting.newQuestions ?? []
  const answeredQuestions = awaiting.answeredQuestions ?? answeredQuestionsFromTranscript(
    fullTranscript.flatMap((entry) =>
      entry.role === "interviewer" || entry.role === "reader"
        ? [{ role: entry.role, text: entry.text }]
        : []
    ),
  )

  const historyHtml = answeredQuestions.map((pair, i) =>
    `<div class="chat-answered-turn">
      <div class="interviewer-msg"><span class="chat-icon">Question ${i + 1}</span> <span class="chat-text">${escapeHtml(pair.question)}</span></div>
      <div class="reader-msg"><span class="chat-icon">Answer ${i + 1}</span> <span class="chat-text">${escapeHtml(pair.answer)}</span></div>
    </div>`
  ).join("")
  const historySection = answeredQuestions.length > 0
    ? `<details class="interview-history">
        <summary>Answered history (${answeredQuestions.length} question${answeredQuestions.length === 1 ? "" : "s"})</summary>
        <div class="chat-transcript">${historyHtml}</div>
      </details>`
    : ""

  const inputsHtml = newQuestions.length > 0
    ? newQuestions.map((q, i) =>
        `<div class="chat-question-block">
          <div class="interviewer-msg"><span class="chat-icon">${newQuestions.length > 1 ? `Question ${i + 1}` : "Question"}</span> <span class="chat-text">${escapeHtml(q)}</span></div>
          <textarea name="a_${i}" rows="3" placeholder="your answer..." required></textarea>
        </div>`
      ).join("")
    : `<div class="chat-question-block">
        <textarea name="a_0" rows="4" placeholder="type your answer..." required></textarea>
      </div>`
  const currentTurn = awaiting.turn
  const profileSoFarHtml = awaiting.partialProfile
    ? `<div class="interview-profile-so-far">
        <div class="chat-current-label">Profile so far</div>
        ${renderReaderProfileSummary(awaiting.partialProfile)}
      </div>`
    : ""
  return `<div class="section interview-card">
  <h2>Reader interview · turn ${currentTurn}</h2>
  ${profileSoFarHtml}
  ${historySection}
  <div class="interview-current">
    <div class="chat-current-label">Answer this turn:</div>
    <form method="POST" action="/runs/${encodeURIComponent(runName)}/reply" class="chat-form" data-interview-reply-form>
      ${inputsHtml}
      <button type="submit">Send reply</button>
    </form>
  </div>
</div>`
}

export async function renderFailureBanner(
  runName: string,
  files: string[],
  liveStatus: LiveStatus | null,
): Promise<string> {
  const hasFinalMd = files.includes("final.md")
  const hasFailureJson = files.includes("failure.json")
  const hasLatestDraft = files.includes("latest-draft.md")
  const liveError = liveStatus?.phase === "error" ? liveStatus.error : undefined

  if (hasFinalMd) return ""
  if (!hasFailureJson && !hasLatestDraft && !liveError) return ""

  let failureReason = ""
  let round = "?"
  let unresolvedCount = "?"
  let errorMessage = liveError ?? ""

  if (hasFailureJson) {
    try {
      const p = safeFilePath(runName, "failure.json")
      const data = await Bun.file(p).json() as Record<string, unknown>
      failureReason = String(data.error ?? data.reason ?? "unknown")
    } catch { /* ignore */ }
  }

  if (files.includes("summary.json")) {
    try {
      const p = safeFilePath(runName, "summary.json")
      const data = await Bun.file(p).json() as Record<string, unknown>
      if (data.round !== undefined) round = String(data.round)
      if (Array.isArray(data.unresolvedFindings)) unresolvedCount = String(data.unresolvedFindings.length)
      if (data.failureReason) failureReason = String(data.failureReason)
      if (!errorMessage && data.error) errorMessage = String(data.error)
    } catch { /* ignore */ }
  }

  return `<div class="failure-banner">
  <div class="failure-banner-title">Run failed</div>
  <div class="failure-banner-detail">
    ${escapeHtml(failureReason)} · Round ${round} · ${unresolvedCount} findings unresolved
  </div>
  ${errorMessage ? `<div class="failure-banner-error">${escapeHtml(errorMessage)}</div>` : ""}
</div>`
}
