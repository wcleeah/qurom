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
  focused: FocusRegion
  onGPendingChange: (pending: boolean) => void
}

export const AgentGrid = ({ store, config, focused, onGPendingChange }: AgentGridProps) => {
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
      focused={focused === key}
      onGPendingChange={onGPendingChange}
    />
  )

  if (width < 100) {
    return (
      <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1} paddingBottom={1} gap={1}>
        {renderPanel(drafter)}
        {auditors.map((auditor) => renderPanel(auditor, !auditHeavy, auditHeavy))}
      </box>
    )
  }

  const railWidth = auditHeavy ? (width >= 130 ? 48 : 40) : width >= 120 ? 36 : 30

  return (
    <box flexDirection="row" flexGrow={1} paddingLeft={1} paddingRight={1} paddingBottom={1} gap={1}>
      <box flexGrow={1}>{renderPanel(drafter)}</box>
      <box width={railWidth} flexDirection="column" gap={1}>
        {auditors.map((auditor) => renderPanel(auditor, !auditHeavy, auditHeavy))}
      </box>
    </box>
  )
}
