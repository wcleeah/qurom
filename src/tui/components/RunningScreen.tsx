import type { RunStore } from "../state/runStore"
import type { SystemStatusStore } from "../state/systemStatus"
import { theme } from "../theme"
import { Dashboard } from "./Dashboard"
import { SystemStatusSurface } from "./SystemStatusSurface"

export interface RunningScreenProps {
  store: RunStore
  systemStatus: SystemStatusStore
  viewUrl?: string
}

export const RunningScreen = ({ store, systemStatus, viewUrl }: RunningScreenProps) => (
  <box flexDirection="column" flexGrow={1} position="relative" backgroundColor={theme.background}>
    <Dashboard store={store} viewUrl={viewUrl} />
    <SystemStatusSurface store={store} systemStatus={systemStatus} />
  </box>
)
