import { useKeyboard } from "@opentui/react"
import { useCallback, useRef, useState } from "react"
import type { RuntimeConfig } from "../config"
import { createEventBus, runQuorum, type EventBus, type RuntimePrerequisites } from "../runner"
import type { InputRequest } from "../schema"
import { PromptScreen } from "./components/PromptScreen"
import { RunningScreen } from "./components/RunningScreen"
import { SummaryScreen, type SummaryAction } from "./components/SummaryScreen"
import { bindBusToStore } from "./state/eventBindings"
import { createRunStore, type RunStore } from "./state/runStore"

export type Screen = "prompt" | "running" | "summary"

export type SystemLogEntry = { level: "warn" | "error"; text: string }

export interface AppProps {
  config: RuntimeConfig
  prerequisites: RuntimePrerequisites
  systemLog: SystemLogEntry[]
}

interface RunCtx {
  bus: EventBus
  store: RunStore
  unbind: () => void
  ac: AbortController
}

export const App = ({ config, prerequisites }: AppProps) => {
  const [screen, setScreen] = useState<Screen>("prompt")
  const [runCtx, setRunCtx] = useState<RunCtx | undefined>(undefined)
  const [focused, _setFocused] = useState<string>("dashboard")
  const lastRequestRef = useRef<InputRequest | undefined>(undefined)

  useKeyboard((key) => {
    if (key.name === "c" && key.ctrl) {
      runCtx?.ac.abort()
      process.exit(0)
    }
  })

  const startRun = useCallback(
    (request: InputRequest) => {
      lastRequestRef.current = request
      const bus = createEventBus()
      const store = createRunStore({ config })
      const unbind = bindBusToStore({ bus, store, config })
      const ac = new AbortController()
      const ctx: RunCtx = { bus, store, unbind, ac }
      setRunCtx(ctx)
      setScreen("running")

      runQuorum({ config, prerequisites, request, bus, signal: ac.signal })
        .catch((err) => {
          // Lifecycle reducer already records the error from the runner's lifecycle:error event.
          // If the rejection bypassed lifecycle (e.g. abort), surface it manually.
          const current = store.get()
          if (!current.lifecycle.error) {
            store.set({
              ...current,
              lifecycle: { ...current.lifecycle, phase: "error", error: err },
            })
          }
        })
        .finally(() => {
          unbind()
          setScreen("summary")
        })
    },
    [config, prerequisites],
  )

  const handleSummaryAction = useCallback(
    (action: SummaryAction) => {
      if (action === "quit") {
        process.exit(0)
      } else if (action === "rerun" && lastRequestRef.current) {
        startRun(lastRequestRef.current)
      } else {
        setRunCtx(undefined)
        setScreen("prompt")
      }
    },
    [startRun],
  )

  if (screen === "prompt") {
    return <PromptScreen config={config} onSubmit={startRun} />
  }
  if (screen === "running" && runCtx) {
    return <RunningScreen store={runCtx.store} config={config} focused={focused} />
  }
  if (screen === "summary" && runCtx) {
    return <SummaryScreen store={runCtx.store} onAction={handleSummaryAction} />
  }
  return (
    <box border title="research-qurom" padding={1}>
      <text>(initializing)</text>
    </box>
  )
}
