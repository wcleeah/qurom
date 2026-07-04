import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { renderIndex } from "../src/view/pages.ts"
import {
  isRunStarred,
  listStarredRunNames,
  setRunStarred,
} from "../src/view/starred-store.ts"

let dir: string
let originalDataDir: string | undefined
let originalWorkspace: string | undefined
let originalOpencodeDir: string | undefined
let originalRunsDir: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-view-starred-"))
  await mkdir(join(dir, "runs", "alpha-run"), { recursive: true })
  await mkdir(join(dir, "runs", "beta-run"), { recursive: true })
  await writeFile(join(dir, "runs", "alpha-run", "request.json"), JSON.stringify({ topic: "Alpha topic" }))
  await writeFile(join(dir, "runs", "beta-run", "request.json"), JSON.stringify({ topic: "Beta topic" }))

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

describe("view starred store", () => {
  test("setRunStarred and listStarredRunNames round-trip", async () => {
    expect(await listStarredRunNames()).toEqual(new Set())
    expect(await isRunStarred("alpha-run")).toBe(false)

    await setRunStarred("alpha-run", true)
    expect(await isRunStarred("alpha-run")).toBe(true)
    expect(await listStarredRunNames()).toEqual(new Set(["alpha-run"]))

    await setRunStarred("alpha-run", false)
    expect(await isRunStarred("alpha-run")).toBe(false)
    expect(await listStarredRunNames()).toEqual(new Set())
  })

  test("setRunStarred blocks path traversal run names", async () => {
    await expect(setRunStarred("../outside", true)).rejects.toThrow("Path traversal blocked")
  })
})

describe("view starred index", () => {
  test("renderIndex with starred=1 only includes starred runs", async () => {
    await setRunStarred("alpha-run", true)

    const allResponse = await renderIndex(new URLSearchParams())
    const allHtml = await allResponse.text()
    expect(allHtml).toContain("Alpha topic")
    expect(allHtml).toContain("Beta topic")
    expect(allHtml).toContain('data-run-name="alpha-run"')
    expect(allHtml).toContain('data-starred="true"')
    expect(allHtml).toContain('data-starred="false"')

    const starredResponse = await renderIndex(new URLSearchParams("starred=1"))
    const starredHtml = await starredResponse.text()
    expect(starredHtml).toContain("Alpha topic")
    expect(starredHtml).not.toContain("Beta topic")
    expect(starredHtml).toContain('href="/?starred=1" class="active"')
    expect(starredHtml).toContain("data-star-toggle")
  })

  test("renderIndex starred filter shows empty state when none starred", async () => {
    const response = await renderIndex(new URLSearchParams("starred=1"))
    const html = await response.text()
    expect(html).toContain("No starred runs yet")
    expect(html).toContain('href="/"')
  })
})
