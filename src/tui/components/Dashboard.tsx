import { useTerminalDimensions } from "@opentui/react"
import { useEffect, useRef, useState } from "react"
import type { RunStore } from "../state/runStore"
import { useStoreSelector } from "../state/useStore"
import { theme } from "../theme"

export interface DashboardProps {
  store: RunStore
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
  const { width } = useTerminalDimensions()
  const phase = useStoreSelector(store, (s) => s.lifecycle.phase)
  const requestId = useStoreSelector(store, (s) => s.lifecycle.requestId)
  const traceId = useStoreSelector(store, (s) => s.lifecycle.traceId)
  const outputDir = useStoreSelector(store, (s) => s.lifecycle.outputDir)
  const graphNode = useStoreSelector(store, (s) => s.graph.node)
  const graphPhase = useStoreSelector(store, (s) => s.graph.phase)
  const agents = useStoreSelector(store, (s) => s.agents)
  const round = useStoreSelector(store, (s) =>
    s.graph.state && "round" in s.graph.state ? (s.graph.state as { round?: number }).round : undefined,
  )

  const active = phase !== "complete" && phase !== "error"
  const elapsed = useElapsed(active)
  const wide = width >= 120
  const medium = width >= 95

  return (
    <box
      border
      borderStyle="single"
      borderColor={theme.borderSubtle}
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
        <text wrapMode="word">
          <span fg={phaseColor(phase)}>{phase}</span>
          <span fg={theme.textMuted}>{`  ·  round ${round ?? "-"}`}</span>
          {graphNode ? <span fg={theme.textMuted}>{`  ·  node ${graphNode}`}</span> : null}
          {graphPhase ? <span fg={theme.textMuted}>{`  ·  ${graphPhase}`}</span> : null}
          <span fg={theme.textMuted}>{`  ·  ${formatElapsed(elapsed)}`}</span>
        </text>
        {medium ? <text wrapMode="word">request {requestId ?? "-"}</text> : null}
        {medium ? <text wrapMode="word">trace   {traceId ?? "-"}</text> : null}
        {wide && outputDir ? <text wrapMode="word">output  {outputDir}</text> : null}
        <box flexDirection={wide ? "row" : "column"} gap={wide ? 2 : 0}>
          {Object.entries(agents).map(([roleKey, agent]) => (
            <text key={roleKey} wrapMode="word">
              <span fg={statusColor(agent.status)}>{statusDot(agent.status)}</span>
              <span fg={theme.textMuted}>{` ${roleLabel(roleKey)}`}</span>
              <span fg={theme.textMuted}>{`  ${agent.status}`}</span>
              {agent.activeTool ? <span fg={theme.textMuted}>{`  ·  ${agent.activeTool.tool}`}</span> : null}
              {agent.pendingPermission ? <span fg={theme.warning}>{`  ·  permission ${agent.pendingPermission}`}</span> : null}
            </text>
          ))}
        </box>
        {!wide && outputDir ? <text wrapMode="word">output  {outputDir}</text> : null}
      </box>
    </box>
  )
}
