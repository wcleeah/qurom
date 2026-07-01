import { safeFilePath } from "./paths"
import { escapeHtml, statusDot } from "./utils"
import type { LiveAgentStatus, LiveStatus, RunStatus } from "./types"

export function renderLivePipeline(
  liveStatus: LiveStatus | null,
  files: string[],
  researchStatus: RunStatus,
  runName?: string,
): string {
  const activeNode = liveStatus?.node
  const liveAgents = liveStatus?.agents ?? {}

  // Determine node completion from files on disk
  const hasFile = (pattern: RegExp) => files.some((f) => pattern.test(f))
  const hasReaderProfile = hasFile(/^reader-profile\.json$/)
  const hasDraft = hasFile(/^draft-round-\d+\.md$/)
  const hasAudits = hasFile(/^audits-round-\d+\.json$/)
  const hasDrafterReview = hasFile(/^drafter-finding-review-round-\d+\.json$/)
  const hasRebuttals = hasFile(/^auditor-rebuttal-responses-.*-round-\d+\.json$/)
  const hasRebuttalReview = hasFile(/^drafter-rebuttal-review-round-\d+\.json$/)
  const hasAggregated = hasFile(/^aggregated-findings-round-\d+\.json$/)
  const hasFinalMd = hasFile(/^final\.md$/)
  const hasLatestDraft = hasFile(/^latest-draft\.md$/)

  function nodeRow(num: number, label: string, completed: boolean, isActive: boolean, meta?: string, agentList?: string): string {
    const icon = isActive ? "●" : completed ? "✓" : "○"
    const cls = isActive ? "pipeline-node active" : "pipeline-node"
    const labelHtml = runName && completed
      ? `<a href="/runs/${encodeURIComponent(runName)}/node/${encodeURIComponent(label)}">${escapeHtml(label)}</a>`
      : escapeHtml(label)
    return `<div class="${cls}">
  <div class="pipeline-node-label"><span class="pipeline-icon">${icon}</span> ${num}. ${labelHtml}${meta ? ` <span class="pipeline-node-meta">${meta}</span>` : ""}</div>
  ${agentList ? `<div class="pipeline-agent-list">${agentList}</div>` : ""}
</div>`
  }

  function agentListHtml(agents: Record<string, LiveAgentStatus>): string {
    return Object.entries(agents)
      .sort(([, a], [, b]) => {
        const order: Record<string, number> = { running: 0, complete: 1, error: 2, idle: 3 }
        return (order[a.status] ?? 3) - (order[b.status] ?? 3)
      })
      .map(([name, agent]) =>
        `<span class="pipeline-agent-item">${statusDot(agent.status)} ${escapeHtml(name)}${agent.tool ? ` · ${escapeHtml(agent.tool)}` : ""}</span>`
      )
      .join("\n")
  }

  const isActive = (node: string) => activeNode === node
  const researchDone = researchStatus === "approved" || researchStatus === "failed"
  const terminalLabel = researchStatus === "approved" ? "finalizeApprovedDraft" : researchStatus === "failed" ? "finalizeFailedRun" : "finalize"

  let html = '<div class="section"><h2>📊 Pipeline</h2><div class="card stack-card stack-card-tight">'

  // Research nodes
  html += nodeRow(1, "ingestRequest", true, isActive("ingestRequest"))
  html += nodeRow(2, "summarizeInputDocument", researchStatus !== "running" || hasFile(/./), isActive("summarizeInputDocument"))
  html += nodeRow(3, "prepareOutputPath", hasFile(/./), isActive("prepareOutputPath"))
  html += nodeRow(4, "discoverReader", hasReaderProfile, isActive("discoverReaderPrompt") || isActive("discoverReaderResume"),
    hasReaderProfile ? "· profile ready" : (isActive("discoverReaderPrompt") || isActive("discoverReaderResume") ? "· interviewing" : ""),
    (isActive("discoverReaderPrompt") || isActive("discoverReaderResume")) ? agentListHtml(liveAgents) : "")
  html += nodeRow(5, "draftFullDraft", hasDraft, isActive("draftFullDraft"),
    hasDraft ? `· ${files.filter((f) => /^draft-round-\d+\.md$/.test(f)).length} rounds` : "",
    isActive("draftFullDraft") ? agentListHtml(liveAgents) : "")
  html += nodeRow(6, "runParallelAudits", hasAudits, isActive("runParallelAudits"),
    hasAudits ? `· ${files.filter((f) => /^audits-round-\d+\.json$/.test(f)).length} rounds` : "",
    isActive("runParallelAudits") ? agentListHtml(liveAgents) : "")
  html += nodeRow(7, "reviewFindingsByDrafter", hasDrafterReview, isActive("reviewFindingsByDrafter"),
    "", isActive("reviewFindingsByDrafter") ? agentListHtml(liveAgents) : "")
  html += nodeRow(8, "runTargetedRebuttals", hasRebuttals, isActive("runTargetedRebuttals"),
    "", isActive("runTargetedRebuttals") ? agentListHtml(liveAgents) : "")
  html += nodeRow(9, "reviewRebuttalResponses", hasRebuttalReview, isActive("reviewRebuttalResponses"),
    "", isActive("reviewRebuttalResponses") ? agentListHtml(liveAgents) : "")
  html += nodeRow(10, "aggregateConsensus", hasAggregated, isActive("aggregateConsensus"))
  html += nodeRow(11, "computeConfidence", hasAggregated, isActive("computeConfidence"))
  html += nodeRow(12, researchDone ? terminalLabel : "reviseDraft", researchDone, isActive("reviseDraft") || isActive("finalizeApprovedDraft") || isActive("finalizeFailedRun"))
  html += nodeRow(13, "summarizeOutputArtifact", hasFinalMd || hasLatestDraft, isActive("summarizeOutputArtifact"))

  // Design nodes (flattened into main graph)
  const hasDesignHtml = hasFile(/^design-html-round-0\.html$/)
  const hasDesignAudits = hasFile(/^design-audits-round-\d+\.json$/)
  const hasDesignConsensus = hasFile(/^design-consensus-round-\d+\.json$/)
  const hasDesignHtmlNext = hasFile(/^design-html-round-[1-9]\d*\.html$/)

  // Always show design nodes — status varies by completion
  const designMeta = researchStatus === "approved"
    ? "(pending)"
    : researchStatus === "running"
      ? "(after research)"
      : ""
  html += nodeRow(14, "runDesignHtml", hasDesignHtml, isActive("runDesignHtml"),
    hasDesignHtml ? "" : designMeta, isActive("runDesignHtml") ? agentListHtml(liveAgents) : "")
  html += nodeRow(15, "interactiveEnhance", hasDesignHtml, isActive("interactiveEnhance"),
    "", isActive("interactiveEnhance") ? agentListHtml(liveAgents) : "")
  html += nodeRow(16, "runDesignAudits", hasDesignAudits, isActive("runDesignAudits"),
    hasDesignAudits ? `· ${files.filter((f) => /^design-audits-round-\d+\.json$/.test(f)).length} rounds` : "",
    isActive("runDesignAudits") ? agentListHtml(liveAgents) : "")
  html += nodeRow(17, "aggregateDesignFindings", hasDesignConsensus, isActive("aggregateDesignFindings"))
  html += nodeRow(18, "reviseDesignHtml", hasDesignHtmlNext, isActive("reviseDesignHtml"),
    hasDesignHtmlNext ? `· ${files.filter((f) => /^design-html-round-[1-9]\d*\.html$/.test(f)).length} revisions` : "",
    isActive("reviseDesignHtml") ? agentListHtml(liveAgents) : "")
  // finalizeDesign writes final.html; it's the terminal step for the design phase.
  // Show it whenever a design phase ran. Active only briefly before __end__.
  const hasFinalHtmlFile = files.includes("final.html")
  const designRan = hasDesignHtml || hasDesignAudits || hasDesignConsensus || hasDesignHtmlNext
  if (designRan) {
    html += nodeRow(19, "finalizeDesign", hasFinalHtmlFile, isActive("finalizeDesign"),
      hasFinalHtmlFile ? "· final.html written" : "",
      isActive("finalizeDesign") ? agentListHtml(liveAgents) : "")
  }

  html += '</div></div>'
  return html
}

