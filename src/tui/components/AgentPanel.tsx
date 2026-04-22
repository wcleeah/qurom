import type { AgentState, RunStore, ScrollbackEntry } from "../state/runStore"
import { useStoreSelector } from "../state/useStore"
import { theme } from "../theme"

export interface AgentPanelProps {
  store: RunStore
  roleKey: string
  title: string
  isDrafter: boolean
  focused: boolean
}

const statusDot = (status: AgentState["status"]): string => {
  if (status === "running") return "●"
  if (status === "complete") return "✓"
  if (status === "error") return "✗"
  return "○"
}

const statusColor = (status: AgentState["status"]): string => {
  if (status === "running") return theme.status.running
  if (status === "complete") return theme.status.complete
  if (status === "error") return theme.status.error
  return theme.status.idle
}

const kindColor = (kind: ScrollbackEntry["kind"]): string => {
  if (kind === "tool") return theme.tool
  if (kind === "permission") return theme.permission
  if (kind === "system") return theme.system
  return theme.reasoning
}

const PanelScrollback = ({ store, roleKey, focused }: { store: RunStore; roleKey: string; focused: boolean }) => {
  const scrollback = useStoreSelector(store, (s) => s.agents[roleKey]?.scrollback ?? [])
  return (
    <scrollbox focused={focused} flexGrow={1}>
      {scrollback.map((entry, i) => (
        <text key={i} fg={kindColor(entry.kind)}>
          {`> ${entry.text}`}
        </text>
      ))}
    </scrollbox>
  )
}

export const AgentPanel = ({ store, roleKey, title, isDrafter, focused }: AgentPanelProps) => {
  const header = useStoreSelector(store, (s) => {
    const agent = s.agents[roleKey]
    return {
      exists: agent !== undefined,
      status: agent?.status ?? "idle",
      activeTool: agent?.activeTool?.tool,
    }
  })

  if (!header.exists) {
    return (
      <box border title={title} borderStyle="single" flexGrow={1}>
        <text fg={theme.dim}>(no agent slot)</text>
      </box>
    )
  }
  const borderColor = isDrafter ? theme.drafterColor : theme.panel
  const borderStyle = isDrafter ? "double" : "single"

  return (
    <box
      border
      title={title}
      borderStyle={borderStyle}
      borderColor={borderColor}
      flexGrow={1}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row" gap={1}>
        <text fg={statusColor(header.status)}>{statusDot(header.status)}</text>
        <text>{header.activeTool ?? "-"}</text>
        {focused ? <text fg={theme.accent}>[focus]</text> : null}
      </box>
      <PanelScrollback store={store} roleKey={roleKey} focused={focused} />
    </box>
  )
}
