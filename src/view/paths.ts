import { basename, resolve } from "node:path"
import { isSqliteFile } from "./utils"

export const RUNS_DIR = resolve(import.meta.dirname, "..", "..", "runs")
export const PORT = parseInt(process.env.VIEW_PORT ?? "3000", 10)
export const HOST = process.env.VIEW_HOST ?? "0.0.0.0"

export function safeRunPath(runName: string): string {
  const resolved = resolve(RUNS_DIR, runName)
  if (!resolved.startsWith(RUNS_DIR + "/") && resolved !== RUNS_DIR) {
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
