import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { openHtmlReaderDb } from "../src/view/html-reader-db.ts"
import {
  listSchemaMigrationPreviews,
  runSchemaMigration,
} from "../src/view/schema-migrations.ts"
import {
  createHighlight,
  getPageNotes,
  listAllLibraryNotes,
  listHighlights,
  setPageNotes,
} from "../src/view/library-notes-store.ts"

let dir: string
let originalDataDir: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-schema-migrations-"))
  await mkdir(join(dir, "runs", "alpha-run"), { recursive: true })
  await writeFile(join(dir, "runs", "alpha-run", "final.html"), "<html><body>Hello</body></html>")
  await writeFile(
    join(dir, "runs", "alpha-run", "request.json"),
    JSON.stringify({ topic: "What is MLX?" }),
  )

  originalDataDir = process.env.QUORUM_DATA_DIR
  process.env.QUORUM_DATA_DIR = dir
})

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.QUORUM_DATA_DIR
  else process.env.QUORUM_DATA_DIR = originalDataDir
  await rm(dir, { recursive: true, force: true })
})

function dbPath() {
  return join(dir, "quorum-config.sqlite")
}

describe("library-notes-v1 migration", () => {
  test("preview is pending when legacy rows are unmigrated", () => {
    const db = openHtmlReaderDb(dbPath())
    try {
      db.query(
        `INSERT INTO html_reader_highlights
         (id, run_name, file_path, color, quote, prefix, suffix, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("hl-1", "alpha-run", "final.html", "yellow", "Hello", "", "", "note", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z")
      db.query(
        "INSERT INTO html_reader_notes (run_name, file_path, notes, updated_at) VALUES (?, ?, ?, ?)",
      ).run("alpha-run", "final.html", "Page thoughts", "2026-01-03T00:00:00.000Z")

      const [preview] = listSchemaMigrationPreviews(db)
      expect(preview?.status).toBe("pending")
      expect(preview?.pendingCounts).toEqual({ highlights: 1, pageNotes: 1 })
    } finally {
      db.close()
    }
  })

  test("run copies legacy rows and preserves highlight ids", () => {
    const db = openHtmlReaderDb(dbPath())
    try {
      db.query(
        `INSERT INTO html_reader_highlights
         (id, run_name, file_path, color, quote, prefix, suffix, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("hl-1", "alpha-run", "final.html", "blue", "Quoted", "p", "s", "My note", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z")
      db.query(
        "INSERT INTO html_reader_notes (run_name, file_path, notes, updated_at) VALUES (?, ?, ?, ?)",
      ).run("alpha-run", "final.html", "Page thoughts", "2026-01-03T00:00:00.000Z")

      const result = runSchemaMigration(db, "library-notes-v1")
      expect(result.ok).toBe(true)
      expect(result.counts).toEqual({ highlights: 1, pageNotes: 1 })

      const highlight = db.query<{ id: string; body: string; quote: string }, []>(
        "SELECT id, body, quote FROM library_notes WHERE kind = 'highlight'",
      ).get()
      expect(highlight?.id).toBe("hl-1")
      expect(highlight?.body).toBe("My note")
      expect(highlight?.quote).toBe("Quoted")

      const page = db.query<{ body: string }, []>(
        "SELECT body FROM library_notes WHERE kind = 'page'",
      ).get()
      expect(page?.body).toBe("Page thoughts")

      const second = runSchemaMigration(db, "library-notes-v1")
      expect(second.ok).toBe(true)
      expect(second.counts).toEqual({ highlights: 0, pageNotes: 0 })

      const [preview] = listSchemaMigrationPreviews(db)
      expect(preview?.status).toBe("complete")
    } finally {
      db.close()
    }
  })

  test("store reads migrated and new rows from library_notes", async () => {
    const db = openHtmlReaderDb(dbPath())
    db.query(
      `INSERT INTO html_reader_highlights
       (id, run_name, file_path, color, quote, prefix, suffix, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("hl-1", "alpha-run", "final.html", "yellow", "Hello", "", "", "", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
    db.close()

    const migrateDb = openHtmlReaderDb(dbPath())
    runSchemaMigration(migrateDb, "library-notes-v1")
    migrateDb.close()

    const highlights = await listHighlights("alpha-run", "final.html")
    expect(highlights).toHaveLength(1)
    expect(highlights[0]?.id).toBe("hl-1")

    await setPageNotes("alpha-run", "final.html", "Fresh page note")
    expect(await getPageNotes("alpha-run", "final.html")).toBe("Fresh page note")

    const created = await createHighlight({
      runName: "alpha-run",
      filePath: "final.html",
      color: "green",
      quote: "New",
    })
    const all = await listAllLibraryNotes()
    expect(all.some((note) => note.id === created.id)).toBe(true)
  })
})
