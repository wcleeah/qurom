import { Database } from "bun:sqlite"
import { mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { safeFilePath, safeRunPath } from "./paths"

function nowIso() {
  return new Date().toISOString()
}

function resolveDbPath(): string {
  const workspace = process.env.QUORUM_WORKSPACE_DIRECTORY ?? process.env.OPENCODE_DIRECTORY ?? process.cwd()
  const raw = process.env.QUORUM_CONFIG_DB_PATH ?? join(workspace, "runs", "quorum-config.sqlite")
  return raw.startsWith("/") ? raw : resolve(process.cwd(), raw)
}

function isHtmlFilePath(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase()
  return ext === "html" || ext === "htm"
}

function openDb(dbPath: string): Database {
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
  return db
}

function validateHtmlNoteTarget(runName: string, filePath: string): void {
  safeRunPath(runName)
  safeFilePath(runName, filePath)
  if (!isHtmlFilePath(filePath)) {
    throw new Error("Only HTML files support reader notes")
  }
}

export async function getHtmlReaderNotes(runName: string, filePath: string): Promise<string> {
  validateHtmlNoteTarget(runName, filePath)
  const dbPath = resolveDbPath()
  await mkdir(dirname(dbPath), { recursive: true })
  const db = openDb(dbPath)
  try {
    const row = db.query<{ notes: string }, [string, string]>(
      "SELECT notes FROM html_reader_notes WHERE run_name = ? AND file_path = ? LIMIT 1",
    ).get(runName, filePath)
    return row?.notes ?? ""
  } finally {
    db.close()
  }
}

export async function setHtmlReaderNotes(
  runName: string,
  filePath: string,
  notes: string,
): Promise<{ updatedAt: string }> {
  validateHtmlNoteTarget(runName, filePath)
  const updatedAt = nowIso()
  const dbPath = resolveDbPath()
  await mkdir(dirname(dbPath), { recursive: true })
  const db = openDb(dbPath)
  try {
    db.query(
      "INSERT OR REPLACE INTO html_reader_notes (run_name, file_path, notes, updated_at) VALUES (?, ?, ?, ?)",
    ).run(runName, filePath, notes, updatedAt)
    return { updatedAt }
  } finally {
    db.close()
  }
}
