import type { Database } from "bun:sqlite"

import { ensureLibraryNotesSchema, tableExists } from "./html-reader-db"

export type MigrationStatus = "pending" | "complete" | "unavailable"

export type MigrationPreview = {
  id: string
  title: string
  description: string
  status: MigrationStatus
  pendingCounts?: { highlights?: number; pageNotes?: number }
  resultCounts?: { highlights?: number; pageNotes?: number }
  lastRunAt?: string
  lastError?: string
}

export type MigrationRunResult = {
  ok: boolean
  message: string
  counts?: { highlights?: number; pageNotes?: number }
}

type SchemaMigration = {
  id: string
  title: string
  description: string
  preview: (db: Database) => MigrationPreview
  run: (db: Database) => MigrationRunResult
}

function ensureMigrationLogSchema(db: Database): void {
  db.run(`
CREATE TABLE IF NOT EXISTS schema_migration_log (
  migration_id TEXT NOT NULL,
  ran_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  message TEXT NOT NULL,
  counts_json TEXT NOT NULL DEFAULT '{}'
);
  `)
}

function readLastMigrationLog(db: Database, migrationId: string): {
  ranAt: string
  ok: boolean
  message: string
} | null {
  if (!tableExists(db, "schema_migration_log")) return null
  const row = db.query<{ ran_at: string; ok: number; message: string }, [string]>(
    `SELECT ran_at, ok, message FROM schema_migration_log
     WHERE migration_id = ?
     ORDER BY ran_at DESC
     LIMIT 1`,
  ).get(migrationId)
  if (!row) return null
  return { ranAt: row.ran_at, ok: row.ok === 1, message: row.message }
}

function writeMigrationLog(
  db: Database,
  migrationId: string,
  result: MigrationRunResult,
): void {
  ensureMigrationLogSchema(db)
  db.query(
    `INSERT INTO schema_migration_log (migration_id, ran_at, ok, message, counts_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    migrationId,
    new Date().toISOString(),
    result.ok ? 1 : 0,
    result.message,
    JSON.stringify(result.counts ?? {}),
  )
}

function countPendingHighlights(db: Database): number {
  if (!tableExists(db, "html_reader_highlights")) return 0
  const row = db.query<{ count: number }, []>(
    `SELECT COUNT(*) AS count FROM html_reader_highlights h
     WHERE NOT EXISTS (
       SELECT 1 FROM library_notes n
       WHERE n.id = h.id AND n.kind = 'highlight'
     )`,
  ).get()
  return row?.count ?? 0
}

function countPendingPageNotes(db: Database): number {
  if (!tableExists(db, "html_reader_notes")) return 0
  const row = db.query<{ count: number }, []>(
    `SELECT COUNT(*) AS count FROM html_reader_notes o
     WHERE TRIM(o.notes) != ''
       AND NOT EXISTS (
         SELECT 1 FROM library_notes n
         WHERE n.kind = 'page' AND n.run_name = o.run_name AND n.file_path = o.file_path
       )`,
  ).get()
  return row?.count ?? 0
}

function countLibraryNotes(db: Database, kind: "highlight" | "page"): number {
  if (!tableExists(db, "library_notes")) return 0
  const row = db.query<{ count: number }, [string]>(
    "SELECT COUNT(*) AS count FROM library_notes WHERE kind = ?",
  ).get(kind)
  return row?.count ?? 0
}

function runLibraryNotesV1(db: Database): MigrationRunResult {
  ensureLibraryNotesSchema(db)

  if (!tableExists(db, "html_reader_highlights") && !tableExists(db, "html_reader_notes")) {
    return { ok: true, message: "No legacy annotation tables; nothing to migrate.", counts: { highlights: 0, pageNotes: 0 } }
  }

  let highlightsMigrated = 0
  let pageNotesMigrated = 0

  db.run("BEGIN")
  try {
    if (tableExists(db, "html_reader_highlights")) {
      const rows = db.query<
        {
          id: string
          run_name: string
          file_path: string
          color: string
          quote: string
          prefix: string
          suffix: string
          note: string
          created_at: string
          updated_at: string
        },
        []
      >(
        `SELECT h.id, h.run_name, h.file_path, h.color, h.quote, h.prefix, h.suffix,
                COALESCE(h.note, '') AS note, h.created_at, h.updated_at
         FROM html_reader_highlights h
         WHERE NOT EXISTS (
           SELECT 1 FROM library_notes n WHERE n.id = h.id AND n.kind = 'highlight'
         )`,
      ).all()

      const insert = db.query(
        `INSERT INTO library_notes
         (id, kind, run_name, file_path, body, quote, prefix, suffix, color, created_at, updated_at)
         VALUES (?, 'highlight', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const row of rows) {
        insert.run(
          row.id,
          row.run_name,
          row.file_path,
          row.note,
          row.quote,
          row.prefix,
          row.suffix,
          row.color,
          row.created_at,
          row.updated_at,
        )
        highlightsMigrated += 1
      }
    }

    if (tableExists(db, "html_reader_notes")) {
      const rows = db.query<
        { run_name: string; file_path: string; notes: string; updated_at: string },
        []
      >(
        `SELECT o.run_name, o.file_path, o.notes, o.updated_at
         FROM html_reader_notes o
         WHERE TRIM(o.notes) != ''
           AND NOT EXISTS (
             SELECT 1 FROM library_notes n
             WHERE n.kind = 'page' AND n.run_name = o.run_name AND n.file_path = o.file_path
           )`,
      ).all()

      const insert = db.query(
        `INSERT INTO library_notes
         (id, kind, run_name, file_path, body, quote, prefix, suffix, color, created_at, updated_at)
         VALUES (?, 'page', ?, ?, ?, NULL, '', '', NULL, ?, ?)`,
      )
      for (const row of rows) {
        insert.run(
          crypto.randomUUID(),
          row.run_name,
          row.file_path,
          row.notes,
          row.updated_at,
          row.updated_at,
        )
        pageNotesMigrated += 1
      }
    }

    db.run("COMMIT")
  } catch (error) {
    db.run("ROLLBACK")
    throw error
  }

  const message =
    highlightsMigrated === 0 && pageNotesMigrated === 0
      ? "Migration already complete; no new rows copied."
      : `Migrated ${highlightsMigrated} highlight(s) and ${pageNotesMigrated} page note(s).`

  return {
    ok: true,
    message,
    counts: { highlights: highlightsMigrated, pageNotes: pageNotesMigrated },
  }
}

