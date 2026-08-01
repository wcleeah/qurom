import { Database } from "bun:sqlite"
import { mkdir, readdir } from "node:fs/promises"
import { dirname } from "node:path"

import { quorumDataPaths } from "../data-paths"
import { tableExists } from "./html-reader-db"
import { getRunsDir, safeRunPath } from "./paths"
import { isSqliteFile } from "./utils"

function nowIso() {
  return new Date().toISOString()
}

function resolveDbPath(): string {
  return quorumDataPaths().configDb
}

async function listRunDirectoryNames(): Promise<string[]> {
  try {
    const entries = await readdir(getRunsDir(), { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !isSqliteFile(e.name))
      .map((e) => e.name)
  } catch {
    return []
  }
}

async function migrateStarredToRead(db: Database): Promise<void> {
  if (!tableExists(db, "starred_runs")) return

  const starredRows = db.query<{ run_name: string }, []>("SELECT run_name FROM starred_runs").all()
  const starred = new Set(starredRows.map((row) => row.run_name))
  const runNames = await listRunDirectoryNames()
  const stamp = nowIso()
  const insert = db.query("INSERT OR IGNORE INTO read_runs (run_name, read_at) VALUES (?, ?)")

  for (const runName of runNames) {
    if (!starred.has(runName)) {
      insert.run(runName, stamp)
    }
  }

  db.run("DROP TABLE starred_runs")
}

async function openDb(dbPath: string): Promise<Database> {
  const db = new Database(dbPath, { create: true, strict: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run(`
CREATE TABLE IF NOT EXISTS read_runs (
  run_name TEXT PRIMARY KEY,
  read_at TEXT NOT NULL
);
  `)
  db.run(`
CREATE TABLE IF NOT EXISTS run_access (
  run_name TEXT PRIMARY KEY,
  accessed_at TEXT NOT NULL
);
  `)
  await migrateStarredToRead(db)
  return db
}

async function withDb<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
  const dbPath = resolveDbPath()
  await mkdir(dirname(dbPath), { recursive: true })
  const db = await openDb(dbPath)
  try {
    return await fn(db)
  } finally {
    db.close()
  }
}

export async function listReadRunNames(): Promise<Set<string>> {
  return withDb((db) => {
    const rows = db.query<{ run_name: string }, []>("SELECT run_name FROM read_runs").all()
    return new Set(rows.map((row) => row.run_name))
  })
}

export async function listUnreadRunNames(): Promise<Set<string>> {
  const read = await listReadRunNames()
  const runNames = await listRunDirectoryNames()
  return new Set(runNames.filter((name) => !read.has(name)))
}

export async function isRunUnread(runName: string): Promise<boolean> {
  safeRunPath(runName)
  return withDb((db) => {
    const row = db.query<{ run_name: string }, [string]>(
      "SELECT run_name FROM read_runs WHERE run_name = ? LIMIT 1",
    ).get(runName)
    return row === null
  })
}

export async function setRunRead(runName: string, read: boolean): Promise<void> {
  safeRunPath(runName)
  await withDb((db) => {
    if (read) {
      db.query(
        "INSERT INTO read_runs (run_name, read_at) VALUES (?, ?) ON CONFLICT(run_name) DO UPDATE SET read_at = excluded.read_at",
      ).run(runName, nowIso())
      return
    }
    db.query("DELETE FROM read_runs WHERE run_name = ?").run(runName)
  })
}

/** Last time each run detail page was opened (ms epoch). */
export async function listRunAccessTimes(): Promise<Map<string, number>> {
  return withDb((db) => {
    const rows = db.query<{ run_name: string; accessed_at: string }, []>(
      "SELECT run_name, accessed_at FROM run_access",
    ).all()
    const map = new Map<string, number>()
    for (const row of rows) {
      const t = Date.parse(row.accessed_at)
      if (Number.isFinite(t)) map.set(row.run_name, t)
    }
    return map
  })
}

/** Record that the run detail page was opened. */
export async function touchRunAccess(runName: string): Promise<void> {
  safeRunPath(runName)
  await withDb((db) => {
    db.query(
      "INSERT INTO run_access (run_name, accessed_at) VALUES (?, ?) ON CONFLICT(run_name) DO UPDATE SET accessed_at = excluded.accessed_at",
    ).run(runName, nowIso())
  })
}
