import { useTerminalDimensions } from "@opentui/react"
import type { RuntimeConfig } from "../../config"
import type { RunStore } from "../state/runStore"
import { AgentPanel } from "./AgentPanel"
import { TooSmallBanner } from "./TooSmallBanner"

export interface AgentGridProps {
  store: RunStore
  config: RuntimeConfig
  focused: string
}

export const AgentGrid = ({ store, config, focused }: AgentGridProps) => {
  const { width, height } = useTerminalDimensions()
  const drafter = config.quorumConfig.designatedDrafter
  const slots = [drafter, ...config.quorumConfig.auditors]

  if (width < 60 || height < 20) {
    return <TooSmallBanner />
  }

  const renderPanel = (key: string) => (
    <AgentPanel
      key={key}
      store={store}
      roleKey={key}
      title={key}
      isDrafter={key === drafter}
      focused={focused === key}
    />
  )

  if (width < 100) {
    return (
      <box flexDirection="column" flexGrow={1}>
        {slots.map(renderPanel)}
      </box>
    )
  }

  // 2x2 grid for the live N=3 path; for arbitrary N use ceil(sqrt(1+N)) columns.
  const cols = slots.length === 4 ? 2 : Math.max(1, Math.ceil(Math.sqrt(slots.length)))
  const rows: string[][] = []
  for (let i = 0; i < slots.length; i += cols) {
    rows.push(slots.slice(i, i + cols))
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      {rows.map((row, ri) => (
        <box key={ri} flexDirection="row" flexGrow={1}>
          {row.map(renderPanel)}
        </box>
      ))}
    </box>
  )
}