// ---------------------------------------------------------------------------
// Agent activity (tool calls + reasoning)
// ---------------------------------------------------------------------------

export function renderAgentActivity(liveStatus: LiveStatus | null): string {
  if (!liveStatus || !liveStatus.agents || Object.keys(liveStatus.agents).length === 0) return ""

  const agents = Object.entries(liveStatus.agents)
    .filter(([, a]) => a.toolCalls.length > 0 || a.reasoning)
  if (agents.length === 0) return ""

  let html = '<div class="section"><h2>🤖 Agent Activity</h2>'

  for (const [name, agent] of agents) {
    html += `<div class="card card-compact"><div class="agent-card-title">${statusDot(agent.status)} ${escapeHtml(name)} <span class="agent-card-status">(${agent.status})</span></div>`

    // Reasoning (latest chunk)
    if (agent.reasoning) {
      html += `<details class="markdown-preview agent-reasoning"><summary>💭 Reasoning</summary><pre>${escapeHtml(agent.reasoning)}</pre></details>`
    }

    // Tool calls
    if (agent.toolCalls.length > 0) {
      html += '<table class="summary-table summary-table-compact"><thead><tr><th>Tool</th><th>Status</th><th>Input</th><th>Output</th></tr></thead><tbody>'
      for (const tc of agent.toolCalls.slice(-10).reverse()) {
        const statusIcon = tc.status === "running" ? "●" : tc.status === "completed" ? "✓" : "✗"
        html += `<tr>
  <td><code>${escapeHtml(tc.tool)}</code></td>
  <td class="${tc.status === "running" ? "running-text" : tc.status === "completed" ? "success-text" : "danger-text"}">${statusIcon} ${tc.status}</td>
  <td class="tiny-text cell-truncate">${escapeHtml(tc.inputSummary ?? "")}</td>
  <td class="tiny-text cell-truncate">${tc.error ? `<span class="danger-text">${escapeHtml(tc.error.slice(0, 60))}</span>` : escapeHtml(tc.outputSummary ?? "")}</td>
</tr>`
      }
      html += '</tbody></table>'
    }

    html += '</div>'
  }

  html += '</div>'
  return html
}

