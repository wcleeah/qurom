import { randomBytes } from "node:crypto"
import { Database } from "bun:sqlite"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import { quorumDataPaths } from "../data-paths"
import { safeRunPath } from "./paths"

export type ShareLink = {
  token: string
  runName: string
  createdAt: string
}

const TOKEN_BYTES = 32
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/

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
CREATE TABLE IF NOT EXISTS share_links (
  token TEXT PRIMARY KEY,
  run_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
  `)
  return db
}

async function withDb<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
  const dbPath = resolveDbPath()
  await mkdir(dirname(dbPath), { recursive: true })
  const db = openDb(dbPath)
  try {
    return await fn(db)
  } finally {
    db.close()
  }
}

function rowToLink(row: { token: string; run_name: string; created_at: string }): ShareLink {
  return {
    token: row.token,
    runName: row.run_name,
    createdAt: row.created_at,
  }
}

export function isValidShareToken(token: string): boolean {
  return TOKEN_PATTERN.test(token)
}

export function mintShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url")
}

export function sharePathForToken(token: string): string {
  return `/share/${encodeURIComponent(token)}`
}

export async function getShareLinkByRun(runName: string): Promise<ShareLink | null> {
  safeRunPath(runName)
  return withDb((db) => {
    const row = db.query<{ token: string; run_name: string; created_at: string }, [string]>(
      "SELECT token, run_name, created_at FROM share_links WHERE run_name = ? LIMIT 1",
    ).get(runName)
    return row ? rowToLink(row) : null
  })
}

export async function getShareLinkByToken(token: string): Promise<ShareLink | null> {
  if (!isValidShareToken(token)) return null
  return withDb((db) => {
    const row = db.query<{ token: string; run_name: string; created_at: string }, [string]>(
      "SELECT token, run_name, created_at FROM share_links WHERE token = ? LIMIT 1",
    ).get(token)
    return row ? rowToLink(row) : null
  })
}

/** Idempotent: returns the existing token for the run, or mints a new one. */
export async function ensureShareLink(runName: string): Promise<ShareLink> {
  safeRunPath(runName)
  return withDb((db) => {
    const existing = db.query<{ token: string; run_name: string; created_at: string }, [string]>(
      "SELECT token, run_name, created_at FROM share_links WHERE run_name = ? LIMIT 1",
    ).get(runName)
    if (existing) return rowToLink(existing)

    const token = mintShareToken()
    const createdAt = nowIso()
    try {
      db.query(
        "INSERT INTO share_links (token, run_name, created_at) VALUES (?, ?, ?)",
      ).run(token, runName, createdAt)
      return { token, runName, createdAt }
    } catch {
      const raced = db.query<{ token: string; run_name: string; created_at: string }, [string]>(
        "SELECT token, run_name, created_at FROM share_links WHERE run_name = ? LIMIT 1",
      ).get(runName)
      if (raced) return rowToLink(raced)
      throw new Error("Failed to create share link")
    }
  })
}

export async function revokeShareLink(runName: string): Promise<boolean> {
  safeRunPath(runName)
  return withDb((db) => {
    const result = db.query("DELETE FROM share_links WHERE run_name = ?").run(runName)
    return result.changes > 0
  })
}
