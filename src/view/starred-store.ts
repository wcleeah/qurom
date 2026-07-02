import { Database } from "bun:sqlite"
import { mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { safeRunPath } from "./paths"

function nowIso() {
  return new Date().toISOString()
}

function resolveDbPath(): string {
  const workspace = process.env.QUORUM_WORKSPACE_DIRECTORY ?? process.env.OPENCODE_DIRECTORY ?? process.cwd()
  const raw = process.env.QUORUM_CONFIG_DB_PATH ?? join(workspace, "runs", "quorum-config.sqlite")
  return raw.startsWith("/") ? raw : resolve(process.cwd(), raw)
}

function openDb(dbPath: string): Database {
  const db = new Database(dbPath, { create: true, strict: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run(`
CREATE TABLE IF NOT EXISTS starred_runs (
  run_name TEXT PRIMARY KEY,
  starred_at TEXT NOT NULL
);
  `)
  return db
}

export async function listStarredRunNames(): Promise<Set<string>> {
  const dbPath = resolveDbPath()
  await mkdir(dirname(dbPath), { recursive: true })
  const db = openDb(dbPath)
  try {
    const rows = db.query<{ run_name: string }, []>("SELECT run_name FROM starred_runs").all()
    return new Set(rows.map((row) => row.run_name))
  } finally {
    db.close()
  }
}

export async function isRunStarred(runName: string): Promise<boolean> {
  safeRunPath(runName)
  const dbPath = resolveDbPath()
  await mkdir(dirname(dbPath), { recursive: true })
  const db = openDb(dbPath)
  try {
    const row = db.query<{ run_name: string }, [string]>(
      "SELECT run_name FROM starred_runs WHERE run_name = ? LIMIT 1",
    ).get(runName)
    return row !== null
  } finally {
    db.close()
  }
}

export async function setRunStarred(runName: string, starred: boolean): Promise<void> {
  safeRunPath(runName)
  const dbPath = resolveDbPath()
  await mkdir(dirname(dbPath), { recursive: true })
  const db = openDb(dbPath)
  try {
    if (starred) {
      db.query("INSERT OR REPLACE INTO starred_runs (run_name, starred_at) VALUES (?, ?)").run(runName, nowIso())
    } else {
      db.query("DELETE FROM starred_runs WHERE run_name = ?").run(runName)
    }
  } finally {
    db.close()
  }
}
