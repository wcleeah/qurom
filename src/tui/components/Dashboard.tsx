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

export const Dashboard = ({ store, selected = false, active = false }: DashboardProps) => {
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

  const runActive = phase !== "complete" && phase !== "error"
  const elapsed = useElapsed(runActive)
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
  const borderColor = active ? theme.borderActive : selected ? theme.selectionBorder : theme.borderSubtle
  const focusLabel = active ? "focus" : selected ? "selected" : undefined

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
      <box flexDirection={wide ? "row" : "column"} gap={wide ? 4 : 2}>
        <box flexGrow={2} flexDirection="column" gap={1}>
          <text fg={theme.accent} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
            Run{focusLabel ? `: ${focusLabel}` : ""}
          </text>
          <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
            <span fg={theme.textMuted}>phase: </span>
            <span fg={theme.text}>{phase}</span>
          </text>
          <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
            <span fg={theme.textMuted}>round: </span>
            <span fg={theme.text}>{round ?? "-"}</span>
            <span fg={theme.textMuted}>{" | node: "}</span>
            <span fg={theme.text}>{graphNode ?? "-"}</span>
          </text>
          <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
            <span fg={theme.textMuted}>step: </span>
            <span fg={theme.text}>{graphPhase ?? "-"}</span>
            <span fg={theme.textMuted}>{" | elapsed: "}</span>
            <span fg={theme.text}>{formatElapsed(elapsed)}</span>
          </text>
        </box>

        <box flexGrow={2} flexDirection="column" gap={1}>
          <text fg={theme.accent} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
            Input
          </text>
          {inputLabel ? (
            <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
              <span fg={theme.textMuted}>input: </span>
              <span fg={theme.text}>{inputLabel}</span>
            </text>
          ) : null}
          {medium ? (
            <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
              <span fg={theme.textMuted}>request: </span>
              <span fg={theme.text}>{requestId ?? "-"}</span>
            </text>
          ) : null}
        </box>

        <box flexGrow={2} flexDirection="column" gap={1}>
          <text fg={theme.accent} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
            Progress
          </text>
          {graphState ? (
            <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
              <span fg={theme.textMuted}>findings: </span>
              <span fg={theme.text}>{unresolvedCount}</span>
              <span fg={theme.textMuted}>{" | votes: "}</span>
              <span fg={theme.text}>{`${voteApproveCount} approve / ${voteReviseCount} revise`}</span>
            </text>
          ) : null}
          <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
            <span fg={theme.textMuted}>rebuttals: </span>
            <span fg={theme.text}>{rebuttalCount}</span>
            <span fg={theme.textMuted}>{" | responses: "}</span>
            <span fg={theme.text}>{rebuttalResponseCount}</span>
            <span fg={theme.textMuted}>{" | accepted: "}</span>
            <span fg={theme.text}>{acceptedCount}</span>
            <span fg={theme.textMuted}>{" | approved: "}</span>
            <span fg={theme.text}>{approvedCount}</span>
          </text>
        </box>

        <box flexGrow={2} flexDirection="column" gap={1}>
          <text fg={theme.accent} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
            Artifacts
          </text>
          {traceId ? (
            <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
              <span fg={theme.textMuted}>trace: </span>
              <span fg={theme.text}>{traceId}</span>
            </text>
          ) : null}
          {outputDir ? (
            <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
              <span fg={theme.textMuted}>output: </span>
              <span fg={theme.text}>{outputDir}</span>
            </text>
          ) : null}
        </box>
      </box>
    </box>
  )
}