// ---------------------------------------------------------------------------
// Node history timeline
// ---------------------------------------------------------------------------

export function renderNodeHistory(liveStatus: LiveStatus | null, runName: string): string {
  if (!liveStatus?.nodeHistory?.length) return ""

  const nodes = [...liveStatus.nodeHistory].reverse()

  let html = '<div class="section"><h2>📋 Node History</h2><div class="card stack-card stack-card-history">'

  for (const entry of nodes) {
    const elapsed = entry.completedAt - entry.startedAt
    const elapsedStr = elapsed > 1000 ? `${(elapsed / 1000).toFixed(1)}s` : `${elapsed}ms`
    const icon = entry.status === "completed" ? "✓" : "✗"
    html += `<div class="node-history-row">
  <span class="node-history-icon ${entry.status === "completed" ? "success-text" : "danger-text"}">${icon}</span>
  <a class="node-history-link" href="/runs/${encodeURIComponent(runName)}/node/${encodeURIComponent(entry.node)}">${escapeHtml(entry.node)}</a>
  <span class="node-history-meta">${elapsedStr}</span>
  ${entry.round > 0 ? `<span class="node-history-extra">· round ${entry.round}</span>` : ""}
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
  const questions = awaiting.questions ?? []
  // The checkpointed transcript's last entry is the current pending question
  // (discoverReaderPrompt appended it before the resume node called interrupt).
  // Everything before that is answered history — alternating interviewer (Q)
  // and reader (A) entries, two per turn. Drop the last entry so the current
  // questions (rendered below with per-question inputs) don't appear twice.
  const historyEntries = questions.length > 0
    ? fullTranscript.slice(0, -1)
    : fullTranscript

  // Group answered history into turns (each turn = one Q entry + one A entry).
  // Each group renders with a 'Turn N ✓ answered' label, dimmed, inside a
  // collapsible <details> so the user can focus on the current question.
  const turns: Array<{ q: string; a: string }> = []
  for (let i = 0; i + 1 < historyEntries.length; i += 2) {
    const qEntry = historyEntries[i]
    const aEntry = historyEntries[i + 1]
    if (qEntry && aEntry && qEntry.role === "interviewer" && aEntry.role === "reader") {
      turns.push({ q: qEntry.text, a: aEntry.text })
    } else if (qEntry && qEntry.role === "reader") {
      // Stray reader reply with no preceding question — append as a lone answer.
      turns.push({ q: "", a: qEntry.text })
    }
  }
  const answeredTurns = turns.length
  const historyHtml = turns.map((t, i) =>
    `<div class="chat-answered-turn">
      <div class="chat-turn-label">✓ Turn ${i + 1} · answered</div>
      ${t.q ? `<div class="interviewer-msg"><span class="chat-icon">🤖</span> <span class="chat-text">${escapeHtml(t.q)}</span></div>` : ""}
      <div class="reader-msg"><span class="chat-icon">👤</span> <span class="chat-text">${escapeHtml(t.a)}</span></div>
    </div>`
  ).join("")
  const historySection = answeredTurns > 0
    ? `<details class="interview-history">
        <summary>📜 Answered history (${answeredTurns} turn${answeredTurns === 1 ? "" : "s"}) ▾</summary>
        <div class="chat-transcript">${historyHtml}</div>
      </details>`
    : ""

  // Current pending questions: one bubble + one textarea each. No hidden
  // question carry — the POST handler reads the answers by index only, and
  // the pairing with questions is reconstructed from transcript position at
  // prompt-build time (the interviewer sees the full transcript anyway).
  // required on every textarea = browser-level validation, no JS.
  const inputsHtml = questions.length > 0
    ? questions.map((q, i) =>
        `<div class="chat-question-block">
          <div class="interviewer-msg"><span class="chat-icon">🤖</span> <span class="chat-text">${escapeHtml(q)}</span></div>
          <textarea name="a_${i}" rows="3" placeholder="your answer..." required></textarea>
        </div>`
      ).join("")
    : `<div class="chat-question-block">
        <textarea name="a_0" rows="4" placeholder="type your answer..." required></textarea>
      </div>`
  const currentTurn = awaiting.turn
  return `<div class="section interview-card">
  <h2>🎙 Reader interview · turn ${currentTurn}</h2>
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
  // Check for failure from files
  const hasFinalMd = files.includes("final.md")
  const hasFailureJson = files.includes("failure.json")
  const hasLatestDraft = files.includes("latest-draft.md")
  const liveError = liveStatus?.phase === "error" ? liveStatus.error : undefined

  // If final.md exists, the run was approved (latest-draft.md may exist from design phase)
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

  // Try summary.json for more detail
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
  <div class="failure-banner-title">❌ Run failed</div>
  <div class="failure-banner-detail">
    ${escapeHtml(failureReason)} · Round ${round} · ${unresolvedCount} findings unresolved
  </div>
  ${errorMessage ? `<div class="failure-banner-error">${escapeHtml(errorMessage)}</div>` : ""}
</div>`
}

