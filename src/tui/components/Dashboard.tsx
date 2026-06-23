import { useEffect, useRef, useState } from "react"
import type { RunStore } from "../state/runStore"
import { useStoreSelector } from "../state/useStore"
import { theme } from "../theme"

export interface DashboardProps {
  store: RunStore
  viewUrl?: string
}

const statusDot = (status: string): string => {
  if (status === "running") return "●"
  if (status === "complete") return "✓"
  if (status === "error") return "✗"
  return "○"
}

const dotColor = (status: string): string => {
  if (status === "running") return theme.status.running
  if (status === "complete") return theme.status.complete
  if (status === "error") return theme.status.error
  return theme.status.idle
}

const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

const useElapsed = (active: boolean): number => {
  const start = useRef(Date.now())
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now - start.current
}

export const Dashboard = ({ store, viewUrl }: DashboardProps) => {
  const lifecyclePhase = useStoreSelector(store, (s) => s.lifecycle.phase)
  const lifecycleError = useStoreSelector(store, (s) => s.lifecycle.error)
  const graphNode = useStoreSelector(store, (s) => s.graph.node)
  const graphState = useStoreSelector(store, (s) => s.graph.state)
  const agents = useStoreSelector(store, (s) => s.agents)

  const runActive = lifecyclePhase === "running" || lifecyclePhase === "starting"
  const elapsed = useElapsed(runActive)

  const round = (graphState && "round" in graphState && typeof graphState.round === "number")
    ? graphState.round : 0
  const maxRounds = (graphState && "maxRounds" in graphState && typeof graphState.maxRounds === "number")
    ? (graphState as { maxRounds?: number }).maxRounds : 10
  const researchStatus = (graphState && "status" in graphState) ? (graphState as { status?: string }).status : undefined
  const depthTier = (graphState && "depthTier" in graphState) ? (graphState as { depthTier?: string }).depthTier : undefined

  // Active agents: those with status not idle
  const activeAgents = Object.entries(agents)
    .filter(([, a]) => a.status !== "idle")
    .sort(([, a], [, b]) => {
      const order: Record<string, number> = { running: 0, complete: 1, error: 2, idle: 3 }
      return (order[a.status] ?? 3) - (order[b.status] ?? 3)
    })

  const errorMessage = lifecycleError instanceof Error
    ? lifecycleError.message
    : lifecycleError ? String(lifecycleError) : undefined

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1} flexGrow={1}>
      {/* Header */}
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={theme.accent}>research-qurom</text>
        {researchStatus && (
          <text fg={theme.textMuted}>
            · {researchStatus} · Round {round}/{maxRounds}
          </text>
        )}
        {graphNode && (
          <text fg={theme.status.running}>
            · {graphNode} · {formatElapsed(elapsed)}
          </text>
        )}
      </box>

      {/* Current node + agents */}
      {graphNode && activeAgents.length > 0 && (
        <box flexDirection="column" paddingLeft={2} marginTop={1} gap={0} flexShrink={0}>
          {activeAgents.map(([name, agent]) => (
            <text key={name} wrapMode="word">
              <span fg={dotColor(agent.status)}>{statusDot(agent.status)}</span>
              <span fg={theme.text}> {name}</span>
              {agent.tool && (
                <span fg={theme.tool}> · {agent.tool}</span>
              )}
            </text>
          ))}
        </box>
      )}

      {/* Depth tier (if available) */}
      {depthTier && depthTier !== "analysis" && (
        <text fg={theme.textMuted} marginTop={1} flexShrink={0}>
          depth: {depthTier}
        </text>
      )}

      {/* Error surface */}
      {errorMessage && (
        <text fg={theme.error} marginTop={1} wrapMode="word" flexShrink={0}>
          {errorMessage}
        </text>
      )}

      {/* View URL */}
      {viewUrl && (
        <text fg={theme.textMuted} marginTop={1} flexShrink={0}>
          → {viewUrl}
        </text>
      )}

      {/* Spacer */}
      <box flexGrow={1} />

      {/* Footer hint */}
      <text fg={theme.textMuted} flexShrink={0}>
        Ctrl-C: cancel run
      </text>
    </box>
  )
}
