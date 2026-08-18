import { Database } from "bun:sqlite"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import { quorumDataPaths } from "./data-paths"
import type { ReaderTranscriptEntry } from "./reader-transcript"
import type { InputRequest, ReaderCalibrationProfile } from "./schema"
import { inputRequestSchema, readerCalibrationProfileSchema } from "./schema"

export type UnattendedRerunInterview = "reuse" | "repair"

export type QueuedRerunPayload = {
  request: InputRequest
  readerProfile: ReaderCalibrationProfile
  interviewTranscript?: ReaderTranscriptEntry[]
}

export type RerunQueueItem = {
  id: string
  position: number
  interview: UnattendedRerunInterview
  sourceRunName: string
  topic: string
  payload: QueuedRerunPayload
  createdAt: string
}

export type RerunQueueStore = {
  enqueue: (input: {
    interview: UnattendedRerunInterview
    sourceRunName: string
    topic: string
    payload: QueuedRerunPayload
  }) => Promise<RerunQueueItem>
  list: () => Promise<RerunQueueItem[]>
  takeNext: () => Promise<RerunQueueItem | undefined>
  requeueFront: (item: RerunQueueItem) => Promise<void>
  remove: (id: string) => Promise<boolean>
  clear: () => Promise<number>
  setPaused: (paused: boolean) => Promise<void>
  isPaused: () => Promise<boolean>
}

type QueueRow = {
  id: string
  position: number
  interview: string
  source_run_name: string
  topic: string
  payload_json: string
  created_at: string
}

const transcriptEntrySchema = {
  parse(value: unknown): ReaderTranscriptEntry[] | undefined {
    if (!Array.isArray(value) || value.length === 0) return undefined
    const entries: ReaderTranscriptEntry[] = []
    for (const item of value) {
      if (!item || typeof item !== "object") continue
      const role = (item as { role?: unknown }).role
      const text = (item as { text?: unknown }).text
      if ((role === "interviewer" || role === "reader") && typeof text === "string" && text.trim()) {
        entries.push({ role, text })
      }
    }
    return entries.length > 0 ? entries : undefined
  },
}

function nowIso() {
  return new Date().toISOString()
}

function parsePayload(raw: string): QueuedRerunPayload {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const request = inputRequestSchema.parse(parsed.request)
  const readerProfile = readerCalibrationProfileSchema.parse(parsed.readerProfile)
  const interviewTranscript = transcriptEntrySchema.parse(parsed.interviewTranscript)
  return {
    request,
    readerProfile,
    ...(interviewTranscript ? { interviewTranscript } : {}),
  }
}

function rowToItem(row: QueueRow): RerunQueueItem {
  if (row.interview !== "reuse" && row.interview !== "repair") {
    throw new Error(`Invalid queued interview mode: ${row.interview}`)
  }
  return {
    id: row.id,
    position: row.position,
    interview: row.interview,
    sourceRunName: row.source_run_name,
    topic: row.topic,
    payload: parsePayload(row.payload_json),
    createdAt: row.created_at,
  }
}

function openQueueDb(dbPath: string): Database {
  const db = new Database(dbPath, { create: true, strict: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run(`
CREATE TABLE IF NOT EXISTS rerun_queue (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  interview TEXT NOT NULL CHECK (interview IN ('reuse', 'repair')),
  source_run_name TEXT NOT NULL,
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
  `)
  db.run(`
CREATE TABLE IF NOT EXISTS rerun_queue_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paused INTEGER NOT NULL DEFAULT 0
);
  `)
  db.run(`
INSERT OR IGNORE INTO rerun_queue_state (id, paused) VALUES (1, 0);
  `)
  return db
}

async function withQueueDb<T>(dbPath: string, fn: (db: Database) => T): Promise<T> {
  await mkdir(dirname(dbPath), { recursive: true })
  const db = openQueueDb(dbPath)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

export function createSqliteRerunQueueStore(dataDir?: string): RerunQueueStore {
  const dbPath = quorumDataPaths(dataDir).configDb

  return {
    async enqueue(input) {
      return withQueueDb(dbPath, (db) => {
        const existing = db.query<QueueRow, [string, string]>(
          `SELECT id, position, interview, source_run_name, topic, payload_json, created_at
           FROM rerun_queue
           WHERE source_run_name = ? AND interview = ?
           ORDER BY position ASC
           LIMIT 1`,
        ).get(input.sourceRunName, input.interview)
        if (existing) return rowToItem(existing)

        const maxRow = db.query<{ max_pos: number | null }, []>(
          "SELECT MAX(position) AS max_pos FROM rerun_queue",
        ).get()
        const position = (maxRow?.max_pos ?? 0) + 1
        const id = crypto.randomUUID()
        const createdAt = nowIso()
        db.query(
          `INSERT INTO rerun_queue
            (id, position, interview, source_run_name, topic, payload_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          position,
          input.interview,
          input.sourceRunName,
          input.topic,
          JSON.stringify(input.payload),
          createdAt,
        )
        return {
          id,
          position,
          interview: input.interview,
          sourceRunName: input.sourceRunName,
          topic: input.topic,
          payload: input.payload,
          createdAt,
        }
      })
    },

    async list() {
      return withQueueDb(dbPath, (db) => {
        const rows = db.query<QueueRow, []>(
          `SELECT id, position, interview, source_run_name, topic, payload_json, created_at
           FROM rerun_queue
           ORDER BY position ASC`,
        ).all()
        return rows.map(rowToItem)
      })
    },

    async takeNext() {
      return withQueueDb(dbPath, (db) => {
        const row = db.query<QueueRow, []>(
          `SELECT id, position, interview, source_run_name, topic, payload_json, created_at
           FROM rerun_queue
           ORDER BY position ASC
           LIMIT 1`,
        ).get()
        if (!row) return undefined
        db.query("DELETE FROM rerun_queue WHERE id = ?").run(row.id)
        return rowToItem(row)
      })
    },

    async requeueFront(item) {
      await withQueueDb(dbPath, (db) => {
        const minRow = db.query<{ min_pos: number | null }, []>(
          "SELECT MIN(position) AS min_pos FROM rerun_queue",
        ).get()
        const position = (minRow?.min_pos ?? 1) - 1
        db.query(
          `INSERT INTO rerun_queue
            (id, position, interview, source_run_name, topic, payload_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          item.id,
          position,
          item.interview,
          item.sourceRunName,
          item.topic,
          JSON.stringify(item.payload),
          item.createdAt,
        )
      })
    },

    async remove(id) {
      return withQueueDb(dbPath, (db) => {
        const result = db.query("DELETE FROM rerun_queue WHERE id = ?").run(id)
        return result.changes > 0
      })
    },

    async clear() {
      return withQueueDb(dbPath, (db) => {
        const count = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM rerun_queue").get()
        db.run("DELETE FROM rerun_queue")
        return count?.count ?? 0
      })
    },

    async setPaused(paused) {
      await withQueueDb(dbPath, (db) => {
        db.query("UPDATE rerun_queue_state SET paused = ? WHERE id = 1").run(paused ? 1 : 0)
      })
    },

    async isPaused() {
      return withQueueDb(dbPath, (db) => {
        const row = db.query<{ paused: number }, []>(
          "SELECT paused FROM rerun_queue_state WHERE id = 1",
        ).get()
        return (row?.paused ?? 0) === 1
      })
    },
  }
}
