import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { filterRunsForIndex, listRuns } from "../src/view/data.ts"
import { renderIndex, renderRun } from "../src/view/pages.ts"
import {
  isRunUnread,
  listReadRunNames,
  listRunAccessTimes,
  listUnreadRunNames,
  setRunRead,
  touchRunAccess,
} from "../src/view/read-store.ts"
import { quorumDataPaths } from "../src/data-paths.ts"

let dir: string
let originalDataDir: string | undefined
let originalWorkspace: string | undefined
let originalOpencodeDir: string | undefined
let originalRunsDir: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-view-read-"))
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
  process.env.QUORUM_RUNS_DIR = join(dir, "runs")
  process.env.OPENCODE_DIRECTORY = dir
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

describe("view read store", () => {
  test("new runs are unread; setRunRead round-trips", async () => {
    expect(await listReadRunNames()).toEqual(new Set())
    expect(await isRunUnread("alpha-run")).toBe(true)
    expect(await listUnreadRunNames()).toEqual(new Set(["alpha-run", "beta-run"]))

    await setRunRead("alpha-run", true)
    expect(await isRunUnread("alpha-run")).toBe(false)
    expect(await listReadRunNames()).toEqual(new Set(["alpha-run"]))
    expect(await listUnreadRunNames()).toEqual(new Set(["beta-run"]))

    await setRunRead("alpha-run", false)
    expect(await isRunUnread("alpha-run")).toBe(true)
    expect(await listReadRunNames()).toEqual(new Set())
  })

  test("setRunRead blocks path traversal run names", async () => {
    await expect(setRunRead("../outside", true)).rejects.toThrow("Path traversal blocked")
  })

  test("migrates starred_runs: starred become unread, others become read", async () => {
    const dbPath = quorumDataPaths().configDb
    await mkdir(join(dir), { recursive: true })
    const db = new Database(dbPath, { create: true })
    db.run(`
CREATE TABLE starred_runs (
  run_name TEXT PRIMARY KEY,
  starred_at TEXT NOT NULL
);
    `)
    db.query("INSERT INTO starred_runs (run_name, starred_at) VALUES (?, ?)").run(
      "alpha-run",
      new Date().toISOString(),
    )
    db.close()

    expect(await isRunUnread("alpha-run")).toBe(true)
    expect(await isRunUnread("beta-run")).toBe(false)
    expect(await listUnreadRunNames()).toEqual(new Set(["alpha-run"]))
    expect(await listReadRunNames()).toEqual(new Set(["beta-run"]))

    const after = new Database(dbPath)
    const starredGone = after
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'starred_runs'",
      )
      .get()
    expect(starredGone?.count ?? 0).toBe(0)
    after.close()
  })

  test("touchRunAccess records last open time", async () => {
    expect(await listRunAccessTimes()).toEqual(new Map())
    await touchRunAccess("alpha-run")
    const times = await listRunAccessTimes()
    expect(times.has("alpha-run")).toBe(true)
    expect(times.get("alpha-run")).toBeGreaterThan(0)
    await expect(touchRunAccess("../outside")).rejects.toThrow("Path traversal blocked")
  })
})

