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
export function tableExists(db: Database, name: string): boolean {
  const row = db.query<{ count: number }, [string]>(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name)
  return (row?.count ?? 0) > 0
}

export function ensureLibraryNotesSchema(db: Database): void {
  db.run(`
CREATE TABLE IF NOT EXISTS library_notes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('page', 'highlight')),
  run_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  quote TEXT,
  prefix TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  color TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
  `)
  db.run(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_library_notes_page_unique
  ON library_notes (run_name, file_path)
  WHERE kind = 'page';
  `)
  db.run(`
CREATE INDEX IF NOT EXISTS idx_library_notes_updated
  ON library_notes (updated_at DESC);
  `)
  db.run(`
CREATE INDEX IF NOT EXISTS idx_library_notes_run_file
  ON library_notes (run_name, file_path);
  `)
}

export function ensureTagsSchema(db: Database): void {
  db.run(`
CREATE TABLE IF NOT EXISTS tags (
  slug TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('predefined', 'agent', 'user')),
  created_at TEXT NOT NULL
);
  `)
  db.run(`
CREATE TABLE IF NOT EXISTS article_tags (
  run_name TEXT NOT NULL,
  tag_slug TEXT NOT NULL REFERENCES tags(slug),
  source TEXT NOT NULL CHECK (source IN ('agent', 'user')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_name, tag_slug)
);
  `)
  db.run(`
CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL REFERENCES library_notes(id) ON DELETE CASCADE,
  tag_slug TEXT NOT NULL REFERENCES tags(slug),
  source TEXT NOT NULL CHECK (source IN ('propagated', 'user')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (note_id, tag_slug)
);
  `)
  db.run(`
CREATE INDEX IF NOT EXISTS idx_article_tags_run
  ON article_tags (run_name);
  `)
  db.run(`
CREATE INDEX IF NOT EXISTS idx_note_tags_note
  ON note_tags (note_id);
  `)
  db.run(`
CREATE INDEX IF NOT EXISTS idx_note_tags_slug
  ON note_tags (tag_slug);
  `)
}

export function openHtmlReaderDb(dbPath: string): Database {
  const db = new Database(dbPath, { create: true, strict: true })
  db.run("PRAGMA journal_mode = WAL")
  ensureLibraryNotesSchema(db)
  ensureTagsSchema(db)
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
  scope TEXT NOT NULL CHECK(scope IN ('page', 'highlight', 'selection')),
  highlight_id TEXT,
  context_quote TEXT,
  context_prefix TEXT NOT NULL DEFAULT '',
  context_suffix TEXT NOT NULL DEFAULT '',
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
  const columns = db.query<{ name: string }, []>(
    "PRAGMA table_info(html_reader_ask_threads)",
  ).all()
  const hasSelectionScope = row?.sql?.includes("'selection'") ?? false
  const hasContextColumns = ["context_quote", "context_prefix", "context_suffix"]
    .every((name) => columns.some((column) => column.name === name))
  const hasLegacyUnique = row?.sql?.includes("UNIQUE(run_name, html_file, scope, highlight_id)") ?? false
  if (hasSelectionScope && hasContextColumns && !hasLegacyUnique) {
    return
  }

  const contextQuote = columns.some((column) => column.name === "context_quote") ? "context_quote" : "NULL"
  const contextPrefix = columns.some((column) => column.name === "context_prefix") ? "context_prefix" : "''"
  const contextSuffix = columns.some((column) => column.name === "context_suffix") ? "context_suffix" : "''"

  db.run("BEGIN")
  try {
    db.run(`
CREATE TABLE html_reader_ask_threads_new (
  id TEXT PRIMARY KEY,
  run_name TEXT NOT NULL,
  html_file TEXT NOT NULL,
  md_file TEXT NOT NULL,
  md_mtime_ms INTEGER NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('page', 'highlight', 'selection')),
  highlight_id TEXT,
  context_quote TEXT,
  context_prefix TEXT NOT NULL DEFAULT '',
  context_suffix TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  handle_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
    `)
    db.run(`
INSERT INTO html_reader_ask_threads_new
SELECT id, run_name, html_file, md_file, md_mtime_ms, scope, highlight_id,
       ${contextQuote}, ${contextPrefix}, ${contextSuffix},
       provider, handle_id, status, created_at, updated_at
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