const LIBRARY_NOTES_V1: SchemaMigration = {
  id: "library-notes-v1",
  title: "Library notes",
  description:
    "Copy html_reader_highlights and html_reader_notes into the unified library_notes table. Highlight IDs are preserved.",
  preview(db) {
    ensureLibraryNotesSchema(db)
    const lastLog = readLastMigrationLog(db, this.id)
    const pendingHighlights = countPendingHighlights(db)
    const pendingPageNotes = countPendingPageNotes(db)
    const hasLegacy =
      tableExists(db, "html_reader_highlights") || tableExists(db, "html_reader_notes")

    let status: MigrationStatus = "complete"
    if (!hasLegacy) {
      status = "unavailable"
    } else if (pendingHighlights > 0 || pendingPageNotes > 0) {
      status = "pending"
    }

    return {
      id: this.id,
      title: this.title,
      description: this.description,
      status,
      pendingCounts:
        status === "pending"
          ? { highlights: pendingHighlights, pageNotes: pendingPageNotes }
          : undefined,
      resultCounts: {
        highlights: countLibraryNotes(db, "highlight"),
        pageNotes: countLibraryNotes(db, "page"),
      },
      lastRunAt: lastLog?.ranAt,
      lastError: lastLog && !lastLog.ok ? lastLog.message : undefined,
    }
  },
  run(db) {
    try {
      const result = runLibraryNotesV1(db)
      writeMigrationLog(db, this.id, result)
      return result
    } catch (error) {
      const result: MigrationRunResult = {
        ok: false,
        message: error instanceof Error ? error.message : "Migration failed",
      }
      writeMigrationLog(db, this.id, result)
      return result
    }
  },
}

const MIGRATIONS: SchemaMigration[] = [LIBRARY_NOTES_V1]

export function listSchemaMigrationPreviews(db: Database): MigrationPreview[] {
  ensureMigrationLogSchema(db)
  return MIGRATIONS.map((migration) => migration.preview(db))
}

export function runSchemaMigration(db: Database, migrationId: string): MigrationRunResult {
  const migration = MIGRATIONS.find((entry) => entry.id === migrationId)
  if (!migration) {
    return { ok: false, message: `Unknown migration: ${migrationId}` }
  }
  return migration.run(db)
}
