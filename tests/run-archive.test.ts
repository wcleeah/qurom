import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { renderFailureBanner } from "../src/view/components.ts"
import { listArchivedRuns } from "../src/view/data.ts"
import { renderIndex } from "../src/view/pages.ts"
import {
  archiveRunDirectory,
  getArchiveDir,
  getRunsDir,
  resolveArchiveRunName,
  safeArchivePath,
  safeRunPath,
  unarchiveRunDirectory,
} from "../src/view/paths.ts"
import { handleRunApi } from "../src/view/run-api.ts"
import { renderUnarchiveForm } from "../src/view/run-controls.ts"
import {
  initRunManager,
  resetRunManagerForTests,
} from "../src/run-manager.ts"
import type { LiveStatus } from "../src/view/types.ts"
import { READ_SCRIPT } from "../src/view/read-script.ts"

let dir: string
let originalDataDir: string | undefined
let originalRunsDir: string | undefined
let originalArchiveDir: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-run-archive-"))
  await mkdir(join(dir, "runs", "sample-run"), { recursive: true })
  await mkdir(join(dir, "archive"), { recursive: true })
  await writeFile(join(dir, "runs", "sample-run", "request.json"), JSON.stringify({ topic: "Sample" }))
  await writeFile(join(dir, "runs", "sample-run", "failure.json"), JSON.stringify({ error: "prior boom" }))

  originalDataDir = process.env.QUORUM_DATA_DIR
  originalRunsDir = process.env.QUORUM_RUNS_DIR
  originalArchiveDir = process.env.QUORUM_ARCHIVE_DIR
  process.env.QUORUM_DATA_DIR = dir
  process.env.QUORUM_RUNS_DIR = join(dir, "runs")
  process.env.QUORUM_ARCHIVE_DIR = join(dir, "archive")
  resetRunManagerForTests()
})

afterEach(async () => {
  resetRunManagerForTests()
  if (originalDataDir === undefined) delete process.env.QUORUM_DATA_DIR
  else process.env.QUORUM_DATA_DIR = originalDataDir
  if (originalRunsDir === undefined) delete process.env.QUORUM_RUNS_DIR
  else process.env.QUORUM_RUNS_DIR = originalRunsDir
  if (originalArchiveDir === undefined) delete process.env.QUORUM_ARCHIVE_DIR
  else process.env.QUORUM_ARCHIVE_DIR = originalArchiveDir
  await rm(dir, { recursive: true, force: true })
})

describe("archiveRunDirectory", () => {
  test("moves a run from runs/ into archive/", async () => {
    const archivedPath = await archiveRunDirectory("sample-run")
    expect(archivedPath).toBe(join(getArchiveDir(), "sample-run"))
    expect(await Bun.file(join(archivedPath, "request.json")).exists()).toBe(true)
    const runs = await readdir(getRunsDir())
    expect(runs).not.toContain("sample-run")
    expect(() => safeRunPath("../outside")).toThrow("Path traversal blocked")
  })

  test("uses a collision suffix when archive name already exists", async () => {
    await mkdir(join(getArchiveDir(), "sample-run"), { recursive: true })
    const archivedPath = await archiveRunDirectory("sample-run")
    expect(archivedPath.startsWith(join(getArchiveDir(), "sample-run-archived-"))).toBe(true)
    expect(await Bun.file(join(archivedPath, "request.json")).exists()).toBe(true)
  })
})

describe("POST /api/runs/:id/archive", () => {
  test("archives an idle run and redirects home", async () => {
    initRunManager({
      getConfig: async () => {
        throw new Error("unused")
      },
    })

    const req = new Request("http://localhost/api/runs/sample-run/archive", { method: "POST" })
    const res = await handleRunApi(req, "/api/runs/sample-run/archive", new URL(req.url))
    expect(res).toBeDefined()
    expect(res!.status).toBe(303)
    expect(res!.headers.get("Location")).toBe("/")
    expect(await Bun.file(join(getArchiveDir(), "sample-run", "request.json")).exists()).toBe(true)
  })

  test("rejects archiving the active managed run", async () => {
    const manager = initRunManager({
      getConfig: async () => {
        throw new Error("unused")
      },
    })
    const originalStatus = manager.status.bind(manager)
    manager.status = () => ({
      active: { runId: "sample-run" },
      actives: [{ runId: "sample-run" }],
      providers: originalStatus().providers,
    })

    const req = new Request("http://localhost/api/runs/sample-run/archive?json=1", { method: "POST" })
    const res = await handleRunApi(req, "/api/runs/sample-run/archive", new URL(req.url))
    expect(res).toBeDefined()
    expect(res!.status).toBe(409)
    const body = await res!.json() as { error: string }
    expect(body.error).toContain("Cannot archive an active run")
    expect(await Bun.file(join(getRunsDir(), "sample-run", "request.json")).exists()).toBe(true)
  })

  test("returns 404 for missing runs", async () => {
    initRunManager({
      getConfig: async () => {
        throw new Error("unused")
      },
    })
    const req = new Request("http://localhost/api/runs/missing-run/archive?json=1", { method: "POST" })
    const res = await handleRunApi(req, "/api/runs/missing-run/archive", new URL(req.url))
    expect(res).toBeDefined()
    expect(res!.status).toBe(404)
  })
})

