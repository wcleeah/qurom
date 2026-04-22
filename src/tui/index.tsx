import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { loadRuntimeConfig } from "../config"
import { ensureArtifactDir } from "../output"
import { validateRuntimePrerequisites } from "../opencode"
import { App } from "./App"
import { copy } from "./clipboard"
import { createSystemStatusStore, pushSystemStatus } from "./state/systemStatus"

const config = await loadRuntimeConfig()
await ensureArtifactDir(config.quorumConfig.artifactDir)
const prerequisites = await validateRuntimePrerequisites(config)

const systemStatus = createSystemStatusStore()
console.warn = (...a: unknown[]) => pushSystemStatus(systemStatus, { level: "warn", text: a.map(String).join(" ") })
console.error = (...a: unknown[]) => pushSystemStatus(systemStatus, { level: "error", text: a.map(String).join(" ") })

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  useMouse: true,
  consoleOptions: {
    onCopySelection: (text) => {
      void copy(text)
        .then(() => pushSystemStatus(systemStatus, { level: "warn", text: "Copied to clipboard" }))
        .catch((error) => pushSystemStatus(systemStatus, { level: "error", text: `Copy failed: ${String(error)}` }))
    },
  },
})
const root = createRoot(renderer)

let exiting = false
const exitApp = () => {
  if (exiting) return
  exiting = true

  try {
    root.unmount()
  } finally {
    renderer.destroy()
    process.exit(0)
  }
}

root.render(<App config={config} prerequisites={prerequisites} systemStatus={systemStatus} onExit={exitApp} />)
