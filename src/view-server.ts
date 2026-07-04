import { loadRuntimeConfig } from "./config"
import { resolveOpencodeBootstrap } from "./opencode-bootstrap"
import { configureViewServer } from "./view/server-options"
import { startViewServer } from "./view/server"

configureViewServer({ admin: process.argv.includes("--admin") })
const config = await loadRuntimeConfig()
await resolveOpencodeBootstrap({ interactive: false, workspaceDir: config.env.OPENCODE_DIRECTORY })
startViewServer()
