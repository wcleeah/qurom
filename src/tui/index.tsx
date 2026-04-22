import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { loadRuntimeConfig } from "../config"
import { ensureArtifactDir } from "../output"
import { validateRuntimePrerequisites } from "../opencode"
import { App } from "./App"
import { createSystemStatusStore, pushSystemStatus } from "./state/systemStatus"

const config = await loadRuntimeConfig()
await ensureArtifactDir(config.quorumConfig.artifactDir)
const prerequisites = await validateRuntimePrerequisites(config)

const systemStatus = createSystemStatusStore()
console.warn = (...a: unknown[]) => pushSystemStatus(systemStatus, { level: "warn", text: a.map(String).join(" ") })
console.error = (...a: unknown[]) => pushSystemStatus(systemStatus, { level: "error", text: a.map(String).join(" ") })

const renderer = await createCliRenderer({ exitOnCtrlC: false })
createRoot(renderer).render(<App config={config} prerequisites={prerequisites} systemStatus={systemStatus} />)
