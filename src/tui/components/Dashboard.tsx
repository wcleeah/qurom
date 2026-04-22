import { useEffect, useRef, useState } from "react"
import type { RunStore } from "../state/runStore"
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

export const Dashboard = ({ store }: DashboardProps) => {
  const phase = useStoreSelector(store, (s) => s.lifecycle.phase)
  const requestId = useStoreSelector(store, (s) => s.lifecycle.requestId)
  const traceId = useStoreSelector(store, (s) => s.lifecycle.traceId)
  const outputDir = useStoreSelector(store, (s) => s.lifecycle.outputDir)
  const graphNode = useStoreSelector(store, (s) => s.graph.node)
  const round = useStoreSelector(store, (s) =>
    s.graph.state && "round" in s.graph.state ? (s.graph.state as { round?: number }).round : undefined,
  )

  const active = phase !== "complete" && phase !== "error"
  const elapsed = useElapsed(active)

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" alignItems="center" gap={2}>
        <ascii-font font="tiny" text="QUORUM" />
        <box flexDirection="column">
          <text>
            <span fg={theme.accent}>{phase}</span>
            <span fg={theme.dim}>  ·  node </span>
            <span>{graphNode ?? "-"}</span>
            <span fg={theme.dim}>  ·  round </span>
            <span>{round ?? "-"}</span>
          </text>
          <text>
            <span fg={theme.dim}>req </span>
            <span>{shortId(requestId)}</span>
            <span fg={theme.dim}>  ·  trace </span>
            <span>{shortId(traceId)}</span>
            <span fg={theme.dim}>  ·  </span>
            <span>{formatElapsed(elapsed)}</span>
          </text>
        </box>
      </box>
      {outputDir ? (
        <text fg={theme.dim}>out: {outputDir}</text>
      ) : null}
    </box>
  )
}
