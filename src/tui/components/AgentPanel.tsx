import type { AgentState, RunStore, ScrollbackEntry } from "../state/runStore"
import { useStoreSelector } from "../state/useStore"
import { theme } from "../theme"

export interface AgentPanelProps {
  store: RunStore
  roleKey: string
  title: string
  isDrafter: boolean
  compact?: boolean
  emphasize?: boolean
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

const roleColor = (isDrafter: boolean): string => {
  if (isDrafter) return theme.drafter.labelColor
  return theme.text
}

const PanelScrollback = ({ store, roleKey }: { store: RunStore; roleKey: string }) => {
  const scrollback = useStoreSelector(store, (s) => s.agents[roleKey]?.scrollback ?? [])
  if (scrollback.length === 0) {
    return (
      <box flexGrow={1} paddingTop={1}>
        <text fg={theme.textMuted} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
          (waiting for activity)
        </text>
      </box>
    )
  }

  return (
    <scrollbox
      flexGrow={1}
      stickyScroll
      stickyStart="bottom"
      verticalScrollbarOptions={{
        trackOptions: {
          backgroundColor: theme.backgroundElement,
          foregroundColor: theme.borderSubtle,
        },
      }}
    >
      {scrollback.map((entry, i) => (
        <text
          key={i}
          fg={kindColor(entry.kind)}
          wrapMode="word"
          selectionBg={theme.selectionBg}
          selectionFg={theme.selectionFg}
        >
          {`> ${entry.text}`}
        </text>
      ))}
    </scrollbox>
  )
}

export const AgentPanel = ({ store, roleKey, title, isDrafter, compact = false, emphasize = false }: AgentPanelProps) => {
  const agent = useStoreSelector(store, (s) => s.agents[roleKey])

  if (!agent) {
    return (
      <box
        border
        borderStyle="single"
        borderColor={theme.borderSubtle}
        backgroundColor={theme.backgroundPanel}
        flexGrow={1}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={theme.textMuted}>(no agent slot)</text>
      </box>
    )
  }

  const borderColor = isDrafter ? theme.drafter.borderColor : theme.auditor.borderColor
  const borderStyle = isDrafter ? theme.drafter.borderStyle : theme.auditor.borderStyle
  const toolLabel = agent.activeTool?.tool

  return (
    <box
      border
      borderStyle={borderStyle}
      borderColor={borderColor}
      backgroundColor={isDrafter || emphasize ? theme.backgroundPanel : compact ? theme.backgroundElement : theme.backgroundPanel}
      flexGrow={1}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
    >
      <box flexDirection="row" gap={1}>
        <text fg={roleColor(isDrafter)} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
          {title}
        </text>
        <text fg={statusColor(agent.status)} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
          {`${statusDot(agent.status)} ${agent.status}`}
        </text>
      </box>
      {toolLabel ? (
        <text fg={theme.textMuted} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
          {toolLabel}
        </text>
      ) : null}
      {agent.pendingPermission ? (
        <text fg={theme.accent} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
          permission: {agent.pendingPermission}
        </text>
      ) : null}
      <PanelScrollback store={store} roleKey={roleKey} />
    </box>
  )
}
