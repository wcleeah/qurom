import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { assertSafeStaticOutput, exportStaticSite } from "../src/view/static-export"

let root: string
let runsDir: string
let outputDir: string
let originalRunsDir: string | undefined
let originalDataDir: string | undefined

async function createRun(name: string, files: Record<string, string>) {
  const runDir = join(runsDir, name)
  await mkdir(runDir, { recursive: true })
  for (const [file, content] of Object.entries(files)) {
    await writeFile(join(runDir, file), content)
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "qurom-static-export-"))
  runsDir = join(root, "runs")
  outputDir = join(root, "site")
  await mkdir(runsDir, { recursive: true })
  originalRunsDir = process.env.QUORUM_RUNS_DIR
  originalDataDir = process.env.QUORUM_DATA_DIR
  process.env.QUORUM_RUNS_DIR = runsDir
  process.env.QUORUM_DATA_DIR = root
})

afterEach(async () => {
  if (originalRunsDir === undefined) delete process.env.QUORUM_RUNS_DIR
  else process.env.QUORUM_RUNS_DIR = originalRunsDir
  if (originalDataDir === undefined) delete process.env.QUORUM_DATA_DIR
  else process.env.QUORUM_DATA_DIR = originalDataDir
  await rm(root, { recursive: true, force: true })
})

describe("static successful-run export", () => {
  test("exports only approved runs and preserves final html exactly", async () => {
    const published = "<!doctype html><html><body><script>window.ok=true</script></body></html>"
    await createRun("published-run-abc", {
      "request.json": JSON.stringify({ topic: "Published topic" }),
      "summary.json": JSON.stringify({ title: "Published topic", summary: "A concise result." }),
      "final.md": "# Approved",
      "final.html": published,
      "draft-round-0.md": "draft",
    })
    await createRun("failed-run-def", {
      "request.json": JSON.stringify({ topic: "Failed topic" }),
      "latest-draft.md": "draft",
      "failure.json": "{}",
    })

    const result = await exportStaticSite(outputDir)

    expect(result.runCount).toBe(1)
    const index = await readFile(join(outputDir, "index.html"), "utf8")
    expect(index).toContain("Published topic")
    expect(index).toContain("A concise result.")
    expect(index).not.toContain("Failed topic")
    expect(index).toContain('href="runs/published-run-abc/"')
    const detail = await readFile(join(outputDir, "runs", "published-run-abc", "index.html"), "utf8")
    expect(detail).toContain('href="share/"')
    expect(detail).toContain('href="../../"')
    expect(await readFile(join(outputDir, "runs", "published-run-abc", "share", "index.html"), "utf8")).toBe(published)
  })

  test("replaces stale export contents", async () => {
    await mkdir(outputDir, { recursive: true })
    await writeFile(join(outputDir, ".qurom-static-export"), "owned")
    await writeFile(join(outputDir, "stale.txt"), "old")
    await exportStaticSite(outputDir)
    expect(await Bun.file(join(outputDir, "stale.txt")).exists()).toBe(false)
    expect(await Bun.file(join(outputDir, "index.html")).exists()).toBe(true)
  })

  test("does not replace a non-export directory", async () => {
    await mkdir(outputDir, { recursive: true })
    await writeFile(join(outputDir, "keep.txt"), "user content")
    await expect(exportStaticSite(outputDir)).rejects.toThrow("Refusing to replace non-export directory")
    expect(await readFile(join(outputDir, "keep.txt"), "utf8")).toBe("user content")
  })

  test("rejects output paths that overlap run storage", () => {
    expect(() => assertSafeStaticOutput(runsDir)).toThrow("unsafe static export path")
    expect(() => assertSafeStaticOutput(join(runsDir, "site"))).toThrow("must not contain")
    expect(() => assertSafeStaticOutput(root)).toThrow("must not contain")
  })
})
