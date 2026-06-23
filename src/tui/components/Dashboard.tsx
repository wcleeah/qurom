import type { ResearchState } from "../../schema"
import { useTerminalDimensions } from "@opentui/react"
import { useEffect, useRef, useState } from "react"
import type { RunStore } from "../state/runStore"
import { useStoreSelector } from "../state/useStore"
import { theme } from "../theme"

export interface DashboardProps {
  store: RunStore
  selected?: boolean
  active?: boolean
}

const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

const useElapsed = (active: boolean): number => {
  const start = useRef<number>(Date.now())
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now - start.current
}

function roundBar(round: number, maxRounds: number, width: number): string {
  const pct = Math.min(1, round / Math.max(1, maxRounds))
  const blocks = Math.max(1, Math.floor(pct * width))
  return "█".repeat(blocks) + "░".repeat(Math.max(0, width - blocks))
}

function severityDot(severity: string): string {
  if (severity === "blocker") return "●"
  if (severity === "major") return "○"
  return "·"
}

function severityColor(severity: string): string {
  if (severity === "blocker") return theme.error
  if (severity === "major") return theme.warning
  return theme.textMuted
}

function auditVerdictIcon(vote: string): string {
  return vote === "approve" ? "✓" : "✗"
}

function auditVerdictColor(vote: string): string {
  return vote === "approve" ? theme.success : theme.error
}

function shortStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    drafting: "Drafting",
    auditing: "Auditing",
    reviewing_findings: "Reviewing findings",
    awaiting_auditor_rebuttal: "Rebuttal round",
    reviewing_rebuttal_responses: "Reviewing rebuttals",
    aggregating: "Aggregating",
    revising: "Revising draft",
    approved: "Approved",
    failed: "Failed",
  }
  return labels[status] ?? status
}

function findingsBreakdown(findings: Array<{ severity: string }>): string {
  const counts: Record<string, number> = { blocker: 0, major: 0, minor: 0 }
  for (const f of findings) {
    if (f.severity in counts) counts[f.severity]++
  }
  const parts: string[] = []
  if (counts.blocker > 0) parts.push(`${severityDot("blocker")} ${counts.blocker}`)
  if (counts.major > 0) parts.push(`${severityDot("major")} ${counts.major}`)
  if (counts.minor > 0) parts.push(`${severityDot("minor")} ${counts.minor}`)
  return parts.join("  ")
}

