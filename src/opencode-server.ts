import { spawn, type Subprocess } from "bun"

let child: Subprocess | undefined
let stopping = false

async function isServerReady(hostname: string, port: number): Promise<boolean> {
  try {
    const socket = await Bun.connect({ hostname, port })
    socket.end()
    return true
  } catch {
    return false
  }
}

async function waitForServer(hostname: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await isServerReady(hostname, port)) return
    await new Promise((r) => setTimeout(r, 300))
  }

  throw new Error(`OpenCode server did not become ready within ${timeoutMs}ms on ${hostname}:${port}`)
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
  const startupTimeoutMs = input.startupTimeoutMs ?? 15_000

  // If already running, just return a no-op cleanup
  if (await isServerReady(hostname, port)) {
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
    await waitForServer(hostname, port, startupTimeoutMs)
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
