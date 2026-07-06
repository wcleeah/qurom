import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { renderLibraryPage } from "../src/view/library-page.ts"
import {
  createHighlight,
  resolveLibrarySource,
  setPageNotes,
} from "../src/view/library-notes-store.ts"

let dir: string
let originalDataDir: string | undefined
let originalRunsDir: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-library-page-"))
  await mkdir(join(dir, "runs", "alpha-run"), { recursive: true })
  await writeFile(join(dir, "runs", "alpha-run", "final.html"), "<html><body>Hello</body></html>")
  await writeFile(
    join(dir, "runs", "alpha-run", "request.json"),
    JSON.stringify({ topic: "What is MLX?" }),
  )

  originalDataDir = process.env.QUORUM_DATA_DIR
  originalRunsDir = process.env.QUORUM_RUNS_DIR
  process.env.QUORUM_DATA_DIR = dir
  process.env.QUORUM_RUNS_DIR = join(dir, "runs")
})

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.QUORUM_DATA_DIR
  else process.env.QUORUM_DATA_DIR = originalDataDir
  if (originalRunsDir === undefined) delete process.env.QUORUM_RUNS_DIR
  else process.env.QUORUM_RUNS_DIR = originalRunsDir
  await rm(dir, { recursive: true, force: true })
})

describe("library page", () => {
  test("renders highlights, page notes, and source links", async () => {
    await createHighlight({
      runName: "alpha-run",
      filePath: "final.html",
      color: "yellow",
      quote: "Hello world",
    })
    await setPageNotes("alpha-run", "final.html", "Overall thoughts")

    const resp = await renderLibraryPage()
    const html = await resp.text()

    expect(html).toContain("Library")
    expect(html).toContain("/library")
    expect(html).toContain("Hello world")
    expect(html).toContain("Overall thoughts")
    expect(html).toContain("What is MLX?")
    expect(html).toContain("/runs/alpha-run/raw/final.html")
    expect(html).toContain("Page note")
  })

  test("shows source deleted when run is missing", async () => {
    await createHighlight({
      runName: "ghost-run",
      filePath: "final.html",
      color: "pink",
      quote: "Orphan quote",
    })

    const resp = await renderLibraryPage()
    const html = await resp.text()

    expect(html).toContain("Orphan quote")
    expect(html).toContain("(source deleted)")
    expect(html).not.toContain("/runs/ghost-run/raw/final.html")
  })

  test("resolveLibrarySource marks missing files dead", async () => {
    const alive = await resolveLibrarySource("alpha-run", "final.html")
    expect(alive.alive).toBe(true)
    expect(alive.topic).toBe("What is MLX?")

    const dead = await resolveLibrarySource("alpha-run", "missing.html")
    expect(dead.alive).toBe(false)
  })
})
