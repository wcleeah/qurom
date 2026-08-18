import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { formatDate } from "../src/view/layout"
import { listRuns, resolveRunCreatedAtMs } from "../src/view/data"
import { renderIndex, renderRun } from "../src/view/pages"

describe("resolveRunCreatedAtMs", () => {
  test("prefers request.json createdAt over filesystem times", () => {
    expect(resolveRunCreatedAtMs({
      birthtimeMs: 100,
      ctimeMs: 200,
      mtimeMs: 300,
      requestCreatedAt: 1_700_000_000_000,
    })).toBe(1_700_000_000_000)
  })

  test("parses ISO createdAt and falls back to birthtime", () => {
    expect(resolveRunCreatedAtMs({
      birthtimeMs: 50,
      mtimeMs: 300,
      requestCreatedAt: "2024-01-02T03:04:05.000Z",
    })).toBe(Date.parse("2024-01-02T03:04:05.000Z"))

    expect(resolveRunCreatedAtMs({
      birthtimeMs: 50,
      mtimeMs: 300,
    })).toBe(50)
  })
})

describe("run create time on dashboard", () => {
  test("shows created time on index cards and the run page", async () => {
    const root = await mkdtemp(join(tmpdir(), "qurom-created-at-ui-"))
    const originalDataDir = process.env.QUORUM_DATA_DIR
    const originalRunsDir = process.env.QUORUM_RUNS_DIR
    process.env.QUORUM_DATA_DIR = root
    process.env.QUORUM_RUNS_DIR = join(root, "runs")
    try {
      const runDir = join(root, "runs", "created-run")
      await mkdir(runDir, { recursive: true })
      await writeFile(join(runDir, "request.json"), JSON.stringify({
        topic: "Created topic",
        createdAt: 1_700_000_000_000,
      }))

      const runs = await listRuns()
      expect(runs[0]?.createdAt).toBe(1_700_000_000_000)

      const index = await (await renderIndex(new URLSearchParams("all=1"))).text()
      expect(index).toContain("run-created")
      expect(index).toContain(formatDate(1_700_000_000_000))

      const detail = await (await renderRun("created-run")).text()
      expect(detail).toContain("Created:")
      expect(detail).toContain("run-created")
    } finally {
      if (originalDataDir === undefined) delete process.env.QUORUM_DATA_DIR
      else process.env.QUORUM_DATA_DIR = originalDataDir
      if (originalRunsDir === undefined) delete process.env.QUORUM_RUNS_DIR
      else process.env.QUORUM_RUNS_DIR = originalRunsDir
      await rm(root, { recursive: true, force: true })
    }
  })
})
