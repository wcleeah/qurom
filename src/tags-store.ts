import { join } from "node:path"

import type { ArticleTagEntry } from "./schema"
import { nowIso, withHtmlReaderDb } from "./view/html-reader-db"

export type TagRecord = {
  slug: string
  label: string
  source: "predefined" | "agent" | "user"
  createdAt: string
}

export type ArticleTagRecord = TagRecord & {
  articleSource: "agent" | "user"
}

export type NoteTagRecord = TagRecord & {
  noteSource: "propagated" | "user"
}

const TAG_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function normalizeTagSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function labelFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function parseTagInput(input: string): { slug: string; label: string } {
  const trimmed = input.trim()
  if (!trimmed) throw new Error("Tag is required")
  if (TAG_SLUG_RE.test(trimmed)) {
    return { slug: trimmed, label: labelFromSlug(trimmed) }
  }
  const slug = normalizeTagSlug(trimmed)
  if (!slug || !TAG_SLUG_RE.test(slug)) {
    throw new Error("Tag must contain letters or numbers")
  }
  return { slug, label: trimmed }
}

function rowToTag(row: {
  slug: string
  label: string
  source: string
  created_at: string
}): TagRecord {
  const source = row.source === "predefined" || row.source === "agent" || row.source === "user"
    ? row.source
    : "user"
  return {
    slug: row.slug,
    label: row.label,
    source,
    createdAt: row.created_at,
  }
}

export async function ensureTag(
  slug: string,
  label: string,
  source: TagRecord["source"],
): Promise<TagRecord> {
  const now = nowIso()
  return withHtmlReaderDb((db) => {
    db.query(
      `INSERT INTO tags (slug, label, source, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET label = excluded.label`,
    ).run(slug, label, source, now)
    const row = db.query<
      { slug: string; label: string; source: string; created_at: string },
      [string]
    >("SELECT slug, label, source, created_at FROM tags WHERE slug = ?").get(slug)
    if (!row) throw new Error(`Failed to upsert tag ${slug}`)
    return rowToTag(row)
  })
}

export async function listAllTags(): Promise<TagRecord[]> {
  return withHtmlReaderDb((db) => {
    const rows = db.query<
      { slug: string; label: string; source: string; created_at: string },
      []
    >("SELECT slug, label, source, created_at FROM tags ORDER BY slug ASC").all()
    return rows.map(rowToTag)
  })
}

export async function listArticleTags(runName: string): Promise<ArticleTagRecord[]> {
  return withHtmlReaderDb((db) => {
    const rows = db.query<
      {
        slug: string
        label: string
        source: string
        created_at: string
        article_source: string
      },
      [string]
    >(
      `SELECT t.slug, t.label, t.source, t.created_at, at.source AS article_source
       FROM article_tags at
       JOIN tags t ON t.slug = at.tag_slug
       WHERE at.run_name = ?
       ORDER BY t.slug ASC`,
    ).all(runName)
    return rows.map((row) => ({
      ...rowToTag(row),
      articleSource: row.article_source === "agent" ? "agent" : "user",
    }))
  })
}

export async function replaceAgentArticleTags(
  runName: string,
  tags: ArticleTagEntry[],
): Promise<ArticleTagRecord[]> {
  const now = nowIso()
  await withHtmlReaderDb((db) => {
    db.run("BEGIN")
    try {
      db.query("DELETE FROM article_tags WHERE run_name = ? AND source = 'agent'").run(runName)
      for (const tag of tags) {
        db.query(
          `INSERT INTO tags (slug, label, source, created_at)
           VALUES (?, ?, 'agent', ?)
           ON CONFLICT(slug) DO UPDATE SET label = excluded.label`,
        ).run(tag.slug, tag.label, now)
        db.query(
          `INSERT INTO article_tags (run_name, tag_slug, source, created_at)
           VALUES (?, ?, 'agent', ?)`,
        ).run(runName, tag.slug, now)
      }
      db.run("COMMIT")
    } catch (error) {
      db.run("ROLLBACK")
      throw error
    }
  })
  return listArticleTags(runName)
}

export async function addArticleTag(
  runName: string,
  input: string,
): Promise<ArticleTagRecord[]> {
  const { slug, label } = parseTagInput(input)
  const now = nowIso()
  await withHtmlReaderDb((db) => {
    db.query(
      `INSERT INTO tags (slug, label, source, created_at)
       VALUES (?, ?, 'user', ?)
       ON CONFLICT(slug) DO UPDATE SET label = excluded.label`,
    ).run(slug, label, now)
    db.query(
      `INSERT OR IGNORE INTO article_tags (run_name, tag_slug, source, created_at)
       VALUES (?, ?, 'user', ?)`,
    ).run(runName, slug, now)
  })
  return listArticleTags(runName)
}

