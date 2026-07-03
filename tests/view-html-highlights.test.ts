import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createHtmlReaderHighlight,
  deleteHtmlReaderHighlight,
  HIGHLIGHT_COLORS,
  listHtmlReaderHighlights,
} from "../src/view/html-highlights-store.ts"
import { renderHtmlViewerPage } from "../src/view/html-viewer.ts"

let dir: string
let originalConfigDbPath: string | undefined
let originalWorkspace: string | undefined
let originalOpencodeDir: string | undefined
let originalRunsDir: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-view-html-highlights-"))
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

describe("html reader highlights store", () => {
  test("create, list, and delete highlights", async () => {
    expect(await listHtmlReaderHighlights("alpha-run", "final.html")).toEqual([])

    const created = await createHtmlReaderHighlight({
      runName: "alpha-run",
      filePath: "final.html",
      color: "yellow",
      quote: "Hello",
      prefix: "<body>",
      suffix: "",
    })

    expect(created.quote).toBe("Hello")
    expect(HIGHLIGHT_COLORS).toContain(created.color)

    const listed = await listHtmlReaderHighlights("alpha-run", "final.html")
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(created.id)

    expect(await deleteHtmlReaderHighlight("alpha-run", "final.html", created.id)).toBe(true)
    expect(await listHtmlReaderHighlights("alpha-run", "final.html")).toEqual([])
  })

  test("rejects empty quote and invalid color", async () => {
    await expect(createHtmlReaderHighlight({
      runName: "alpha-run",
      filePath: "final.html",
      color: "yellow",
      quote: "   ",
    })).rejects.toThrow("Highlight quote is required")

    await expect(createHtmlReaderHighlight({
      runName: "alpha-run",
      filePath: "final.html",
      color: "purple",
      quote: "Hello",
    })).rejects.toThrow("Invalid highlight color")
  })

  test("rejects non-html files and path traversal", async () => {
    await expect(createHtmlReaderHighlight({
      runName: "alpha-run",
      filePath: "request.json",
      color: "yellow",
      quote: "Hello",
    })).rejects.toThrow("Only HTML files support reader annotations")

    await expect(listHtmlReaderHighlights("../outside", "final.html")).rejects.toThrow("Path traversal blocked")
  })
})

describe("html viewer highlights UI", () => {
  test("highlightsToJson escapes quotes for HTML attributes", async () => {
    const { highlightsToJson } = await import("../src/view/html-viewer-highlights.ts")
    const json = highlightsToJson([{
      id: "abc",
      runName: "run",
      filePath: "final.html",
      color: "yellow",
      quote: 'Say "hello"',
      prefix: "",
      suffix: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }])
    expect(json).toContain("&quot;")
    expect(json).not.toContain('":"Say "')
    const parsed = JSON.parse(json.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"))
    expect(parsed[0]?.quote).toBe('Say "hello"')
  })

  test("renders tabbed highlights panel with embedded highlight data", async () => {
    const highlight = await createHtmlReaderHighlight({
      runName: "alpha-run",
      filePath: "final.html",
      color: "blue",
      quote: 'Say "hello" and 65% C++',
      prefix: "",
      suffix: "",
    })

    const html = renderHtmlViewerPage("alpha-run", "final.html", "", [highlight])

    expect(html).toContain('data-html-tab="highlights"')
    expect(html).toContain('data-html-panel="highlights"')
    expect(html).toContain("data-html-highlight-list")
    expect(html).toContain("data-html-highlight-selection")
    expect(html).not.toContain('data-highlights="[{"')
    expect(html).toContain("&quot;id&quot;")
    expect(html).toContain("Hide panel")
  })
})
