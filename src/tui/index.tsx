import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { loadRuntimeConfig } from "../config"
import { ensureArtifactDir } from "../output"
import { prepareConfiguredProviders, validateProviderPrerequisites } from "../providers/registry"
import { loadPromptBundle } from "../prompt-assets"
import { App } from "./App"
import { createSystemStatusStore, pushSystemStatus } from "./state/systemStatus"

const config = await loadRuntimeConfig()

const stopProviders = await prepareConfiguredProviders(config)

await ensureArtifactDir(config.quorumConfig.artifactDir)
const prerequisites = await validateProviderPrerequisites(config)
const promptBundle = await loadPromptBundle(config)

const systemStatus = createSystemStatusStore()
console.warn = (...a: unknown[]) => pushSystemStatus(systemStatus, { level: "warn", text: a.map(String).join(" ") })
console.error = (...a: unknown[]) => pushSystemStatus(systemStatus, { level: "error", text: a.map(String).join(" ") })

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  useMouse: true,
})
const root = createRoot(renderer)

let exiting = false
const exitApp = async () => {
  if (exiting) return
  exiting = true

  try {
    root.unmount()
  } finally {
    renderer.destroy()
    await stopProviders().catch(() => {})
    process.exit(0)
  }
}

root.render(
  <App
    config={config}
    prerequisites={prerequisites}
    promptBundle={promptBundle}
    systemStatus={systemStatus}
    onExit={exitApp}
  />,
)
