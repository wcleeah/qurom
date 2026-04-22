import { useKeyboard, useRenderer } from "@opentui/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { readFile } from "node:fs/promises"
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
import { openInEditor } from "./editor"
import { nextFocus } from "./keymap/gridNav"
import { computeLayout, type FocusRegion } from "./state/layout"
import { bindBusToStore } from "./state/eventBindings"
import { createRunStore, type RunStore, type RunStoreInitialState } from "./state/runStore"
import type { SystemStatusStore } from "./state/systemStatus"

export type Screen = "prompt" | "running" | "summary"

export interface AppProps {
  config: RuntimeConfig
  prerequisites: RuntimePrerequisites
  systemStatus: SystemStatusStore
  onExit: () => void
}

type PromptState = {
  mode: "topic" | "document"
  topic?: string
  document?: { path: string; content: string }
  hint?: string
}

interface RunCtx {
  bus: EventBus
  store: RunStore
  unbind: () => void
  ac: AbortController
  promise: Promise<unknown>
}

function buildAgentInitialState(prerequisites: RuntimePrerequisites, config: RuntimeConfig): RunStoreInitialState["agents"] {
  const byName = new Map(prerequisites.agents.map((agent) => [agent.name, agent]))

  return Object.fromEntries(
    [config.quorumConfig.designatedDrafter, ...config.quorumConfig.auditors].map((name) => [
      name,
      {
        model: byName.get(name)?.model?.modelID,
      },
    ]),
  )
}

export const App = ({ config, prerequisites, systemStatus, onExit }: AppProps) => {
  const renderer = useRenderer()
  const [screen, setScreen] = useState<Screen>("prompt")
  const [runCtx, setRunCtx] = useState<RunCtx | undefined>(undefined)
  const [focused, setFocused] = useState<FocusRegion>("dashboard")
  const [showHelp, setShowHelp] = useState(false)
  const [pendingForceQuit, setPendingForceQuit] = useState(false)
  const [gPending, setGPending] = useState(false)
  const [promptState, setPromptState] = useState<PromptState>({ mode: "topic", topic: "", hint: "" })
  const lastRequestRef = useRef<InputRequest | undefined>(undefined)
  const initialAgents = useRef(buildAgentInitialState(prerequisites, config))
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

    const navKey = key.name as "h" | "j" | "k" | "l"
    const shouldHandleNav =
      focused === "dashboard" ? navKey === "h" || navKey === "j" || navKey === "k" || navKey === "l" : navKey === "h" || navKey === "l"

    if (shouldHandleNav) {
      const next = nextFocus(focused, navKey, layout)
      if (next) {
        setFocused(next)
        setGPending(false)
      }
    }
  })

  const startRun = useCallback(
    (request: InputRequest) => {
      lastRequestRef.current = request
      setPromptState({
        mode: request.inputMode,
        topic: request.inputMode === "topic" ? request.topic : "",
        document:
          request.inputMode === "document"
            ? { path: request.documentPath, content: request.documentText ?? promptState.document?.content ?? "" }
            : undefined,
        hint: "",
      })
      const bus = createEventBus()
      const store = createRunStore({ config, initial: { agents: initialAgents.current } })
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
    [config, prerequisites, promptState.document?.content],
  )

  const handleRerun = useCallback(async () => {
    const lastRequest = lastRequestRef.current
    if (!lastRequest) return

    if (lastRequest.inputMode === "document") {
      const path = lastRequest.documentPath
      let content = lastRequest.documentText ?? promptState.document?.content ?? ""
      let hint = ""
      try {
        const fresh = await readFile(path, "utf8")
        if (fresh.trim().length > 0) {
          content = fresh
        } else {
          hint = "draft empty on disk — using cached document"
        }
      } catch {
        hint = "draft missing on disk — using cached document"
      }

      setPromptState({ mode: "document", document: { path, content }, hint })
      startRun({ inputMode: "document", documentPath: path, documentText: content })
      return
    }

    startRun(lastRequest)
  }, [promptState.document?.content, startRun])

  const handleNewTopic = useCallback(() => {
    setRunCtx(undefined)
    setPromptState({ mode: "topic", topic: "", document: undefined, hint: "" })
    setScreen("prompt")
  }, [])

  const handleNewDocument = useCallback(async () => {
    setRunCtx(undefined)
    setScreen("prompt")
    const requestId = crypto.randomUUID()
    const result = await openInEditor({
      requestId,
      renderer,
      artifactRoot: config.quorumConfig.artifactDir,
    })

    if (result.ok) {
      setPromptState({ mode: "document", document: { path: result.path, content: result.content }, hint: "" })
      return
    }

    if (result.reason === "empty") {
      setPromptState({ mode: "document", document: undefined, hint: "(empty — nothing saved)" })
      return
    }

    if (result.reason === "cancelled") {
      setPromptState({ mode: "document", document: undefined, hint: "(cancelled)" })
      return
    }

    setPromptState({ mode: "document", document: undefined, hint: `(editor exit ${result.code ?? "?"})` })
  }, [config.quorumConfig.artifactDir, renderer])

  const handleSummaryAction = useCallback(
    (action: SummaryAction) => {
      if (action === "quit") {
        onExit()
      } else if (action === "rerun") {
        void handleRerun()
      } else if (action === "new-topic") {
        handleNewTopic()
      } else if (action === "new-document") {
        void handleNewDocument()
      } else {
        setRunCtx(undefined)
        setScreen("prompt")
      }
    },
    [handleNewDocument, handleNewTopic, handleRerun, onExit],
  )

  if (screen === "prompt") {
    return (
      <box flexGrow={1} position="relative">
        <PromptScreen
          config={config}
          onSubmit={startRun}
          initialMode={promptState.mode}
          initialTopic={promptState.topic}
          initialDocument={promptState.document}
          initialHint={promptState.hint}
        />
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
