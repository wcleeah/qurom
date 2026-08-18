import { mkdir, rename, stat } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

export function isPathInsideRoot(path: string, root: string): boolean {
  const resolved = resolve(path)
  const resolvedRoot = resolve(root)
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}/`)
}

export function archiveDirForRuns(runsRoot: string): string {
  const explicit = process.env.QUORUM_ARCHIVE_DIR?.trim()
  if (explicit) return resolve(explicit)
  return resolve(runsRoot, "..", "archive")
}

/** Move a run directory into archive/. Returns the destination path. */
export async function archiveRunPath(sourceRunDir: string, archiveDir: string): Promise<string> {
  const source = resolve(sourceRunDir)
  await mkdir(archiveDir, { recursive: true })

  let destName = basename(source)
  let dest = join(archiveDir, destName)
  try {
    await stat(dest)
    destName = `${destName}-archived-${Date.now()}`
    dest = join(archiveDir, destName)
  } catch {
    // destination free
  }

  const resolvedDest = resolve(dest)
  if (!isPathInsideRoot(resolvedDest, archiveDir)) {
    throw new Error("Path traversal blocked")
  }

  await rename(source, resolvedDest)
  return resolvedDest
}

/**
 * Archive a source run after a rerun is initiated.
 * No-ops when the directory is already under archive/ or is not under runs/.
 */
export async function archiveSourceRunAfterRerun(
  sourceRunDir: string,
  runsRoot: string,
): Promise<string | undefined> {
  const source = resolve(sourceRunDir)
  const archiveDir = archiveDirForRuns(runsRoot)
  if (isPathInsideRoot(source, archiveDir)) return undefined
  if (!isPathInsideRoot(source, runsRoot)) return undefined
  return await archiveRunPath(source, archiveDir)
}
