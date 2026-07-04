import { Database } from "bun:sqlite"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import { quorumDataPaths } from "../data-paths"
import { safeFilePath, safeRunPath } from "./paths"

export function nowIso(): string {
  return new Date().toISOString()
}

export function resolveDbPath(): string {
  return quorumDataPaths().configDb
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
  migrateHtmlReaderHighlightNotes(db)
  db.run(`
CREATE INDEX IF NOT EXISTS idx_html_reader_highlights_run_file
  ON html_reader_highlights (run_name, file_path);
  `)
  db.run(`
CREATE TABLE IF NOT EXISTS html_reader_ask_threads (
  id TEXT PRIMARY KEY,
  run_name TEXT NOT NULL,
  html_file TEXT NOT NULL,
  md_file TEXT NOT NULL,
  md_mtime_ms INTEGER NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('page', 'highlight')),
  highlight_id TEXT,
  provider TEXT NOT NULL,
  handle_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
  `)
  migrateHtmlReaderAskThreads(db)
  db.run(`
CREATE TABLE IF NOT EXISTS html_reader_ask_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES html_reader_ask_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
  `)
  db.run(`
CREATE INDEX IF NOT EXISTS idx_html_reader_ask_threads_run_file
  ON html_reader_ask_threads (run_name, html_file);
  `)
  db.run(`
CREATE INDEX IF NOT EXISTS idx_html_reader_ask_threads_run_file_updated
  ON html_reader_ask_threads (run_name, html_file, updated_at DESC);
  `)
  db.run(`
CREATE INDEX IF NOT EXISTS idx_html_reader_ask_messages_thread
  ON html_reader_ask_messages (thread_id, created_at);
  `)
  return db
}

function migrateHtmlReaderHighlightNotes(db: Database): void {
  const columns = db.query<{ name: string }, []>(
    "PRAGMA table_info(html_reader_highlights)",
  ).all()
  if (columns.some((column) => column.name === "note")) {
    return
  }
  db.run("ALTER TABLE html_reader_highlights ADD COLUMN note TEXT NOT NULL DEFAULT ''")
}

function migrateHtmlReaderAskThreads(db: Database): void {
  const row = db.query<{ sql: string }, []>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'html_reader_ask_threads'",
  ).get()
  if (!row?.sql?.includes("UNIQUE(run_name, html_file, scope, highlight_id)")) {
    return
  }

  db.run("BEGIN")
  try {
    db.run(`
CREATE TABLE html_reader_ask_threads_new (
  id TEXT PRIMARY KEY,
  run_name TEXT NOT NULL,
  html_file TEXT NOT NULL,
  md_file TEXT NOT NULL,
  md_mtime_ms INTEGER NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('page', 'highlight')),
  highlight_id TEXT,
  provider TEXT NOT NULL,
  handle_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
    `)
    db.run(`
INSERT INTO html_reader_ask_threads_new
SELECT id, run_name, html_file, md_file, md_mtime_ms, scope, highlight_id, provider, handle_id, status, created_at, updated_at
FROM html_reader_ask_threads
    `)
    db.run("DROP TABLE html_reader_ask_threads")
    db.run("ALTER TABLE html_reader_ask_threads_new RENAME TO html_reader_ask_threads")
    db.run(`
CREATE INDEX IF NOT EXISTS idx_html_reader_ask_threads_run_file
  ON html_reader_ask_threads (run_name, html_file);
    `)
    db.run(`
CREATE INDEX IF NOT EXISTS idx_html_reader_ask_threads_run_file_updated
  ON html_reader_ask_threads (run_name, html_file, updated_at DESC);
    `)
    db.run("COMMIT")
  } catch (error) {
    db.run("ROLLBACK")
    throw error
  }
}
