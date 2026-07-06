import { stat } from "node:fs/promises"
import { basename } from "node:path"

import { inheritArticleTagsToNote } from "../tags-store"
import { nowIso, validateHtmlReaderTarget, withHtmlReaderDb } from "./html-reader-db"
import {
  isHighlightColor,
  libraryNoteToHighlight,
  type HtmlReaderHighlight,
  type LibraryNote,
  type LibraryNoteKind,
  type LibrarySource,
} from "./library-notes-types"
import { safeFilePath, safeRunPath } from "./paths"

export {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLOR_RGBA,
  type HighlightColor,
  type HtmlReaderHighlight,
  type LibraryNote,
  type LibraryNoteKind,
  type LibrarySource,
} from "./library-notes-types"

type LibraryNoteRow = {
  id: string
  kind: string
  run_name: string
  file_path: string
  body: string
  quote: string | null
  prefix: string
  suffix: string
  color: string | null
  created_at: string
  updated_at: string
}

const LIBRARY_NOTE_SELECT = `SELECT id, kind, run_name, file_path, body, quote, prefix, suffix, color, created_at, updated_at
       FROM library_notes`

function isLibraryNoteKind(value: string): value is LibraryNoteKind {
  return value === "page" || value === "highlight"
}

function rowToLibraryNote(row: LibraryNoteRow): LibraryNote {
  return {
    id: row.id,
    kind: isLibraryNoteKind(row.kind) ? row.kind : "highlight",
    runName: row.run_name,
    filePath: row.file_path,
    body: row.body,
    quote: row.quote,
    prefix: row.prefix,
    suffix: row.suffix,
    color: row.color && isHighlightColor(row.color) ? row.color : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function readRunTopic(runName: string): Promise<string | null> {
  try {
    safeRunPath(runName)
    const requestPath = safeFilePath(runName, "request.json")
    const file = Bun.file(requestPath)
    if (!(await file.exists())) return null
    const requestJson = await file.json() as {
      inputSummary?: { title?: string }
      topic?: string
    }
    return requestJson.inputSummary?.title ?? requestJson.topic ?? null
  } catch {
    return null
  }
}

export async function resolveLibrarySource(runName: string, filePath: string): Promise<LibrarySource> {
  let alive = false
  let topic: string | null = null

  try {
    safeRunPath(runName)
    const resolved = safeFilePath(runName, filePath)
    const fileStat = await stat(resolved)
    alive = fileStat.isFile()
    topic = await readRunTopic(runName)
  } catch {
    alive = false
  }

  return { runName, filePath, topic, alive }
}

export async function getPageNoteLibraryId(runName: string, filePath: string): Promise<string | null> {
  validateHtmlReaderTarget(runName, filePath)
  return withHtmlReaderDb((db) => {
    const row = db.query<{ id: string }, [string, string]>(
      "SELECT id FROM library_notes WHERE run_name = ? AND file_path = ? AND kind = 'page' LIMIT 1",
    ).get(runName, filePath)
    return row?.id ?? null
  })
}

export async function getHighlightLibraryId(
  runName: string,
  filePath: string,
  highlightId: string,
): Promise<string | null> {
  validateHtmlReaderTarget(runName, filePath)
  return withHtmlReaderDb((db) => {
    const row = db.query<{ id: string }, [string, string, string]>(
      `SELECT id FROM library_notes
       WHERE run_name = ? AND file_path = ? AND id = ? AND kind = 'highlight'
       LIMIT 1`,
    ).get(runName, filePath, highlightId)
    return row?.id ?? null
  })
}

export async function listAllLibraryNotes(options?: { tagSlugs?: string[] }): Promise<LibraryNote[]> {
  return withHtmlReaderDb((db) => {
    const tagSlugs = (options?.tagSlugs ?? []).filter(Boolean)
    if (tagSlugs.length === 0) {
      const rows = db.query<LibraryNoteRow, []>(
        `${LIBRARY_NOTE_SELECT}
         ORDER BY updated_at DESC`,
      ).all()
      return rows.map(rowToLibraryNote)
    }

    const placeholders = tagSlugs.map(() => "?").join(", ")
    const rows = db.query<LibraryNoteRow, string[]>(
      `${LIBRARY_NOTE_SELECT}
       WHERE EXISTS (
         SELECT 1 FROM note_tags nt
         WHERE nt.note_id = library_notes.id
           AND nt.tag_slug IN (${placeholders})
       )
       ORDER BY updated_at DESC`,
    ).all(...tagSlugs)
    return rows.map(rowToLibraryNote)
  })
}

export async function getLibraryNote(id: string): Promise<LibraryNote | null> {
  return withHtmlReaderDb((db) => {
    const row = db.query<LibraryNoteRow, [string]>(
      `${LIBRARY_NOTE_SELECT} WHERE id = ? LIMIT 1`,
    ).get(id)
    return row ? rowToLibraryNote(row) : null
  })
}

export async function listHighlights(runName: string, filePath: string): Promise<HtmlReaderHighlight[]> {
  validateHtmlReaderTarget(runName, filePath)
  return withHtmlReaderDb((db) => {
    const rows = db.query<LibraryNoteRow, [string, string]>(
      `${LIBRARY_NOTE_SELECT}
       WHERE run_name = ? AND file_path = ? AND kind = 'highlight'
       ORDER BY created_at ASC`,
    ).all(runName, filePath)
    return rows.map(rowToLibraryNote).map(libraryNoteToHighlight)
  })
}

export async function getHighlight(
  runName: string,
  filePath: string,
  id: string,
): Promise<HtmlReaderHighlight | null> {
  validateHtmlReaderTarget(runName, filePath)
  return withHtmlReaderDb((db) => {
    const row = db.query<LibraryNoteRow, [string, string, string]>(
      `${LIBRARY_NOTE_SELECT}
       WHERE run_name = ? AND file_path = ? AND id = ? AND kind = 'highlight'
       LIMIT 1`,
    ).get(runName, filePath, id)
    return row ? libraryNoteToHighlight(rowToLibraryNote(row)) : null
  })
}

export async function createHighlight(input: {
  runName: string
  filePath: string
  color: string
  quote: string
  prefix?: string
  suffix?: string
}): Promise<HtmlReaderHighlight> {
  validateHtmlReaderTarget(input.runName, input.filePath)
  if (!input.quote.trim()) {
    throw new Error("Highlight quote is required")
  }
  const quote = input.quote
  if (!isHighlightColor(input.color)) {
    throw new Error("Invalid highlight color")
  }
  const id = crypto.randomUUID()
  const now = nowIso()
  const prefix = input.prefix ?? ""
  const suffix = input.suffix ?? ""
  await withHtmlReaderDb((db) => {
    db.query(
      `INSERT INTO library_notes
       (id, kind, run_name, file_path, body, quote, prefix, suffix, color, created_at, updated_at)
       VALUES (?, 'highlight', ?, ?, '', ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.runName, input.filePath, quote, prefix, suffix, input.color, now, now)
  })
  await inheritArticleTagsToNote(input.runName, id)
  return {
    id,
    runName: input.runName,
    filePath: input.filePath,
    color: input.color,
    quote,
    prefix,
    suffix,
    note: "",
    createdAt: now,
    updatedAt: now,
  }
}

export async function updateHighlightNote(
  runName: string,
  filePath: string,
  id: string,
  note: string,
): Promise<HtmlReaderHighlight | null> {
  validateHtmlReaderTarget(runName, filePath)
  const updatedAt = nowIso()
  const changed = await withHtmlReaderDb((db) => {
    const result = db.query(
      `UPDATE library_notes
       SET body = ?, updated_at = ?
       WHERE run_name = ? AND file_path = ? AND id = ? AND kind = 'highlight'`,
    ).run(note, updatedAt, runName, filePath, id)
    return result.changes > 0
  })
  if (!changed) return null
  return getHighlight(runName, filePath, id)
}

export async function deleteHighlight(
  runName: string,
  filePath: string,
  id: string,
): Promise<boolean> {
  validateHtmlReaderTarget(runName, filePath)
  return withHtmlReaderDb((db) => {
    const result = db.query(
      "DELETE FROM library_notes WHERE run_name = ? AND file_path = ? AND id = ? AND kind = 'highlight'",
    ).run(runName, filePath, id)
    return result.changes > 0
  })
}

export async function getPageNotes(runName: string, filePath: string): Promise<string> {
  validateHtmlReaderTarget(runName, filePath)
  return withHtmlReaderDb((db) => {
    const row = db.query<{ body: string }, [string, string]>(
      "SELECT body FROM library_notes WHERE run_name = ? AND file_path = ? AND kind = 'page' LIMIT 1",
    ).get(runName, filePath)
    return row?.body ?? ""
  })
}

export async function setPageNotes(
  runName: string,
  filePath: string,
  notes: string,
): Promise<{ updatedAt: string }> {
  validateHtmlReaderTarget(runName, filePath)
  const updatedAt = nowIso()
  let createdNoteId: string | null = null
  await withHtmlReaderDb((db) => {
    if (!notes.trim()) {
      db.query(
        "DELETE FROM library_notes WHERE run_name = ? AND file_path = ? AND kind = 'page'",
      ).run(runName, filePath)
      return
    }

    const existing = db.query<{ id: string; created_at: string }, [string, string]>(
      "SELECT id, created_at FROM library_notes WHERE run_name = ? AND file_path = ? AND kind = 'page' LIMIT 1",
    ).get(runName, filePath)

    if (existing) {
      db.query(
        "UPDATE library_notes SET body = ?, updated_at = ? WHERE id = ?",
      ).run(notes, updatedAt, existing.id)
      return
    }

    createdNoteId = crypto.randomUUID()
    db.query(
      `INSERT INTO library_notes
       (id, kind, run_name, file_path, body, quote, prefix, suffix, color, created_at, updated_at)
       VALUES (?, 'page', ?, ?, ?, NULL, '', '', NULL, ?, ?)`,
    ).run(createdNoteId, runName, filePath, notes, updatedAt, updatedAt)
  })
  if (createdNoteId) {
    await inheritArticleTagsToNote(runName, createdNoteId)
  }
  return { updatedAt }
}

export function librarySourceLabel(source: LibrarySource): string {
  const topic = source.topic?.trim() || source.runName
  const file = basename(source.filePath)
  return `${topic} · ${file}`
}

export function excerptText(text: string, maxLength = 200): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength).trimEnd()}…`
}
