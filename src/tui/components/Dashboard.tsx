import { useEffect, useRef, useState } from "react"
import type { RunStore, RunStoreState } from "../state/runStore"
import { useStoreSelector } from "../state/useStore"
import { theme } from "../theme"

export interface DashboardProps {
  store: RunStore
}

const shortId = (id?: string): string => (id ? `${id.slice(0, 4)}..` : "----")

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

const selectSummary = (s: RunStoreState) => ({
  phase: s.lifecycle.phase,
  requestId: s.lifecycle.requestId,
  traceId: s.lifecycle.traceId,
  outputDir: s.lifecycle.outputDir,
  graphNode: s.graph.node,
  graphPhase: s.graph.phase,
  round: s.graph.state && "round" in s.graph.state ? (s.graph.state as { round?: number }).round : undefined,
})

export const Dashboard = ({ store }: DashboardProps) => {
  const summary = useStoreSelector(store, selectSummary)
  const active = summary.phase !== "complete" && summary.phase !== "error"
  const elapsed = useElapsed(active)

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" alignItems="center" gap={2}>
        <ascii-font font="tiny" text="QUORUM" />
        <box flexDirection="column">
          <text>
            <span fg={theme.accent}>{summary.phase}</span>
            <span fg={theme.dim}>  ·  node </span>
            <span>{summary.graphNode ?? "-"}</span>
            <span fg={theme.dim}>  ·  round </span>
            <span>{summary.round ?? "-"}</span>
          </text>
          <text>
            <span fg={theme.dim}>req </span>
            <span>{shortId(summary.requestId)}</span>
            <span fg={theme.dim}>  ·  trace </span>
            <span>{shortId(summary.traceId)}</span>
            <span fg={theme.dim}>  ·  </span>
            <span>{formatElapsed(elapsed)}</span>
          </text>
        </box>
      </box>
      {summary.outputDir ? (
        <text fg={theme.dim}>out: {summary.outputDir}</text>
      ) : null}
    </box>
  )
}
