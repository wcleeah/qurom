import { cp, readdir, stat, utimes } from "node:fs/promises"
import { join } from "node:path"

async function preserveEntryTimes(src: string, dest: string) {
  const srcStat = await stat(src)
  await utimes(dest, srcStat.atime, srcStat.mtime)
}

async function preserveTreeTimes(srcRoot: string, destRoot: string) {
  await preserveEntryTimes(srcRoot, destRoot)
  const srcStat = await stat(srcRoot)
  if (!srcStat.isDirectory()) return

  const entries = await readdir(srcRoot, { withFileTypes: true })
  await Promise.all(entries.map(async (entry) => {
    const srcPath = join(srcRoot, entry.name)
    const destPath = join(destRoot, entry.name)
    if (entry.isDirectory()) {
      await preserveTreeTimes(srcPath, destPath)
      return
    }
    if (entry.isFile() || entry.isSymbolicLink()) {
      await preserveEntryTimes(srcPath, destPath)
    }
  }))
}

export async function copyPreserveTimes(src: string, dest: string, options?: { recursive?: boolean }) {
  const recursive = options?.recursive ?? false
  await cp(src, dest, { recursive })
  await preserveTreeTimes(src, dest)
}
