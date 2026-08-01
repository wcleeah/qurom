import { loadRuntimeConfig } from "./config"
import { resolveOpencodeBootstrap } from "./opencode-bootstrap"
import { initRunManager } from "./run-manager"
import { configureViewServer } from "./view/server-options"
import { startViewServer } from "./view/server"

configureViewServer({ admin: process.argv.includes("--admin") })
const config = await loadRuntimeConfig()
await resolveOpencodeBootstrap({ interactive: false, workspaceDir: config.env.OPENCODE_DIRECTORY })

initRunManager({ getConfig: loadRuntimeConfig })

const SHUTDOWN_TIMEOUT_MS = Number(process.env.QUORUM_SHUTDOWN_TIMEOUT_MS ?? 20_000)

let shuttingDown = false
const shutdown = async (signal: string) => {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Received ${signal}; shutting down (timeout ${SHUTDOWN_TIMEOUT_MS}ms)...`)
  const { getRunManager } = await import("./run-manager")
  const force = setTimeout(() => {
    console.error("Shutdown timed out; forcing exit")
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  force.unref?.()
  try {
    await getRunManager().shutdown()
  } catch (error) {
    console.error("Shutdown error:", error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(force)
    process.exit(0)
  }
}

process.on("SIGINT", () => { void shutdown("SIGINT") })
process.on("SIGTERM", () => { void shutdown("SIGTERM") })

startViewServer()
