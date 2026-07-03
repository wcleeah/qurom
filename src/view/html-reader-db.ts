import { Database } from "bun:sqlite"
import { mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { safeFilePath, safeRunPath } from "./paths"

export function nowIso(): string {
  return new Date().toISOString()
}

export function resolveDbPath(): string {
  const workspace = process.env.QUORUM_WORKSPACE_DIRECTORY ?? process.env.OPENCODE_DIRECTORY ?? process.cwd()
  const raw = process.env.QUORUM_CONFIG_DB_PATH ?? join(workspace, "runs", "quorum-config.sqlite")
  return raw.startsWith("/") ? raw : resolve(process.cwd(), raw)
}

export function isHtmlFilePath(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase()
  return ext === "html" || ext === "htm"
}

export function validateHtmlReaderTarget(runName: string, filePath: string): void {
  safeRunPath(runName)
  safeFilePath(runName, filePath)
  if (!isHtmlFilePath(filePath)) {
    throw new Error("Only HTML files support reader annotations")
  }
}

export async function withHtmlReaderDb<T>(fn: (db: Database) => T): Promise<T> {
  const dbPath = resolveDbPath()
  await mkdir(dirname(dbPath), { recursive: true })
  const db = openHtmlReaderDb(dbPath)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

export function openHtmlReaderDb(dbPath: string): Database {
  const db = new Database(dbPath, { create: true, strict: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run(`
CREATE TABLE IF NOT EXISTS html_reader_notes (
  run_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_name, file_path)
);
  `)
  db.run(`
CREATE TABLE IF NOT EXISTS html_reader_highlights (
  id TEXT PRIMARY KEY,
  run_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  color TEXT NOT NULL,
  quote TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
  `)
  db.run(`
CREATE INDEX IF NOT EXISTS idx_html_reader_highlights_run_file
  ON html_reader_highlights (run_name, file_path);
  `)
  return db
}
