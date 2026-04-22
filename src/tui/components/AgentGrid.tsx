import type { FocusRegion } from "../state/layout"
import type { ResearchState } from "../../schema"
import { useTerminalDimensions } from "@opentui/react"
import type { RuntimeConfig } from "../../config"
import type { RunStore } from "../state/runStore"
import { useStoreSelector } from "../state/useStore"
import { AgentPanel } from "./AgentPanel"
import { TooSmallBanner } from "./TooSmallBanner"

export interface AgentGridProps {
  store: RunStore
  config: RuntimeConfig
  selected: FocusRegion
  active?: FocusRegion
  onGPendingChange: (pending: boolean) => void
}

export const AgentGrid = ({ store, config, selected, active, onGPendingChange }: AgentGridProps) => {
  const { width, height } = useTerminalDimensions()
  const drafter = config.quorumConfig.designatedDrafter as Exclude<FocusRegion, "dashboard">
  const auditors = config.quorumConfig.auditors as Array<Exclude<FocusRegion, "dashboard">>
  const graphState = useStoreSelector(store, (s) => s.graph.state as ResearchState | undefined)
  const auditHeavy =
    graphState?.status === "auditing" ||
    graphState?.status === "reviewing_findings" ||
    graphState?.status === "awaiting_auditor_rebuttal" ||
    graphState?.status === "reviewing_rebuttal_responses"

  if (width < 60 || height < 20) {
    return <TooSmallBanner />
  }

  const renderPanel = (key: Exclude<FocusRegion, "dashboard">, compact = false, emphasize = false) => (
    <AgentPanel
      key={key}
      store={store}
      roleKey={key}
      title={key}
      isDrafter={key === drafter}
      compact={compact}
      emphasize={emphasize}
      selected={selected === key}
      active={active === key}
      onGPendingChange={onGPendingChange}
    />
  )

  if (width < 100) {
    return (
      <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1} paddingBottom={1} gap={1}>
        {renderPanel(drafter, false, !auditHeavy)}
        {auditors.map((auditor) => renderPanel(auditor, false, auditHeavy))}
      </box>
    )
  }

  return (
    <box flexDirection="row" flexGrow={1} paddingLeft={1} paddingRight={1} paddingBottom={1} gap={1}>
      <box width="50%" flexShrink={0} flexGrow={0}>
        {renderPanel(drafter, false, !auditHeavy)}
      </box>
      <box width="50%" flexShrink={0} flexGrow={0} flexDirection="column" gap={1}>
        {auditors.map((auditor) => renderPanel(auditor, false, auditHeavy))}
      </box>
    </box>
  )
}