describe("unarchiveRunDirectory", () => {
  test("moves a run from archive/ back into runs/", async () => {
    await archiveRunDirectory("sample-run")
    const restoredPath = await unarchiveRunDirectory("sample-run")
    expect(restoredPath).toBe(join(getRunsDir(), "sample-run"))
    expect(await Bun.file(join(restoredPath, "request.json")).exists()).toBe(true)
    const archived = await readdir(getArchiveDir())
    expect(archived).not.toContain("sample-run")
    expect(() => safeArchivePath("../outside")).toThrow("Path traversal blocked")
  })

  test("rejects when a run with the same name already exists", async () => {
    await mkdir(join(getArchiveDir(), "sample-run"), { recursive: true })
    await writeFile(join(getArchiveDir(), "sample-run", "request.json"), JSON.stringify({ topic: "Archived" }))
    await expect(unarchiveRunDirectory("sample-run")).rejects.toThrow('already exists')
  })
})

describe("POST /api/runs/:id/unarchive", () => {
  test("unarchives a run and redirects to its detail page", async () => {
    initRunManager({
      getConfig: async () => {
        throw new Error("unused")
      },
    })
    await archiveRunDirectory("sample-run")

    const req = new Request("http://localhost/api/runs/sample-run/unarchive", { method: "POST" })
    const res = await handleRunApi(req, "/api/runs/sample-run/unarchive", new URL(req.url))
    expect(res).toBeDefined()
    expect(res!.status).toBe(303)
    expect(res!.headers.get("Location")).toBe("/runs/sample-run")
    expect(await Bun.file(join(getRunsDir(), "sample-run", "request.json")).exists()).toBe(true)
    expect(await resolveArchiveRunName("sample-run")).toBeNull()
  })

  test("returns 409 when destination name already exists", async () => {
    initRunManager({
      getConfig: async () => {
        throw new Error("unused")
      },
    })
    await mkdir(join(getArchiveDir(), "other-run"), { recursive: true })
    await writeFile(join(getArchiveDir(), "other-run", "request.json"), JSON.stringify({ topic: "Other" }))
    await mkdir(join(getRunsDir(), "other-run"), { recursive: true })
    await writeFile(join(getRunsDir(), "other-run", "request.json"), JSON.stringify({ topic: "Live" }))

    const req = new Request("http://localhost/api/runs/other-run/unarchive?json=1", { method: "POST" })
    const res = await handleRunApi(req, "/api/runs/other-run/unarchive", new URL(req.url))
    expect(res).toBeDefined()
    expect(res!.status).toBe(409)
    const body = await res!.json() as { error: string }
    expect(body.error).toContain("already exists")
  })

  test("returns 404 for missing archived runs", async () => {
    initRunManager({
      getConfig: async () => {
        throw new Error("unused")
      },
    })
    const req = new Request("http://localhost/api/runs/missing-run/unarchive?json=1", { method: "POST" })
    const res = await handleRunApi(req, "/api/runs/missing-run/unarchive", new URL(req.url))
    expect(res).toBeDefined()
    expect(res!.status).toBe(404)
  })
})

describe("archived index", () => {
  test("lists archived runs and offers unarchive", async () => {
    await archiveRunDirectory("sample-run")
    const archived = await listArchivedRuns()
    expect(archived.map((run) => run.name)).toEqual(["sample-run"])
    expect(archived[0]?.topic).toBe("Sample")

    const response = await renderIndex(new URLSearchParams("archived=1"))
    const html = await response.text()
    expect(html).toContain('href="/?archived=1" class="active"')
    expect(html).toContain("Sample")
    expect(html).toContain("/api/runs/sample-run/unarchive")
    expect(html).toContain("Unarchive")
    expect(html).not.toContain('href="/runs/sample-run"')
  })

  test("renderUnarchiveForm posts to unarchive endpoint", () => {
    expect(renderUnarchiveForm("my-run-abc")).toContain("/api/runs/my-run-abc/unarchive")
    expect(renderUnarchiveForm("my-run-abc")).toContain("Unarchive")
  })
})

describe("renderFailureBanner while running", () => {
  test("hides failure banner when live phase is running", async () => {
    const liveStatus: LiveStatus = {
      phase: "running",
      node: "draftFullDraft",
      round: 0,
      maxRounds: 2,
      agents: {},
      nodeHistory: [],
    }
    const html = await renderFailureBanner("sample-run", ["failure.json", "latest-draft.md"], liveStatus)
    expect(html).toBe("")
  })

  test("shows failure banner when idle with failure artifacts", async () => {
    const html = await renderFailureBanner("sample-run", ["failure.json", "latest-draft.md"], null)
    expect(html).toContain("Run failed")
    expect(html).toContain("prior boom")
  })
})

describe("read script live button re-query", () => {
  test("re-queries the live read button after POST", () => {
    expect(READ_SCRIPT).toContain("liveReadButton")
    expect(READ_SCRIPT).toContain("querySelectorAll(\"[data-read-toggle]\")")
  })
})
