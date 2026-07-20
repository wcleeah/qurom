import { tableWrap } from "./html"
import { safeFilePath } from "./paths"
import { answeredQuestionsFromTranscript } from "../reader-transcript"
import { renderReaderProfileSummary } from "./artifact-renderers"
import { getNodeDefinition } from "./node-registry"
import { escapeHtml, formatDurationMs, formatUsagePair, statusDot } from "./utils"
import type { SessionTelemetryFile } from "../session-telemetry"
import { sessionUsageForHistoryEntry, usageLabelForRole } from "./telemetry-view"
import type { LiveStatus, NodeHistoryEntry } from "./types"

export function renderAgentActivity(
  liveStatus: LiveStatus | null,
  sessionTelemetry?: SessionTelemetryFile | null,
): string {
  if (!liveStatus || !liveStatus.agents || Object.keys(liveStatus.agents).length === 0) return ""

  const agents = Object.entries(liveStatus.agents)
    .filter(([, a]) => a.toolCalls.length > 0 || a.reasoning)
  if (agents.length === 0) return ""

  let html = '<div class="section"><h2>Agent Activity</h2>'

  for (const [name, agent] of agents) {
    const usageLabel = usageLabelForRole(sessionTelemetry, name)
    const usageHtml = usageLabel
      ? ` <span class="agent-card-tokens dim-text">${escapeHtml(usageLabel)}</span>`
      : ""
    html += `<div class="card card-compact"><div class="agent-card-title">${statusDot(agent.status)} ${escapeHtml(name)} <span class="agent-card-status">(${agent.status})</span>${usageHtml}</div>`

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
  sessionTelemetry?: SessionTelemetryFile | null,
): string {
  if (!history.length) return ""

  const nodes = [...history].reverse()

  let html = '<div class="section"><h2>Node History</h2><div class="card stack-card stack-card-history">'

  for (const entry of nodes) {
    const elapsed = entry.durationMs ?? (entry.completedAt - entry.startedAt)
    const elapsedStr = formatDurationMs(elapsed)
    const usage = sessionUsageForHistoryEntry(sessionTelemetry, entry)
    const usageStr = usage.usageAvailable || usage.costAvailable
      ? ` · ${formatUsagePair(usage, true)}`
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
  if (!awaiting || liveStatus?.phase !== "running") return ""
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
      <input type="hidden" name="turn" value="${currentTurn}" />
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
  if (liveStatus?.phase === "running") return ""

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
