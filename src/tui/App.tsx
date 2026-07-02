import { useKeyboard } from "@opentui/react"
import { useCallback, useRef, useState } from "react"
import type { RuntimeConfig } from "../config"
import { createEventBus, runResearchPipeline, runDesignPipeline, type RuntimePrerequisites, type RuntimePromptBundle } from "../runner"
import type { InputRequest } from "../schema"
import { Dashboard } from "./components/Dashboard"
import { PromptScreen } from "./components/PromptScreen"
import { SummaryScreen } from "./components/SummaryScreen"
import { bindBusToStore } from "./state/eventBindings"
import { createRunStore, type RunStore } from "./state/runStore"
import { type SystemStatusStore } from "./state/systemStatus"

export type Screen = "prompt" | "running" | "complete"

export interface AppProps {
  config: RuntimeConfig
  prerequisites: RuntimePrerequisites
  promptBundle: RuntimePromptBundle
  systemStatus: SystemStatusStore
  onExit: () => void
}

interface RunCtx {
  store: RunStore
  unbind: () => void
  ac: AbortController
  promise: Promise<unknown>
}

export const App = ({ config, prerequisites, promptBundle, systemStatus, onExit }: AppProps) => {
  const [screen, setScreen] = useState<Screen>("prompt")
  const [runCtx, setRunCtx] = useState<RunCtx | undefined>(undefined)
  const [viewUrl, setViewUrl] = useState<string | undefined>(undefined)
  const lastRequestRef = useRef<InputRequest | undefined>(undefined)

  void systemStatus

  const startRun = useCallback(
    (request: InputRequest) => {
      lastRequestRef.current = request
      const bus = createEventBus()
      const store = createRunStore()
      const binding = bindBusToStore({ bus, store })
      const ac = new AbortController()
      const promise = runResearchPipeline({ config, prerequisites, promptBundle, request, bus, signal: ac.signal })

      const ctx: RunCtx = { store, unbind: binding.unbind, ac, promise }
      setRunCtx(ctx)
      setScreen("running")

      const port = process.env.VIEW_PORT ?? "3000"
      const host = process.env.VIEW_HOST ?? "localhost"
      const offLifecycle = bus.on((event) => {
        if (event.kind === "lifecycle" && event.requestId) {
          setViewUrl(`http://${host}:${port}/runs/${event.requestId}`)
          offLifecycle()
        }
      })
      const offTerminal = bus.on((event) => {
        if (event.kind === "lifecycle" && (event.phase === "complete" || event.phase === "error")) {
          setScreen("complete")
          offTerminal()
        }
      })

      promise
        .catch(() => {})
        .finally(() => {
          binding.flushAndUnbind()
        })
    },
    [config, prerequisites, promptBundle],
  )

  const startDesign = useCallback(
    (runId: string) => {
      const bus = createEventBus()
      const store = createRunStore()
      const binding = bindBusToStore({ bus, store })
      const ac = new AbortController()
      const promise = runDesignPipeline({ config, promptBundle, runId, bus, signal: ac.signal })

      const ctx: RunCtx = { store, unbind: binding.unbind, ac, promise }
      setRunCtx(ctx)
      setScreen("running")

      const port = process.env.VIEW_PORT ?? "3000"
      const host = process.env.VIEW_HOST ?? "localhost"
      const offLifecycle = bus.on((event) => {
        if (event.kind === "lifecycle" && event.requestId) {
          setViewUrl(`http://${host}:${port}/runs/${event.requestId}`)
          offLifecycle()
        }
      })
      const offTerminal = bus.on((event) => {
        if (event.kind === "lifecycle" && (event.phase === "complete" || event.phase === "error")) {
          setScreen("complete")
          offTerminal()
        }
      })

      promise
        .catch(() => {})
        .finally(() => {
          binding.flushAndUnbind()
        })
    },
    [config, promptBundle],
  )

  const startResume = useCallback(
    (runId: string) => {
      const bus = createEventBus()
      const store = createRunStore()
      const binding = bindBusToStore({ bus, store })
      const ac = new AbortController()
      const promise = runResearchPipeline({ config, prerequisites, promptBundle, resume: { runId }, bus, signal: ac.signal })

      const ctx: RunCtx = { store, unbind: binding.unbind, ac, promise }
      setRunCtx(ctx)
      setScreen("running")

      const port = process.env.VIEW_PORT ?? "3000"
      const host = process.env.VIEW_HOST ?? "localhost"
      const offLifecycle = bus.on((event) => {
        if (event.kind === "lifecycle" && event.requestId) {
          setViewUrl(`http://${host}:${port}/runs/${event.requestId}`)
          offLifecycle()
        }
      })
      const offTerminal = bus.on((event) => {
        if (event.kind === "lifecycle" && (event.phase === "complete" || event.phase === "error")) {
          setScreen("complete")
          offTerminal()
        }
      })

      promise
        .catch(() => {})
        .finally(() => {
          binding.flushAndUnbind()
        })
    },
    [config, prerequisites, promptBundle],
  )

  const restart = useCallback(() => {
    runCtx?.unbind()
    setRunCtx(undefined)
    setViewUrl(undefined)
    setScreen("prompt")
  }, [runCtx])

  useKeyboard((key) => {
    if (key.name === "c" && key.ctrl) {
      if (screen === "running" && runCtx) {
        runCtx.ac.abort()
        void runCtx.promise.catch(() => {}).finally(onExit)
      } else {
        onExit()
      }
      return
    }
    if (screen === "complete" && key.name === "return") {
      restart()
      return
    }
  })

  if (screen === "prompt") {
    return (
      <box flexGrow={1} position="relative">
        <PromptScreen onSubmit={startRun} onResumeSubmit={startResume} onDesignSubmit={startDesign} />
      </box>
    )
  }

  if (screen === "complete" && runCtx) {
    return (
      <box flexGrow={1} position="relative">
        <SummaryScreen store={runCtx.store} viewUrl={viewUrl} />
      </box>
    )
  }

  return (
    <box flexGrow={1} position="relative">
      <Dashboard store={runCtx!.store} viewUrl={viewUrl} />
    </box>
  )
}
