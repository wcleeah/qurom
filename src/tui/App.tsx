import { useKeyboard, useRenderer } from "@opentui/react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { RuntimeConfig } from "../config"
import { createEventBus, runQuorum, type EventBus, type RuntimePrerequisites } from "../runner"
import type { InputRequest } from "../schema"
import { copy } from "./clipboard"
import { HelpOverlay } from "./components/HelpOverlay"
import { Footer } from "./components/Footer"
import { PromptScreen } from "./components/PromptScreen"
import { QuitConfirm } from "./components/QuitConfirm"
import { RunningScreen } from "./components/RunningScreen"
import { SummaryScreen, type SummaryAction } from "./components/SummaryScreen"
import { nextFocus } from "./keymap/gridNav"
import { computeLayout, type FocusRegion } from "./state/layout"
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
  promise: Promise<unknown>
}

export const App = ({ config, prerequisites, systemStatus, onExit }: AppProps) => {
  const renderer = useRenderer()
  const [screen, setScreen] = useState<Screen>("prompt")
  const [runCtx, setRunCtx] = useState<RunCtx | undefined>(undefined)
  const [focused, setFocused] = useState<FocusRegion>("dashboard")
  const [showHelp, setShowHelp] = useState(false)
  const [pendingForceQuit, setPendingForceQuit] = useState(false)
  const [gPending, setGPending] = useState(false)
  const lastRequestRef = useRef<InputRequest | undefined>(undefined)
  const width = renderer.width
  const layout = computeLayout(width, [
    "dashboard",
    "research-drafter",
    "source-auditor",
    "logic-auditor",
    "clarity-auditor",
  ])

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
    if (showHelp) {
      if (key.shift && key.name === "/") setShowHelp(false)
      return
    }

    if (pendingForceQuit) {
      if (key.name === "n" || key.name === "escape") setPendingForceQuit(false)
      return
    }

    if (key.name === "y") {
      const text = renderer.getSelection()?.getSelectedText()
      if (!text) return
      void copy(text)
        .then(() => renderer.clearSelection())
        .catch(() => {})
      return
    }

    if (screen === "prompt") {
      if (key.name === "q") onExit()
      return
    }

    if (screen === "summary") {
      if (key.name === "q") onExit()
      return
    }

    if (key.name === "c" && key.ctrl) {
      if (!runCtx) return onExit()
      runCtx.ac.abort()
      void runCtx.promise.finally(onExit)
      return
    }

    if (key.shift && key.name === "/") {
      setShowHelp(true)
      return
    }

    if (key.shift && key.name === "q") {
      setPendingForceQuit(true)
      return
    }

    if (key.name === "q") return

    if (key.name === "escape") {
      setFocused("dashboard")
      setGPending(false)
      return
    }

    if (key.name === "tab") {
      const next = nextFocus(focused, key.shift ? "shift-tab" : "tab", layout)
      if (next) setFocused(next)
      return
    }

    if (focused === "dashboard" || key.name === "h" || key.name === "j" || key.name === "k" || key.name === "l") {
      const next = nextFocus(focused, key.name as "h" | "j" | "k" | "l", layout)
      if (next) {
        setFocused(next)
        setGPending(false)
      }
    }
  })

  const startRun = useCallback(
    (request: InputRequest) => {
      lastRequestRef.current = request
      const bus = createEventBus()
      const store = createRunStore({ config })
      const unbind = bindBusToStore({ bus, store, config })
      const ac = new AbortController()
      const promise = runQuorum({ config, prerequisites, request, bus, signal: ac.signal })
      const ctx: RunCtx = { bus, store, unbind, ac, promise }
      setRunCtx(ctx)
      setFocused("dashboard")
      setShowHelp(false)
      setPendingForceQuit(false)
      setGPending(false)
      setScreen("running")

      promise
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
    return (
      <box flexGrow={1} position="relative">
        <PromptScreen config={config} onSubmit={startRun} />
        <Footer screen="prompt" />
      </box>
    )
  }
  if (screen === "running" && runCtx) {
    return (
      <box flexGrow={1} position="relative">
        <RunningScreen
          store={runCtx.store}
          config={config}
          systemStatus={systemStatus}
          focused={focused}
          gPending={gPending}
          onGPendingChange={setGPending}
        />
        {showHelp ? <HelpOverlay /> : null}
        {pendingForceQuit ? <QuitConfirm onYes={onExit} onNo={() => setPendingForceQuit(false)} /> : null}
      </box>
    )
  }
  if (screen === "summary" && runCtx) {
    return (
      <box flexGrow={1} position="relative">
        <SummaryScreen store={runCtx.store} onAction={handleSummaryAction} />
        <Footer screen="summary" />
      </box>
    )
  }
  return (
    <box border title="research-qurom" padding={1}>
      <text>(initializing)</text>
    </box>
  )
}
