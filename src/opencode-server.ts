import { spawn, type Subprocess } from "bun"

let child: Subprocess | undefined
let stopping = false

async function isServerReady(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/agent`, { signal: AbortSignal.timeout(1000) })
    return response.ok
  } catch {
    return false
  }
}

async function waitForServer(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await isServerReady(baseUrl)) return
    await new Promise((r) => setTimeout(r, 500))
  }

  throw new Error(`OpenCode server did not become ready within ${timeoutMs}ms on ${baseUrl}`)
}

export async function ensureOpenCodeServer(input: {
  port: number
  hostname?: string
  opencodeBin?: string
  directory?: string
  startupTimeoutMs?: number
}): Promise<() => Promise<void>> {
  const hostname = input.hostname ?? "127.0.0.1"
  const port = input.port
  const opencodeBin = input.opencodeBin ?? "opencode"
  const directory = input.directory ?? process.cwd()
  const startupTimeoutMs = input.startupTimeoutMs ?? 30_000

  const baseUrl = `http://${hostname}:${port}`

  // If already running, just return a no-op cleanup
  if (await isServerReady(baseUrl)) {
    return async () => {}
  }

  child = spawn({
    cmd: [opencodeBin, "serve", "--port", String(port), "--hostname", hostname],
    cwd: directory,
    stdout: "inherit",
    stderr: "inherit",
  })

  child.exited.then((code) => {
    if (!stopping && code !== 0) {
      console.error(`OpenCode server exited unexpectedly with code ${code}`)
    }
  })

  try {
    await waitForServer(baseUrl, startupTimeoutMs)
  } catch (error) {
    stopping = true
    child.kill()
    child = undefined
    stopping = false
    throw error
  }

  return async () => {
    if (!child) return
    stopping = true
    child.kill()
    await child.exited.catch(() => {})
    child = undefined
    stopping = false
  }
}
