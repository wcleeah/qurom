import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  getHtmlReaderNotes,
  setHtmlReaderNotes,
} from "../src/view/html-notes-store.ts"
import { renderHtmlViewerPage } from "../src/view/html-viewer.ts"
import { serveRawFile } from "../src/view/pages.ts"

let dir: string
let originalConfigDbPath: string | undefined
let originalWorkspace: string | undefined
let originalOpencodeDir: string | undefined
let originalRunsDir: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-view-html-notes-"))
  await mkdir(join(dir, "runs", "alpha-run"), { recursive: true })
  await writeFile(join(dir, "runs", "alpha-run", "final.html"), "<html><body>Hello</body></html>")

  originalConfigDbPath = process.env.QUORUM_CONFIG_DB_PATH
  originalWorkspace = process.env.QUORUM_WORKSPACE_DIRECTORY
  originalOpencodeDir = process.env.OPENCODE_DIRECTORY
  originalRunsDir = process.env.QUORUM_RUNS_DIR
  process.env.QUORUM_CONFIG_DB_PATH = join(dir, "runs", "quorum-config.sqlite")
  process.env.QUORUM_WORKSPACE_DIRECTORY = dir
  process.env.OPENCODE_DIRECTORY = dir
  process.env.QUORUM_RUNS_DIR = join(dir, "runs")
})

afterEach(async () => {
  if (originalConfigDbPath === undefined) delete process.env.QUORUM_CONFIG_DB_PATH
  else process.env.QUORUM_CONFIG_DB_PATH = originalConfigDbPath
  if (originalWorkspace === undefined) delete process.env.QUORUM_WORKSPACE_DIRECTORY
  else process.env.QUORUM_WORKSPACE_DIRECTORY = originalWorkspace
  if (originalOpencodeDir === undefined) delete process.env.OPENCODE_DIRECTORY
  else process.env.OPENCODE_DIRECTORY = originalOpencodeDir
  if (originalRunsDir === undefined) delete process.env.QUORUM_RUNS_DIR
  else process.env.QUORUM_RUNS_DIR = originalRunsDir
  await rm(dir, { recursive: true, force: true })
})

describe("html reader notes store", () => {
  test("getHtmlReaderNotes and setHtmlReaderNotes round-trip", async () => {
    expect(await getHtmlReaderNotes("alpha-run", "final.html")).toBe("")
    await setHtmlReaderNotes("alpha-run", "final.html", "Interesting section on quorum reads")
    expect(await getHtmlReaderNotes("alpha-run", "final.html")).toBe("Interesting section on quorum reads")
  })

  test("rejects non-html files", async () => {
    await expect(setHtmlReaderNotes("alpha-run", "request.json", "nope")).rejects.toThrow(
      "Only HTML files support reader annotations",
    )
  })

  test("rejects path traversal", async () => {
    await expect(getHtmlReaderNotes("../outside", "final.html")).rejects.toThrow("Path traversal blocked")
  })
})

describe("html viewer page", () => {
  test("renders iframe shell with navbar, download, and notes sidebar", () => {
    const html = renderHtmlViewerPage("alpha-run", "final.html", "Saved note", [])

    expect(html).toContain('class="html-viewer-shell"')
    expect(html).toContain('class="html-viewer-navbar"')
    expect(html).toContain("← Back to run")
    expect(html).toContain("/runs/alpha-run")
    expect(html).toContain('class="html-viewer-frame"')
    expect(html).toContain("/runs/alpha-run/raw/final.html?source=1")
    expect(html).toContain("download=1")
    expect(html).toContain('data-html-notes-input')
    expect(html).toContain("Saved note")
    expect(html).toContain("data-html-save-indicator")
    expect(html).toContain("data-html-tab=\"highlights\"")
    expect(html).toContain("data-html-sidebar-toggle")
    expect(html).toContain("data-html-sidebar-close")
  })
})

describe("serveRawFile html handling", () => {
  test("returns viewer shell by default for html files", async () => {
    const resp = await serveRawFile("alpha-run", "final.html", new URLSearchParams())
    const html = await resp.text()

    expect(resp.headers.get("content-type")).toContain("text/html")
    expect(html).toContain('class="html-viewer-frame"')
    expect(html).toContain("← Back to run")
  })

  test("returns raw html with ?source=1", async () => {
    const resp = await serveRawFile("alpha-run", "final.html", new URLSearchParams("source=1"))
    const body = await resp.text()

    expect(body).toBe("<html><body>Hello</body></html>")
    expect(resp.headers.get("content-disposition")).toBeNull()
  })

  test("sets attachment header with ?source=1&download=1", async () => {
    const resp = await serveRawFile(
      "alpha-run",
      "final.html",
      new URLSearchParams("source=1&download=1"),
    )

    expect(resp.headers.get("content-disposition")).toContain("attachment")
    expect(resp.headers.get("content-disposition")).toContain("final.html")
  })
})
