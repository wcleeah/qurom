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
