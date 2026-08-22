import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  deriveOverallRunStatus,
  deriveResearchStatus,
  listRuns,
} from "../src/view/data.ts"
import { renderIndex, renderRun } from "../src/view/pages.ts"

describe("deriveResearchStatus", () => {
  test("treats leftover latest-draft as failed only when the run is not live", () => {
    expect(deriveResearchStatus({ hasFinalMd: false, hasLatestDraft: true })).toBe("failed")
    expect(deriveResearchStatus({
      hasFinalMd: false,
      hasLatestDraft: true,
      hasFailureJson: true,
      livePhase: "running",
    })).toBe("running")
  })

  test("keeps approved research even while other artifacts remain", () => {
    expect(deriveResearchStatus({
      hasFinalMd: true,
      hasLatestDraft: true,
      livePhase: "running",
    })).toBe("approved")
  })
})

describe("deriveOverallRunStatus", () => {
  test("live running wins over leftover research or design failure", () => {
    expect(deriveOverallRunStatus({
      researchStatus: "failed",
      designStatus: null,
      livePhase: "running",
    })).toBe("running")
    expect(deriveOverallRunStatus({
      researchStatus: "approved",
      designStatus: "failed",
      livePhase: "running",
    })).toBe("running")
  })
})

describe("list vs detail status after resume", () => {
  let dir = ""
  let originalDataDir: string | undefined
  let originalRunsDir: string | undefined

  afterEach(async () => {
    if (originalDataDir === undefined) delete process.env.QUORUM_DATA_DIR
    else process.env.QUORUM_DATA_DIR = originalDataDir
    if (originalRunsDir === undefined) delete process.env.QUORUM_RUNS_DIR
    else process.env.QUORUM_RUNS_DIR = originalRunsDir
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  async function withRunDir() {
    dir = await mkdtemp(join(tmpdir(), "qurom-index-status-"))
    originalDataDir = process.env.QUORUM_DATA_DIR
    originalRunsDir = process.env.QUORUM_RUNS_DIR
    process.env.QUORUM_DATA_DIR = dir
    process.env.QUORUM_RUNS_DIR = join(dir, "runs")
    const runDir = join(dir, "runs", "photo-run")
    await mkdir(runDir, { recursive: true })
    return runDir
  }

  test("listRuns shows failed when a prior draft remains and the run is idle", async () => {
    const runDir = await withRunDir()
    await writeFile(join(runDir, "request.json"), JSON.stringify({ topic: "Photography" }))
    await writeFile(join(runDir, "latest-draft.md"), "stale draft")
    await writeFile(join(runDir, "run-status.json"), JSON.stringify({
      phase: "error",
      round: 0,
      maxRounds: 10,
      agents: {},
      nodeHistory: [],
    }))

    const runs = await listRuns()
    expect(runs[0]?.status).toBe("failed")
  })

  test("list and detail both show running when a resumed run has leftover latest-draft", async () => {
    const runDir = await withRunDir()
    await writeFile(join(runDir, "request.json"), JSON.stringify({ topic: "Photography" }))
    await writeFile(join(runDir, "latest-draft.md"), "")
    await writeFile(join(runDir, "live-status.json"), JSON.stringify({
      phase: "running",
      node: "reviseDraft",
      round: 0,
      maxRounds: 10,
      agents: { drafter: { status: "running", toolCalls: [], reasoning: "" } },
      nodeHistory: [],
    }))

    const runs = await listRuns()
    expect(runs[0]?.status).toBe("running")

    const index = await (await renderIndex(new URLSearchParams("all=1"))).text()
    expect(index).toContain('<span class="badge badge-running">running</span>')
    expect(index).not.toContain('<span class="badge badge-failed">failed</span>')
    expect(index).toContain("● Active")

    const detail = await (await renderRun("photo-run")).text()
    expect(detail).toContain("Research: running")
  })
})
