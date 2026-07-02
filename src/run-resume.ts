import { readdir, stat } from "node:fs/promises"
import { join, resolve } from "node:path"

import { inputRequestSchema, type InputRequest } from "./schema"

export type ResolvedRun = {
  runDir: string
  requestId: string
  request: InputRequest
}

async function isDirectory(path: string) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export async function resolveRunDirectory(runId: string, runsRoot = resolve(process.cwd(), "runs")) {
  if (await isDirectory(runId)) return runId

  const direct = join(runsRoot, runId)
  if (await isDirectory(direct)) return direct

  const dirs = await readdir(runsRoot)
  const match = dirs.find((dir) => dir.includes(runId))
  if (!match) throw new Error(`No run directory found matching "${runId}"`)
  return join(runsRoot, match)
}

export async function resolveRunForResume(runId: string, runsRoot?: string): Promise<ResolvedRun> {
  const runDir = await resolveRunDirectory(runId, runsRoot)
  const requestFile = Bun.file(join(runDir, "request.json"))
  if (!(await requestFile.exists())) {
    throw new Error(`No request.json found in ${runDir}`)
  }

  const raw = await requestFile.json() as Record<string, unknown>
  const requestId = typeof raw.requestId === "string" ? raw.requestId : undefined
  if (!requestId) throw new Error(`No requestId in ${runDir}/request.json`)

  const parsed = inputRequestSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Invalid request.json in ${runDir}: ${parsed.error.message}`)
  }

  return { runDir, requestId, request: parsed.data }
}
