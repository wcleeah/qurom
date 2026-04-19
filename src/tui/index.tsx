import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { loadRuntimeConfig } from "../config"
import { ensureArtifactDir } from "../output"
import { validateRuntimePrerequisites } from "../opencode"
import { App, type SystemLogEntry } from "./App"

const config = await loadRuntimeConfig()
await ensureArtifactDir(config.quorumConfig.artifactDir)
const prerequisites = await validateRuntimePrerequisites(config)

const systemLog: SystemLogEntry[] = []
console.warn = (...a: unknown[]) => systemLog.push({ level: "warn", text: a.map(String).join(" ") })
console.error = (...a: unknown[]) => systemLog.push({ level: "error", text: a.map(String).join(" ") })

const renderer = await createCliRenderer({ exitOnCtrlC: false })
createRoot(renderer).render(<App config={config} prerequisites={prerequisites} systemLog={systemLog} />)
