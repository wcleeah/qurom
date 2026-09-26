import { mkdir, readdir, rename, stat } from "node:fs/promises"
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

function isMissingPath(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

/** Live runs dir plus optional archive dir, de-duplicated by resolved path. */
export function usageImportRoots(runsDir: string, archiveDir?: string): string[] {
  const roots = [resolve(runsDir)]
  const extra = archiveDir?.trim()
  if (!extra) return roots
  const resolvedArchive = resolve(extra)
  if (resolvedArchive !== roots[0]) roots.push(resolvedArchive)
  return roots
}

/** Immediate child directories of each root. Missing roots are skipped. */
export async function listRunDirectories(
  roots: string[],
): Promise<Array<{ runName: string; runDir: string }>> {
  const seen = new Set<string>()
  const output: Array<{ runName: string; runDir: string }> = []

  for (const root of roots) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch (error) {
      if (isMissingPath(error)) continue
      throw error
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue
      const runDir = resolve(root, entry.name)
      if (seen.has(runDir)) continue
      seen.add(runDir)
      output.push({ runName: entry.name, runDir })
    }
  }

  return output
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
