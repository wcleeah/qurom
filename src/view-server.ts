import { loadRuntimeConfig } from "./config"
import { resolveOpencodeBootstrap } from "./opencode-bootstrap"
import { initRunManager } from "./run-manager"
import { configureViewServer } from "./view/server-options"
import { startViewServer } from "./view/server"

configureViewServer({ admin: process.argv.includes("--admin") })
const config = await loadRuntimeConfig()
await resolveOpencodeBootstrap({ interactive: false, workspaceDir: config.env.OPENCODE_DIRECTORY })

initRunManager({ getConfig: () => config })

const shutdown = async () => {
  const { getRunManager } = await import("./run-manager")
  await getRunManager().shutdown().catch(() => {})
  process.exit(0)
}

process.on("SIGINT", () => { void shutdown() })
process.on("SIGTERM", () => { void shutdown() })

startViewServer()
