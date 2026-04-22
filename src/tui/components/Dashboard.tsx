import type { ResearchState } from "../../schema"
import { useTerminalDimensions } from "@opentui/react"
import { useEffect, useRef, useState } from "react"
import type { RunStore } from "../state/runStore"
import { useStoreSelector } from "../state/useStore"
import { theme } from "../theme"

export interface DashboardProps {
  store: RunStore
  focused?: boolean
}

const roleLabel = (roleKey: string): string => {
  if (roleKey === "research-drafter") return "drafter"
  return roleKey.replace(/-auditor$/, "")
}

const statusDot = (status: "idle" | "running" | "error" | "complete"): string => {
  if (status === "running") return "●"
  if (status === "complete") return "✓"
  if (status === "error") return "✗"
  return "○"
}

const statusColor = (status: "idle" | "running" | "error" | "complete"): string => {
  if (status === "running") return theme.status.running
  if (status === "complete") return theme.status.complete
  if (status === "error") return theme.status.error
  return theme.status.idle
}

const phaseColor = (phase: "starting" | "running" | "complete" | "error"): string => {
  if (phase === "complete") return theme.success
  if (phase === "error") return theme.error
  return theme.accent
}

const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

const abbreviateDocumentPath = (value?: string): string => {
  if (!value) return "-"
  const parts = value.split("/").filter(Boolean)
  if (parts.length <= 2) return value
  return `${parts.at(-2)}/${parts.at(-1)}`
}

const formatInputLabel = (state?: ResearchState): string | undefined => {
  if (!state) return undefined
  if (state.inputMode === "topic") {
    return state.topic ? `prompt  ${state.topic}` : undefined
  }
  return `document  ${abbreviateDocumentPath(state.documentPath)}`
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

export const Dashboard = ({ store, focused = false }: DashboardProps) => {
  const { width } = useTerminalDimensions()
  const phase = useStoreSelector(store, (s) => s.lifecycle.phase)
  const requestId = useStoreSelector(store, (s) => s.lifecycle.requestId)
  const traceId = useStoreSelector(store, (s) => s.lifecycle.traceId)
  const outputDir = useStoreSelector(store, (s) => s.lifecycle.outputDir)
  const graphNode = useStoreSelector(store, (s) => s.graph.node)
  const graphPhase = useStoreSelector(store, (s) => s.graph.phase)
  const graphState = useStoreSelector(store, (s) => s.graph.state as ResearchState | undefined)
  const agents = useStoreSelector(store, (s) => s.agents)
  const round = useStoreSelector(store, (s) =>
    s.graph.state && "round" in s.graph.state ? (s.graph.state as { round?: number }).round : undefined,
  )

  const active = phase !== "complete" && phase !== "error"
  const elapsed = useElapsed(active)
  const wide = width >= 120
  const medium = width >= 95
  const voteApproveCount = graphState?.audits.filter((audit) => audit.vote === "approve").length ?? 0
  const voteReviseCount = graphState?.audits.filter((audit) => audit.vote === "revise").length ?? 0
  const acceptedCount = Math.max(0, voteReviseCount - Object.keys(graphState?.activeRebuttals ?? {}).length)
  const rebuttalCount = Object.keys(graphState?.activeRebuttals ?? {}).length
  const rebuttalResponseCount = Object.keys(graphState?.currentRebuttalResponsesByFinding ?? {}).length
  const unresolvedCount = graphState?.unresolvedFindings.length ?? 0
  const approvedCount = graphState?.approvedAgents.length ?? 0
  const inputLabel = formatInputLabel(graphState)

  return (
    <box
      border
      borderStyle="single"
      borderColor={focused ? theme.borderActive : theme.borderSubtle}
      backgroundColor={theme.backgroundElement}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      marginLeft={1}
      marginRight={1}
      flexShrink={0}
    >
      <box flexDirection="column" gap={wide ? 1 : 0}>
        <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
          <span fg={phaseColor(phase)}>{phase}</span>
          <span fg={theme.textMuted}>{`  ·  round ${round ?? "-"}`}</span>
          {graphNode ? <span fg={theme.accent}>{`  ·  node ${graphNode}`}</span> : null}
          {graphPhase ? <span fg={theme.accent}>{`  ·  ${graphPhase}`}</span> : null}
          <span fg={theme.textMuted}>{`  ·  ${formatElapsed(elapsed)}`}</span>
        </text>
        {medium ? (
          <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
            request {requestId ?? "-"}
          </text>
        ) : null}
        {medium ? (
          <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
            trace   {traceId ?? "-"}
          </text>
        ) : null}
        {inputLabel ? (
          <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
            <span fg={theme.accent}>{inputLabel}</span>
          </text>
        ) : null}
        {wide && outputDir ? (
          <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
            output  {outputDir}
          </text>
        ) : null}
        {graphState ? (
          <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
            <span fg={theme.accent}>{`findings ${unresolvedCount}`}</span>
            <span fg={theme.textMuted}>{`  ·  votes ${voteApproveCount} approve / ${voteReviseCount} revise`}</span>
            <span fg={theme.textMuted}>{`  ·  rebuttals ${rebuttalCount}`}</span>
            <span fg={theme.textMuted}>{`  ·  responses ${rebuttalResponseCount}`}</span>
            <span fg={theme.textMuted}>{`  ·  accepted ${acceptedCount}`}</span>
            <span fg={theme.textMuted}>{`  ·  approved ${approvedCount}`}</span>
          </text>
        ) : null}
        <box flexDirection={wide ? "row" : "column"} gap={wide ? 2 : 0}>
          {Object.entries(agents).map(([roleKey, agent]) => (
            <text key={roleKey} wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
              <span fg={statusColor(agent.status)}>{statusDot(agent.status)}</span>
              <span fg={theme.textMuted}>{` ${roleLabel(roleKey)}`}</span>
              <span fg={theme.textMuted}>{`  ${agent.status}`}</span>
              {agent.activeTool ? <span fg={theme.textMuted}>{`  ·  ${agent.activeTool.tool}`}</span> : null}
              {agent.pendingPermission ? <span fg={theme.accent}>{`  ·  permission ${agent.pendingPermission}`}</span> : null}
            </text>
          ))}
        </box>
        {!wide && outputDir ? (
          <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
            output  {outputDir}
          </text>
        ) : null}
      </box>
    </box>
  )
}
