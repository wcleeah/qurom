import { useKeyboard, useRenderer } from "@opentui/react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { RuntimeConfig } from "../config"
import { createEventBus, runQuorum, type EventBus, type RuntimePrerequisites } from "../runner"
import type { InputRequest } from "../schema"
import { copy } from "./clipboard"
import { PromptScreen } from "./components/PromptScreen"
import { RunningScreen } from "./components/RunningScreen"
import { SummaryScreen, type SummaryAction } from "./components/SummaryScreen"
import { bindBusToStore } from "./state/eventBindings"
import { createRunStore, type RunStore } from "./state/runStore"
import type { SystemStatusStore } from "./state/systemStatus"

export type Screen = "prompt" | "running" | "summary"

export interface AppProps {
  config: RuntimeConfig
  prerequisites: RuntimePrerequisites
  systemStatus: SystemStatusStore
  onExit: () => void
}

interface RunCtx {
  bus: EventBus
  store: RunStore
  unbind: () => void
  ac: AbortController
}

export const App = ({ config, prerequisites, systemStatus, onExit }: AppProps) => {
  const renderer = useRenderer()
  const [screen, setScreen] = useState<Screen>("prompt")
  const [runCtx, setRunCtx] = useState<RunCtx | undefined>(undefined)
  const lastRequestRef = useRef<InputRequest | undefined>(undefined)

  useEffect(() => {
    const onSelection = (selection: { getSelectedText: () => string; isDragging?: boolean } | null) => {
      if (!selection || selection.isDragging) return
      const text = selection.getSelectedText()
      if (!text) return
      void copy(text)
        .then(() => renderer.clearSelection())
        .catch(() => {})
    }

    renderer.on("selection", onSelection)
    return () => {
      renderer.off("selection", onSelection)
    }
  }, [renderer])

  useKeyboard((key) => {
    if (key.name === "y") {
      const text = renderer.getSelection()?.getSelectedText()
      if (!text) return
      void copy(text)
        .then(() => renderer.clearSelection())
        .catch(() => {})
      return
    }

    if (key.name === "c" && key.ctrl) {
      runCtx?.ac.abort()
      onExit()
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
          const current = store.getState()
          if (!current.lifecycle.error) {
            store.setState({
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
        onExit()
      } else if (action === "rerun" && lastRequestRef.current) {
        startRun(lastRequestRef.current)
      } else {
        setRunCtx(undefined)
        setScreen("prompt")
      }
    },
    [onExit, startRun],
  )

  if (screen === "prompt") {
    return <PromptScreen config={config} onSubmit={startRun} />
  }
  if (screen === "running" && runCtx) {
    return <RunningScreen store={runCtx.store} config={config} systemStatus={systemStatus} />
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
