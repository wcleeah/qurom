import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  getHtmlReaderProgress,
  setHtmlReaderProgress,
} from "../src/view/html-progress-store.ts"
import { renderHtmlViewerPage } from "../src/view/html-viewer.ts"
import { serveRawFile } from "../src/view/pages.ts"

let dir: string
let originalDataDir: string | undefined
let originalWorkspace: string | undefined
let originalOpencodeDir: string | undefined
let originalRunsDir: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-view-html-progress-"))
  await mkdir(join(dir, "runs", "alpha-run"), { recursive: true })
  await writeFile(
    join(dir, "runs", "alpha-run", "final.html"),
    "<html><body style=\"height:4000px\">Hello</body></html>",
  )

  originalDataDir = process.env.QUORUM_DATA_DIR
  originalWorkspace = process.env.QUORUM_WORKSPACE_DIRECTORY
  originalOpencodeDir = process.env.OPENCODE_DIRECTORY
  originalRunsDir = process.env.QUORUM_RUNS_DIR
  process.env.QUORUM_DATA_DIR = dir
  process.env.QUORUM_WORKSPACE_DIRECTORY = dir
  process.env.OPENCODE_DIRECTORY = dir
  process.env.QUORUM_RUNS_DIR = join(dir, "runs")
})

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.QUORUM_DATA_DIR
  else process.env.QUORUM_DATA_DIR = originalDataDir
  if (originalWorkspace === undefined) delete process.env.QUORUM_WORKSPACE_DIRECTORY
  else process.env.QUORUM_WORKSPACE_DIRECTORY = originalWorkspace
  if (originalOpencodeDir === undefined) delete process.env.OPENCODE_DIRECTORY
  else process.env.OPENCODE_DIRECTORY = originalOpencodeDir
  if (originalRunsDir === undefined) delete process.env.QUORUM_RUNS_DIR
  else process.env.QUORUM_RUNS_DIR = originalRunsDir
  await rm(dir, { recursive: true, force: true })
})

describe("html reader progress store", () => {
  test("getHtmlReaderProgress and setHtmlReaderProgress round-trip", async () => {
    expect(await getHtmlReaderProgress("alpha-run", "final.html")).toBeNull()
    const saved = await setHtmlReaderProgress({
      runName: "alpha-run",
      filePath: "final.html",
      scrollY: 420.5,
      scrollRatio: 0.37,
    })
    expect(saved.scrollY).toBe(420.5)
    expect(saved.scrollRatio).toBe(0.37)
    expect(saved.updatedAt).toBeTruthy()

    const loaded = await getHtmlReaderProgress("alpha-run", "final.html")
    expect(loaded).not.toBeNull()
    expect(loaded!.scrollY).toBe(420.5)
    expect(loaded!.scrollRatio).toBe(0.37)
  })

  test("clamps invalid scroll values", async () => {
    const saved = await setHtmlReaderProgress({
      runName: "alpha-run",
      filePath: "final.html",
      scrollY: -12,
      scrollRatio: 1.8,
    })
    expect(saved.scrollY).toBe(0)
    expect(saved.scrollRatio).toBe(1)
  })

  test("upserts the same run/file row", async () => {
    await setHtmlReaderProgress({
      runName: "alpha-run",
      filePath: "final.html",
      scrollY: 10,
      scrollRatio: 0.1,
    })
    await setHtmlReaderProgress({
      runName: "alpha-run",
      filePath: "final.html",
      scrollY: 88,
      scrollRatio: 0.55,
    })
    const loaded = await getHtmlReaderProgress("alpha-run", "final.html")
    expect(loaded!.scrollY).toBe(88)
    expect(loaded!.scrollRatio).toBe(0.55)
  })

  test("rejects non-html files", async () => {
    await expect(setHtmlReaderProgress({
      runName: "alpha-run",
      filePath: "request.json",
      scrollY: 1,
      scrollRatio: 0.1,
    })).rejects.toThrow("Only HTML files support reader annotations")
  })
})

describe("html viewer progress wiring", () => {
  test("embeds saved progress and client restore script", async () => {
    const progress = await setHtmlReaderProgress({
      runName: "alpha-run",
      filePath: "final.html",
      scrollY: 250,
      scrollRatio: 0.42,
    })
    const html = renderHtmlViewerPage(
      "alpha-run",
      "final.html",
      "",
      [],
      [],
      "",
      {},
      [],
      [],
      progress,
    )

    expect(html).toContain('data-html-progress-root')
    expect(html).toContain('data-scroll-y="250"')
    expect(html).toContain('data-scroll-ratio="0.42"')
    expect(html).toContain("/runs/alpha-run/html-progress")
    expect(html).toContain("findScrollRoot")
  })

  test("serveRawFile includes persisted progress in the viewer shell", async () => {
    await setHtmlReaderProgress({
      runName: "alpha-run",
      filePath: "final.html",
      scrollY: 333,
      scrollRatio: 0.25,
    })
    const resp = await serveRawFile("alpha-run", "final.html", new URLSearchParams())
    const html = await resp.text()
    expect(html).toContain('data-html-progress-root')
    expect(html).toContain('data-scroll-y="333"')
    expect(html).toContain('data-scroll-ratio="0.25"')
  })

  test("defaults to top when no progress exists", async () => {
    const resp = await serveRawFile("alpha-run", "final.html", new URLSearchParams())
    const html = await resp.text()
    expect(html).toContain('data-html-progress-root')
    expect(html).toContain('data-scroll-y="0"')
    expect(html).toContain('data-scroll-ratio="0"')
  })
})
