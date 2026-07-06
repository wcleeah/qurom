import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { openHtmlReaderDb } from "../src/view/html-reader-db.ts"
import { renderConfigMigrate } from "../src/view/config-migrate.ts"

let dir: string
let originalDataDir: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-config-migrate-"))
  await mkdir(join(dir, "runs", "alpha-run"), { recursive: true })
  originalDataDir = process.env.QUORUM_DATA_DIR
  process.env.QUORUM_DATA_DIR = dir

  const db = openHtmlReaderDb(join(dir, "quorum-config.sqlite"))
  db.query(
    `INSERT INTO html_reader_highlights
     (id, run_name, file_path, color, quote, prefix, suffix, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("hl-1", "alpha-run", "final.html", "yellow", "Hello", "", "", "", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
  db.close()
})

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.QUORUM_DATA_DIR
  else process.env.QUORUM_DATA_DIR = originalDataDir
  await rm(dir, { recursive: true, force: true })
})

describe("config migrate page", () => {
  test("renders library-notes-v1 migration card", async () => {
    const resp = await renderConfigMigrate()
    const html = await resp.text()

    expect(html).toContain("Schema migrations")
    expect(html).toContain("library-notes-v1")
    expect(html).toContain("Library notes")
    expect(html).toContain("Run migration")
    expect(html).toContain('name="migrationId"')
    expect(html).toContain("Pending")
  })
})
