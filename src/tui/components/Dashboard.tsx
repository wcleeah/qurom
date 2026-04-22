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
      <box flexDirection={wide ? "row" : "column"} gap={wide ? 2 : 1}>
        <box flexGrow={3} flexDirection="column">
          <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
            <span fg={phaseColor(phase)}>{phase}</span>
            <span fg={theme.textMuted}>{`  ·  round ${round ?? "-"}`}</span>
            {graphNode ? <span fg={theme.accent}>{`  ·  ${graphNode}`}</span> : null}
            {graphPhase ? <span fg={theme.textMuted}>{`  ${graphPhase}`}</span> : null}
            <span fg={theme.textMuted}>{`  ·  ${formatElapsed(elapsed)}`}</span>
          </text>
          {inputLabel ? (
            <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
              <span fg={theme.textMuted}>input </span>
              <span fg={theme.text}>{inputLabel}</span>
            </text>
          ) : null}
          {medium ? (
            <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
              <span fg={theme.textMuted}>request </span>
              <span fg={theme.text}>{requestId ?? "-"}</span>
            </text>
          ) : null}
        </box>

        <box flexGrow={2} flexDirection="column">
          {graphState ? (
            <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
              <span fg={theme.warning}>{`findings ${unresolvedCount}`}</span>
              <span fg={theme.textMuted}>{`  ·  ${voteApproveCount} approve / ${voteReviseCount} revise`}</span>
            </text>
          ) : null}
          <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
            <span fg={theme.textMuted}>rebuttals </span>
            <span fg={theme.warning}>{rebuttalCount}</span>
            <span fg={theme.textMuted}>{`  ·  responses `}</span>
            <span fg={theme.text}>{rebuttalResponseCount}</span>
            <span fg={theme.textMuted}>{`  ·  accepted `}</span>
            <span fg={theme.success}>{acceptedCount}</span>
            <span fg={theme.textMuted}>{`  ·  approved `}</span>
            <span fg={theme.success}>{approvedCount}</span>
          </text>
          {traceId ? (
            <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
              <span fg={theme.textMuted}>trace </span>
              <span fg={theme.text}>{traceId}</span>
            </text>
          ) : null}
          {outputDir ? (
            <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
              <span fg={theme.textMuted}>output </span>
              <span fg={theme.text}>{outputDir}</span>
            </text>
          ) : null}
        </box>
      </box>
    </box>
  )
}
