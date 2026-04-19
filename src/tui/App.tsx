import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import type { RuntimeConfig } from "../config"
import type { RuntimePrerequisites } from "../runner"

export type Screen = "prompt" | "running" | "summary"

export type SystemLogEntry = { level: "warn" | "error"; text: string }

export interface AppProps {
  config: RuntimeConfig
  prerequisites: RuntimePrerequisites
  systemLog: SystemLogEntry[]
}

export const App = (_props: AppProps) => {
  const [screen, _setScreen] = useState<Screen>("prompt")

  useKeyboard((key) => {
    if (key.name === "c" && key.ctrl) process.exit(0)
  })

  return (
    <box border title={`research-qurom — ${screen}`} padding={1}>
      <text>Phase 05 placeholder. Press Ctrl+C to exit.</text>
    </box>
  )
}