export async function removeArticleTag(runName: string, slug: string): Promise<boolean> {
  return withHtmlReaderDb((db) => {
    const result = db.query(
      "DELETE FROM article_tags WHERE run_name = ? AND tag_slug = ? AND source = 'user'",
    ).run(runName, slug)
    return result.changes > 0
  })
}

export async function listNoteTags(noteId: string): Promise<NoteTagRecord[]> {
  return withHtmlReaderDb((db) => {
    const rows = db.query<
      {
        slug: string
        label: string
        source: string
        created_at: string
        note_source: string
      },
      [string]
    >(
      `SELECT t.slug, t.label, t.source, t.created_at, nt.source AS note_source
       FROM note_tags nt
       JOIN tags t ON t.slug = nt.tag_slug
       WHERE nt.note_id = ?
       ORDER BY t.slug ASC`,
    ).all(noteId)
    return rows.map((row) => ({
      ...rowToTag(row),
      noteSource: row.note_source === "propagated" ? "propagated" : "user",
    }))
  })
}

export async function addNoteTag(noteId: string, input: string, maxNoteTags: number): Promise<NoteTagRecord[]> {
  const existing = await listNoteTags(noteId)
  if (existing.length >= maxNoteTags) {
    throw new Error(`At most ${maxNoteTags} tags per note`)
  }
  const { slug, label } = parseTagInput(input)
  const now = nowIso()
  await withHtmlReaderDb((db) => {
    db.query(
      `INSERT INTO tags (slug, label, source, created_at)
       VALUES (?, ?, 'user', ?)
       ON CONFLICT(slug) DO UPDATE SET label = excluded.label`,
    ).run(slug, label, now)
    db.query(
      `INSERT OR IGNORE INTO note_tags (note_id, tag_slug, source, created_at)
       VALUES (?, ?, 'user', ?)`,
    ).run(noteId, slug, now)
  })
  return listNoteTags(noteId)
}

export async function removeNoteTag(noteId: string, slug: string, source?: "user" | "propagated"): Promise<boolean> {
  return withHtmlReaderDb((db) => {
    if (source) {
      const result = db.query(
        "DELETE FROM note_tags WHERE note_id = ? AND tag_slug = ? AND source = ?",
      ).run(noteId, slug, source)
      return result.changes > 0
    }
    const result = db.query(
      "DELETE FROM note_tags WHERE note_id = ? AND tag_slug = ?",
    ).run(noteId, slug)
    return result.changes > 0
  })
}

export async function propagateArticleTagsToNotes(runName: string): Promise<{ notesUpdated: number }> {
  const articleTags = await listArticleTags(runName)
  if (articleTags.length === 0) {
    return { notesUpdated: 0 }
  }
  const now = nowIso()
  return withHtmlReaderDb((db) => {
    const notes = db.query<{ id: string }, [string]>(
      "SELECT id FROM library_notes WHERE run_name = ?",
    ).all(runName)
    db.run("BEGIN")
    try {
      for (const note of notes) {
        db.query("DELETE FROM note_tags WHERE note_id = ? AND source = 'propagated'").run(note.id)
        for (const tag of articleTags) {
          const exists = db.query<{ count: number }, [string, string]>(
            "SELECT COUNT(*) AS count FROM note_tags WHERE note_id = ? AND tag_slug = ?",
          ).get(note.id, tag.slug)
          if ((exists?.count ?? 0) > 0) continue
          db.query(
            `INSERT INTO note_tags (note_id, tag_slug, source, created_at)
             VALUES (?, ?, 'propagated', ?)`,
          ).run(note.id, tag.slug, now)
        }
      }
      db.run("COMMIT")
    } catch (error) {
      db.run("ROLLBACK")
      throw error
    }
    return { notesUpdated: notes.length }
  })
}

export async function writeArticleTagsArtifact(
  outputPath: string,
  runName: string,
  tags: ArticleTagEntry[],
): Promise<void> {
  const payload = {
    runName,
    taggedAt: nowIso(),
    agent: "research-tagger",
    tags,
  }
  await Bun.write(join(outputPath, "tags.json"), JSON.stringify(payload, null, 2))
}

export async function syncPredefinedTags(predefinedTags: string[]): Promise<void> {
  const now = nowIso()
  await withHtmlReaderDb((db) => {
    for (const slug of predefinedTags) {
      db.query(
        `INSERT INTO tags (slug, label, source, created_at)
         VALUES (?, ?, 'predefined', ?)
         ON CONFLICT(slug) DO UPDATE SET source = 'predefined'`,
      ).run(slug, labelFromSlug(slug), now)
    }
  })
}
