import { readdir, stat } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

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

async function resolveInRoot(runId: string, root: string): Promise<string | undefined> {
  const direct = join(root, runId)
  if (await isDirectory(direct)) return direct

  const name = basename(runId)
  if (name !== runId) {
    const byName = join(root, name)
    if (await isDirectory(byName)) return byName
  }

  let dirs: string[]
  try {
    dirs = await readdir(root)
  } catch {
    return undefined
  }
  const match = dirs.find((dir) => dir === runId || dir === name || dir.includes(runId) || dir.includes(name))
  return match ? join(root, match) : undefined
}

export async function resolveRunDirectory(
  runId: string,
  runsRoot = resolve(process.cwd(), "runs"),
  archiveRoot?: string,
) {
  if (await isDirectory(runId)) return runId

  const inRuns = await resolveInRoot(runId, runsRoot)
  if (inRuns) return inRuns

  if (archiveRoot) {
    const inArchive = await resolveInRoot(runId, archiveRoot)
    if (inArchive) return inArchive
  }

  throw new Error(`No run directory found matching "${runId}"`)
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
