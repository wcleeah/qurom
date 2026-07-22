import { spawn, type Subprocess } from "bun"
import { mkdir } from "node:fs/promises"
import { createWriteStream } from "node:fs"
import { join } from "node:path"
import { connect } from "node:net"

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

async function isPortOccupied(hostname: string, port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = connect({ host: hostname, port })
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
    socket.setTimeout(1000, () => {
      socket.destroy()
      resolve(false)
    })
  })
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
  configContent: string
}): Promise<() => Promise<void>> {
  const hostname = input.hostname ?? "127.0.0.1"
  const port = input.port
  const opencodeBin = input.opencodeBin ?? "opencode"
  const directory = input.directory ?? process.cwd()
  const startupTimeoutMs = input.startupTimeoutMs ?? 30_000

  const baseUrl = `http://${hostname}:${port}`

  if (await isPortOccupied(hostname, port)) {
    throw new Error(`OpenCode port ${hostname}:${port} is already occupied; Qurom requires the OpenCode server it launches and configures`)
  }

  // Capture stderr to runs/opencode-stderr.log so server stack traces
  // don't pollute the TUI terminal.
  const stderrLogDir = join(directory, "runs")
  await mkdir(stderrLogDir, { recursive: true })
  const stderrLog = createWriteStream(join(stderrLogDir, "opencode-stderr.log"), { flags: "a" })

  child = spawn({
    cmd: [opencodeBin, "serve", "--port", String(port), "--hostname", hostname],
    cwd: directory,
    stdout: "inherit",
    stderr: "pipe",
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: input.configContent },
  })

  // Pipe child's stderr to the log file (and discard so it doesn't fill memory)
  const stderrReadable = child.stderr as ReadableStream<Uint8Array>
  const writer = stderrReadable.pipeTo(
    new WritableStream({
      write(chunk) {
        stderrLog.write(chunk)
      },
    }),
  ).catch(() => {})

  child.exited.then((code) => {
    writer.then(() => stderrLog.end())
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
    writer.then(() => stderrLog.end())
    child = undefined
    stopping = false
  }
}
