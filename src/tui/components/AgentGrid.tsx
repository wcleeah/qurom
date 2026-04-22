import { useTerminalDimensions } from "@opentui/react"
import type { RuntimeConfig } from "../../config"
import type { RunStore } from "../state/runStore"
import { AgentPanel } from "./AgentPanel"
import { TooSmallBanner } from "./TooSmallBanner"

export interface AgentGridProps {
  store: RunStore
  config: RuntimeConfig
}

export const AgentGrid = ({ store, config }: AgentGridProps) => {
  const { width, height } = useTerminalDimensions()
  const drafter = config.quorumConfig.designatedDrafter
  const auditors = config.quorumConfig.auditors

  if (width < 60 || height < 20) {
    return <TooSmallBanner />
  }

  const renderPanel = (key: string, compact = false) => (
    <AgentPanel
      key={key}
      store={store}
      roleKey={key}
      title={key}
      isDrafter={key === drafter}
      compact={compact}
    />
  )

  if (width < 100) {
    return (
      <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1} paddingBottom={1} gap={1}>
        {renderPanel(drafter)}
        {auditors.map((auditor) => renderPanel(auditor, true))}
      </box>
    )
  }

  const railWidth = width >= 120 ? 36 : 30

  return (
    <box flexDirection="row" flexGrow={1} paddingLeft={1} paddingRight={1} paddingBottom={1} gap={1}>
      <box flexGrow={1}>{renderPanel(drafter)}</box>
      <box width={railWidth} flexDirection="column" gap={1}>
        {auditors.map((auditor) => renderPanel(auditor, true))}
      </box>
    </box>
  )
}
