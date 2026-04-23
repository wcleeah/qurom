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

  const availableHeight = Math.max(8, height - 10)
  const stackedPanelHeight = Math.max(6, Math.floor((availableHeight - 3) / 4))
  const wideColumnHeight = Math.max(12, availableHeight)
  const auditorBaseHeight = Math.max(6, Math.floor(wideColumnHeight / 3))
  const auditorRemainder = Math.max(0, wideColumnHeight - auditorBaseHeight * 3)
  const auditorPanelHeights = auditors.map((_, index) => auditorBaseHeight + (index < auditorRemainder ? 1 : 0))

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
        <box height={stackedPanelHeight} minHeight={0} flexShrink={0}>
          {renderPanel(drafter, false, !auditHeavy)}
        </box>
        {auditors.map((auditor) => (
          <box key={auditor} height={stackedPanelHeight} minHeight={0} flexShrink={0}>
            {renderPanel(auditor, false, auditHeavy)}
          </box>
        ))}
      </box>
    )
  }

  return (
    <box flexDirection="row" flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1} paddingBottom={1} gap={1}>
      <box width="50%" height={wideColumnHeight} minHeight={0} flexShrink={0} flexGrow={0}>
        {renderPanel(drafter, false, !auditHeavy)}
      </box>
      <box width="50%" height={wideColumnHeight} minHeight={0} flexShrink={0} flexGrow={0} flexDirection="column" gap={0}>
        {auditors.map((auditor, index) => (
          <box key={auditor} height={auditorPanelHeights[index]} minHeight={0} flexShrink={0}>
            {renderPanel(auditor, false, auditHeavy)}
          </box>
        ))}
      </box>
    </box>
  )
}