export const Dashboard = ({ store, selected = false, active = false }: DashboardProps) => {
  const { width } = useTerminalDimensions()
  const lifecyclePhase = useStoreSelector(store, (s) => s.lifecycle.phase)
  const outputDir = useStoreSelector(store, (s) => s.lifecycle.outputDir)
  const graphState = useStoreSelector(store, (s) => s.graph.state as ResearchState | undefined)
  const graphNode = useStoreSelector(store, (s) => s.graph.node)
  const graphPhase = useStoreSelector(store, (s) => s.graph.phase)
  const agents = useStoreSelector(store, (s) => s.agents)
  const round = useStoreSelector(store, (s) =>
    s.graph.state && "round" in s.graph.state ? (s.graph.state as { round?: number }).round : undefined,
  )

  const runActive = lifecyclePhase !== "complete" && lifecyclePhase !== "error"
  const elapsed = useElapsed(runActive)
  const status = graphState?.status ?? ""
  const wide = width >= 110

  // Audit data
  const audits = graphState?.audits ?? []
  const unresolved = graphState?.unresolvedFindings ?? []
  const rebuttals = Object.keys(graphState?.activeRebuttals ?? {}).length
  const rebuttalResponses = Object.keys(graphState?.currentRebuttalResponsesByFinding ?? {}).length
  const approvedAuditors = graphState?.approvedAgents?.length ?? 0
  const maxRounds = 10 // we don't have access to config here, reasonable default
  const currentRound = round ?? 0

  // Design quorum — detect running from graph node AND from state
  const designStatus = graphState?.designStatus
  // Node is actively executing runDesignQuorum
  const designNodeActive = graphNode === "runDesignQuorum" && graphPhase === "start"
  // Design has completed (status set on state)
  const designFinished = designStatus === "approved" || designStatus === "failed"
  // Design is in-progress (node running but not yet finished)
  const designRunning = designNodeActive && !designFinished
  const designApproved = designStatus === "approved"
  const designFailed = designStatus === "failed"

  // Agent activity
  const activeAgents = Object.entries(agents)
    .filter(([, a]) => a.status === "running")
    .map(([name]) => name)

  const borderColor = active || selected ? theme.selectionBorder : theme.borderSubtle

  // --- Phase-specific rendering helpers ---

  const renderStatusLine = () => {
    const roundText = status !== "drafting" ? `Round ${currentRound}/${maxRounds}` : ""
    const bar = status !== "drafting" ? roundBar(currentRound, maxRounds, 8) : ""
    const designTag = designRunning ? " · 🎨 design" : designApproved ? " · 🎨 ✓" : designFailed ? " · 🎨 ✗" : ""
    const tierTag = graphState?.depthTier && graphState.depthTier !== "analysis"
      ? ` (${graphState.depthTier} tier)`
      : ""

    let icon = "⬤"
    let label = shortStatusLabel(status)
    let labelColor = theme.accent

    if (status === "approved") { icon = "✓"; labelColor = theme.success }
    if (status === "failed") { icon = "✗"; labelColor = theme.error }
    if (status === "revising") labelColor = theme.warning

    return (
      <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
        <span fg={labelColor}>{icon} {label}{tierTag}</span>
        <span fg={theme.textMuted}>{designTag}</span>
        {roundText ? (
          <>
            <span fg={theme.textMuted}>{"  "}{roundText}  {bar}</span>
          </>
        ) : null}
        <span fg={theme.textMuted}>{"  elapsed "}{formatElapsed(elapsed)}</span>
      </text>
    )
  }

  const renderAuditorVerdicts = () => {
    if (audits.length === 0) {
      if (status === "auditing" && activeAgents.length > 0) {
        return (
          <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
            <span fg={theme.textMuted}>auditors: </span>
            <span fg={theme.status.running}>{activeAgents.filter(a => a !== "research-drafter").join(", ")} running...</span>
          </text>
        )
      }
      return null
    }

    return (
      <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
        <span fg={theme.textMuted}>auditors: </span>
        {audits.map((audit, i) => (
          <span key={audit.agent}>
            {i > 0 ? <span fg={theme.textMuted}>{"  "}</span> : null}
            <span fg={auditVerdictColor(audit.vote)}>{auditVerdictIcon(audit.vote)}</span>
            <span fg={theme.text}> {audit.agent}</span>
            {audit.vote === "revise" && audit.findings.length > 0 ? (
              <span fg={theme.textMuted}> ({audit.findings.length})</span>
            ) : null}
          </span>
        ))}
      </text>
    )
  }

  const renderAuditDetail = () => {
    if (audits.length === 0) return null

    const revised = audits.filter(a => a.vote === "revise")
    if (revised.length === 0) return null

    const allFindings = revised.flatMap(a => a.findings)
    if (allFindings.length === 0) return null

    const breakdown = findingsBreakdown(allFindings)

    return (
      <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
        <span fg={theme.textMuted}>research findings: </span>
        <span fg={theme.text}>{breakdown}</span>
      </text>
    )
  }

  const renderUnresolved = () => {
    if (unresolved.length === 0) return null

    const breakdown = findingsBreakdown(unresolved)

    return (
      <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
        <span fg={theme.textMuted}>research unresolved: </span>
        <span fg={theme.text}>{breakdown}</span>
      </text>
    )
  }

  const renderRebuttalStatus = () => {
    if (rebuttals === 0 && rebuttalResponses === 0) return null

    const parts: string[] = []
    if (rebuttals > 0) parts.push(`${rebuttals} active rebuttals`)
    if (rebuttalResponses > 0) parts.push(`${rebuttalResponses} auditor responses`)

    return (
      <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
        <span fg={theme.textMuted}>{parts.join("  ·  ")}</span>
      </text>
    )
  }

  const renderVerdict = () => {
    if (status === "approved") {
      const n = audits.length || 3
      const a = approvedAuditors || n
      return (
        <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
          <span fg={theme.success}>{a}/{n} auditors approved</span>
        </text>
      )
    }

    if (status === "failed") {
      const reason = graphState?.failureReason
      const msg = reason === "max_rounds_exhausted" ? "Max rounds exhausted"
        : reason === "stagnated_findings" ? "Findings stagnated — no progress"
        : "Run failed"
      return (
        <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
          <span fg={theme.error}>{msg}</span>
          {outputDir ? <span fg={theme.textMuted}>{"  ·  "}{outputDir}</span> : null}
        </text>
      )
    }

    return null
  }

  const renderDesignQuorumLine = () => {
    // Show design status when: design node is running, or design has finished
    if (!designRunning && !designFinished) return null
    // Don't show during early research phases
    if (graphState?.status === "drafting" || graphState?.status === "auditing" || graphState?.status === "reviewing_findings") return null

    if (designRunning) {
      const designActiveAgents = Object.entries(agents)
        .filter(([, a]) => a.status === "running")
        .map(([name]) => name)

      return (
        <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
          <span fg={theme.status.running}>🎨 HTML design running</span>
          {designActiveAgents.length > 0 ? (
            <span fg={theme.textMuted}> — {designActiveAgents.join(", ")}</span>
          ) : null}
        </text>
      )
    }

    if (designStatus === "approved") {
      return (
        <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
          <span fg={theme.success}>🎨 HTML: approved → {outputDir ?? "."}/final.html</span>
        </text>
      )
    }

    if (designStatus === "failed") {
      return (
        <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
          <span fg={theme.warning}>🎨 HTML: finished with issues → {outputDir ?? "."}/final.html</span>
        </text>
      )
    }

    return null
  }

  const renderArtifactsLine = () => {
    if (lifecyclePhase !== "complete" && lifecyclePhase !== "error") return null

    return (
      <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
        <span fg={theme.textMuted}>output: </span>
        <span fg={theme.textMuted}>{outputDir ?? "(pending)"}</span>
        <span fg={theme.textMuted}>{"  ·  "}press e to view draft</span>
      </text>
    )
  }

  // --- Main render ---

  return (
    <box
      border
      borderStyle="single"
      borderColor={borderColor}
      backgroundColor={theme.backgroundElement}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      marginLeft={1}
      marginRight={1}
      flexShrink={0}
    >
      <box flexDirection="column" gap={0}>
        {renderStatusLine()}
        {renderAuditorVerdicts()}
        {renderAuditDetail()}
        {renderRebuttalStatus()}
        {renderUnresolved()}
        {renderVerdict()}
        {renderDesignQuorumLine()}
        {renderArtifactsLine()}
      </box>
    </box>
  )
}
