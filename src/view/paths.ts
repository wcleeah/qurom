import { readdir, stat } from "node:fs/promises"
import { basename, resolve } from "node:path"

import { quorumDataPaths } from "../data-paths"
import { isSqliteFile } from "./utils"

export function getRunsDir(): string {
  if (process.env.QUORUM_RUNS_DIR) {
    return resolve(process.env.QUORUM_RUNS_DIR)
  }
  return quorumDataPaths().runsDir
}

/** @deprecated Prefer getRunsDir() — evaluated once at import for display-only use. */
export const RUNS_DIR = getRunsDir()

export const PORT = parseInt(process.env.VIEW_PORT ?? "3000", 10)
export const HOST = process.env.VIEW_HOST ?? "0.0.0.0"

/** Resolve a run URL segment to the on-disk directory name (exact or requestId suffix). */
export async function resolveRunName(runName: string): Promise<string | null> {
  try {
    const direct = safeRunPath(runName)
    if ((await stat(direct)).isDirectory()) return runName
  } catch {
    // not an exact match — try fuzzy lookup below
  }

  const runsDir = getRunsDir()
  let dirs: string[]
  try {
    const entries = await readdir(runsDir, { withFileTypes: true })
    dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name)
  } catch {
    return null
  }

  if (dirs.includes(runName)) return runName
  const suffixMatch = dirs.find((dir) => dir.endsWith(`-${runName}`))
  if (suffixMatch) return suffixMatch
  const includeMatch = dirs.find((dir) => dir.includes(runName))
  return includeMatch ?? null
}

export function safeRunPath(runName: string): string {
  const runsDir = getRunsDir()
  const resolved = resolve(runsDir, runName)
  if (!resolved.startsWith(runsDir + "/") && resolved !== runsDir) {
    throw new Error("Path traversal blocked")
  }
  return resolved
}

export function safeFilePath(runName: string, filePath: string): string {
  const runDir = safeRunPath(runName)
  const clean = filePath.replace(/^\/+/, "")
  const resolved = resolve(runDir, clean)
  if (!resolved.startsWith(runDir + "/") && resolved !== runDir) {
    throw new Error("Path traversal blocked")
  }
  if (isSqliteFile(basename(resolved))) {
    throw new Error("Sqlite files blocked")
  }
  return resolved
}
