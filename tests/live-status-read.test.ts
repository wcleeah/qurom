import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { isRunManagedActive, resetRunManagerForTests } from "../src/run-manager.ts"
import { readLiveStatus } from "../src/view/data.ts"

describe("readLiveStatus", () => {
  let runsRoot = ""

  afterEach(async () => {
    resetRunManagerForTests()
    if (runsRoot) {
      await rm(runsRoot, { recursive: true, force: true })
      runsRoot = ""
    }
    delete process.env.QUORUM_RUNS_DIR
  })

  test("falls back to run-status when live-status is stale and run is idle", async () => {
    runsRoot = await mkdtemp(join(tmpdir(), "qurom-read-live-idle-"))
    process.env.QUORUM_RUNS_DIR = runsRoot

    const runName = "idle-run-12345678-1234-1234-1234-123456789012"
    const runDir = join(runsRoot, runName)
    await mkdir(runDir, { recursive: true })
    await writeFile(
      join(runDir, "run-status.json"),
      JSON.stringify({ phase: "complete", node: "finalizeDesign", round: 0, maxRounds: 2, agents: {}, nodeHistory: [] }),
    )

    const status = await readLiveStatus(runName)
    expect(status?.phase).toBe("complete")
  })

  test("strips awaitingReaderReply from completed run-status snapshots", async () => {
    runsRoot = await mkdtemp(join(tmpdir(), "qurom-read-live-stale-interview-"))
    process.env.QUORUM_RUNS_DIR = runsRoot

    const runName = "complete-run-12345678-1234-1234-1234-123456789012"
    const runDir = join(runsRoot, runName)
    await mkdir(runDir, { recursive: true })
    await writeFile(
      join(runDir, "run-status.json"),
      JSON.stringify({
        phase: "complete",
        round: 0,
        maxRounds: 2,
        agents: {},
        nodeHistory: [],
        awaitingReaderReply: { turn: 3, newQuestions: ["Stale?"], answeredQuestions: [], transcript: [] },
      }),
    )

    const status = await readLiveStatus(runName)
    expect(status?.phase).toBe("complete")
    expect(status?.awaitingReaderReply).toBeUndefined()
  })

  test("isRunManagedActive is false when no run manager is initialized", () => {
    expect(isRunManagedActive("any-run")).toBe(false)
  })
})
