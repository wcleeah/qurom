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
  selected: string
  active?: string
  onGPendingChange: (pending: boolean) => void
}

/** Determine which agent list to show based on pipeline phase. */
function activePhase(config: RuntimeConfig, state: ResearchState | undefined): "research" | "design" {
  // If design is running, pending, or just finished, show design panels
  if (state?.designStatus === "pending" || state?.designStatus === "running") return "design"
  // If research is approved and design is enabled (about to start), show design
  if (state?.status === "approved" && config.quorumConfig.designQuorum?.enabled) return "design"
  return "research"
}

export const AgentGrid = ({ store, config, selected, active, onGPendingChange }: AgentGridProps) => {
  const { width, height } = useTerminalDimensions()
  const graphState = useStoreSelector(store, (s) => s.graph.state as ResearchState | undefined)
  const phase = activePhase(config, graphState)

  const researchDrafter = config.quorumConfig.designatedDrafter
  const researchAuditors = config.quorumConfig.auditors

  const designConfig = config.quorumConfig.designQuorum
  const designDrafter = designConfig?.designatedDesigner ?? ""
  const designAuditors = designConfig?.auditors ?? []

  const drafter = phase === "design" && designConfig ? designDrafter : researchDrafter
  const auditors = phase === "design" && designConfig ? designAuditors : researchAuditors

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
  const auditorCount = auditors.length
  const auditorBaseHeight = auditorCount > 0 ? Math.max(6, Math.floor(wideColumnHeight / auditorCount)) : wideColumnHeight
  const auditorRemainder = auditorCount > 0 ? Math.max(0, wideColumnHeight - auditorBaseHeight * auditorCount) : 0
  const auditorPanelHeights = auditors.map((_, index) => auditorBaseHeight + (index < auditorRemainder ? 1 : 0))

  const renderPanel = (key: string, compact = false, emphasize = false) => (
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
    if (drafter) {
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
    // No drafter (e.g., design not configured) — just show auditors
    if (auditors.length > 0) {
      return (
        <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1} paddingBottom={1} gap={1}>
          {auditors.map((auditor) => (
            <box key={auditor} height={stackedPanelHeight} minHeight={0} flexShrink={0}>
              {renderPanel(auditor, false, true)}
            </box>
          ))}
        </box>
      )
    }
    return null
  }

  // Wide layout
  if (!drafter && auditors.length === 0) return null

  return (
    <box flexDirection="row" flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1} paddingBottom={1} gap={1}>
      {drafter ? (
        <box width="50%" height={wideColumnHeight} minHeight={0} flexShrink={0} flexGrow={0}>
          {renderPanel(drafter, false, !auditHeavy)}
        </box>
      ) : null}
      {auditors.length > 0 ? (
        <box width={drafter ? "50%" : "100%"} height={wideColumnHeight} minHeight={0} flexShrink={0} flexGrow={0} flexDirection="column" gap={0}>
          {auditors.map((auditor, index) => (
            <box key={auditor} height={auditorPanelHeights[index]} minHeight={0} flexShrink={0}>
              {renderPanel(auditor, false, auditHeavy)}
            </box>
          ))}
        </box>
      ) : null}
    </box>
  )
}