describe("view unread index", () => {
  test("default index only includes unread runs", async () => {
    await setRunRead("beta-run", true)

    const unreadResponse = await renderIndex(new URLSearchParams())
    const unreadHtml = await unreadResponse.text()
    expect(unreadHtml).toContain("Alpha topic")
    expect(unreadHtml).not.toContain("Beta topic")
    expect(unreadHtml).toContain('href="/" class="active"')
    expect(unreadHtml).toContain(">Unread<")
    expect(unreadHtml).toContain('href="/?read=1"')
    expect(unreadHtml).toContain('data-run-name="alpha-run"')
    expect(unreadHtml).toContain('data-unread="true"')
    expect(unreadHtml).toContain("data-read-toggle")
    expect(unreadHtml).toContain(">Read</div>")
    expect(unreadHtml).toContain(">Unread</div>")
    expect(unreadHtml).not.toContain(">Approved</div>")
    expect(unreadHtml).not.toContain(">Running</div>")

    const allResponse = await renderIndex(new URLSearchParams("all=1"))
    const allHtml = await allResponse.text()
    expect(allHtml).toContain("Alpha topic")
    expect(allHtml).toContain("Beta topic")
    expect(allHtml).toContain('data-unread="true"')
    expect(allHtml).toContain('data-unread="false"')
    expect(allHtml).toContain('href="/?all=1" class="active"')
  })

  test("renderIndex unread filter shows empty state when none unread", async () => {
    await setRunRead("alpha-run", true)
    await setRunRead("beta-run", true)
    const response = await renderIndex(new URLSearchParams())
    const html = await response.text()
    expect(html).toContain("No unread runs")
    expect(html).toContain('href="/?read=1"')
  })

  test("read filter shows only read runs", async () => {
    await setRunRead("alpha-run", true)

    const readResponse = await renderIndex(new URLSearchParams("read=1"))
    const readHtml = await readResponse.text()
    expect(readHtml).toContain("Alpha topic")
    expect(readHtml).not.toContain("Beta topic")
    expect(readHtml).toContain('href="/?read=1" class="active"')

    await setRunRead("beta-run", true)
    await setRunRead("alpha-run", false)
    const readEmpty = await renderIndex(new URLSearchParams("read=1"))
    const readEmptyHtml = await readEmpty.text()
    expect(readEmptyHtml).toContain("Beta topic")
    expect(readEmptyHtml).not.toContain("Alpha topic")
  })

  test("filterRunsForIndex supports unread, read, and all", () => {
    const runs = [
      { name: "ok", topic: "Ok", status: "approved" as const, unread: false, mtime: 1, roundCount: 0, hasFinalHtml: false, hasFinalMd: true, hasLatestDraft: false, fileCount: 1, designStatus: null, designRoundCount: 0 },
      { name: "bad", topic: "Bad", status: "failed" as const, unread: false, mtime: 2, roundCount: 0, hasFinalHtml: false, hasFinalMd: false, hasLatestDraft: true, fileCount: 1, designStatus: null, designRoundCount: 0 },
      { name: "unread-bad", topic: "Unread bad", status: "failed" as const, unread: true, mtime: 3, roundCount: 0, hasFinalHtml: false, hasFinalMd: false, hasLatestDraft: true, fileCount: 1, designStatus: null, designRoundCount: 0 },
    ]
    const unread = filterRunsForIndex(runs, new URLSearchParams())
    expect(unread.runs.map((run) => run.name)).toEqual(["unread-bad"])
    expect(unread.showUnreadOnly).toBe(true)

    const read = filterRunsForIndex(runs, new URLSearchParams("read=1"))
    expect(read.runs.map((run) => run.name)).toEqual(["ok", "bad"])
    expect(read.showReadOnly).toBe(true)

    const all = filterRunsForIndex(runs, new URLSearchParams("all=1"))
    expect(all.runs).toHaveLength(3)
  })

  test("listRuns sorts by last accessed time", async () => {
    await touchRunAccess("beta-run")
    await new Promise((r) => setTimeout(r, 5))
    await touchRunAccess("alpha-run")

    const runs = await listRuns()
    expect(runs.map((r) => r.name)).toEqual(["alpha-run", "beta-run"])
    expect(runs[0]!.accessedAt).toBeGreaterThan(runs[1]!.accessedAt!)
  })

  test("renderRun records access time", async () => {
    const before = await listRunAccessTimes()
    expect(before.has("alpha-run")).toBe(false)

    const response = await renderRun("alpha-run")
    expect(response.status).toBe(200)

    const after = await listRunAccessTimes()
    expect(after.has("alpha-run")).toBe(true)
  })

  test("run cards show cost and elapsed placeholders", async () => {
    const response = await renderIndex(new URLSearchParams("all=1"))
    const html = await response.text()
    const metaMatch = html.match(/<div class="run-card-meta">([\s\S]*?)<\/div>/)
    expect(metaMatch?.[1]).toContain("—")
    expect(metaMatch?.[1]).not.toContain("file")
    expect(metaMatch?.[1]).not.toContain("round")
  })
})
