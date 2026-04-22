import type { FocusRegion } from "../state/layout"
import type { RuntimeConfig } from "../../config"
import { TMUX_TOP_INSET } from "../layout"
import type { RunStore } from "../state/runStore"
import type { SystemStatusStore } from "../state/systemStatus"
import { theme } from "../theme"
import { AgentGrid } from "./AgentGrid"
import { Dashboard } from "./Dashboard"
import { SystemStatusSurface } from "./SystemStatusSurface"

export interface RunningScreenProps {
  store: RunStore
  config: RuntimeConfig
  systemStatus: SystemStatusStore
  selected: FocusRegion
  active?: FocusRegion
  gPending?: boolean
  onGPendingChange: (pending: boolean) => void
}

export const RunningScreen = ({ store, config, systemStatus, selected, active, onGPendingChange }: RunningScreenProps) => (
  <box flexDirection="column" flexGrow={1} position="relative" backgroundColor={theme.background} gap={1}>
    {TMUX_TOP_INSET > 0 ? <box height={TMUX_TOP_INSET} flexShrink={0} /> : null}
    <Dashboard store={store} selected={selected === "dashboard"} active={active === "dashboard"} />
    <AgentGrid store={store} config={config} selected={selected} active={active} onGPendingChange={onGPendingChange} />
    <SystemStatusSurface store={store} systemStatus={systemStatus} />
  </box>
)
