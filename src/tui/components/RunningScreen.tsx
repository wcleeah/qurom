import type { RuntimeConfig } from "../../config"
import type { RunStore } from "../state/runStore"
import { AgentGrid } from "./AgentGrid"
import { Dashboard } from "./Dashboard"
import { Footer } from "./Footer"

export interface RunningScreenProps {
  store: RunStore
  config: RuntimeConfig
  focused: string
}

export const RunningScreen = ({ store, config, focused }: RunningScreenProps) => (
  <box flexDirection="column" flexGrow={1}>
    <Dashboard store={store} />
    <AgentGrid store={store} config={config} focused={focused} />
    <Footer />
  </box>
)
