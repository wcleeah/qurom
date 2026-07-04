import { Database } from "bun:sqlite"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import { quorumDataPaths } from "../data-paths"
import { safeRunPath } from "./paths"

function nowIso() {
  return new Date().toISOString()
}

function resolveDbPath(): string {
  return quorumDataPaths().configDb
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
      db.query("INSERT INTO starred_runs (run_name, starred_at) VALUES (?, ?) ON CONFLICT(run_name) DO UPDATE SET starred_at = excluded.starred_at")
        .run(runName, nowIso())
      return
    }
    db.query("DELETE FROM starred_runs WHERE run_name = ?").run(runName)
  } finally {
    db.close()
  }
}
