import { mkdir, readdir, rename, stat } from "node:fs/promises"
import { basename, resolve } from "node:path"

import { quorumDataPaths } from "../data-paths"
import { archiveRunPath } from "../run-archive"
import { isSqliteFile } from "./utils"

export function getRunsDir(): string {
  if (process.env.QUORUM_RUNS_DIR) {
    return resolve(process.env.QUORUM_RUNS_DIR)
  }
  return quorumDataPaths().runsDir
}

export function getArchiveDir(): string {
  if (process.env.QUORUM_ARCHIVE_DIR) {
    return resolve(process.env.QUORUM_ARCHIVE_DIR)
  }
  // When runs dir is overridden, keep archive as sibling of that override.
  if (process.env.QUORUM_RUNS_DIR) {
    return resolve(process.env.QUORUM_RUNS_DIR, "..", "archive")
  }
  return quorumDataPaths().archiveDir
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

export function safeArchivePath(runName: string): string {
  const archiveDir = getArchiveDir()
  const resolved = resolve(archiveDir, runName)
  if (!resolved.startsWith(archiveDir + "/") && resolved !== archiveDir) {
    throw new Error("Path traversal blocked")
  }
  return resolved
}

/** Resolve a run URL segment to an on-disk directory name under archive/. */
export async function resolveArchiveRunName(runName: string): Promise<string | null> {
  try {
    const direct = safeArchivePath(runName)
    if ((await stat(direct)).isDirectory()) return runName
  } catch {
    // not an exact match — try fuzzy lookup below
  }

  const archiveDir = getArchiveDir()
  let dirs: string[]
  try {
    const entries = await readdir(archiveDir, { withFileTypes: true })
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

/** Move a run directory from runs/ into archive/. Returns the destination path. */
export async function archiveRunDirectory(runName: string): Promise<string> {
  return archiveRunPath(safeRunPath(runName), getArchiveDir())
}

/**
 * Move a run directory from archive/ back into runs/.
 * Throws if a run with the same name already exists under runs/.
 * Returns the destination path.
 */
export async function unarchiveRunDirectory(runName: string): Promise<string> {
  const source = safeArchivePath(runName)
  try {
    if (!(await stat(source)).isDirectory()) {
      throw new Error(`Archived run not found: ${runName}`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Archived run not found:")) throw error
    throw new Error(`Archived run not found: ${runName}`)
  }

  const runsDir = getRunsDir()
  await mkdir(runsDir, { recursive: true })
  const dest = safeRunPath(runName)
  try {
    await stat(dest)
    throw new Error(`Cannot unarchive: a run named "${runName}" already exists`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Cannot unarchive:")) throw error
    // destination free
  }

  await rename(source, dest)
  return dest
}
