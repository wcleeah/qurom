import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { buildRunDirName, ensureRunDir } from "../src/output"
import { resolveRunName } from "../src/view/paths"

describe("run start directory resolution", () => {
  let runsRoot = ""

  afterEach(async () => {
    if (runsRoot) {
      await rm(runsRoot, { recursive: true, force: true })
      runsRoot = ""
    }
    delete process.env.QUORUM_RUNS_DIR
  })

  test("resolveRunName finds a pre-created run by full path or requestId suffix", async () => {
    runsRoot = await mkdtemp(join(tmpdir(), "quorum-run-start-"))
    process.env.QUORUM_RUNS_DIR = runsRoot

    const requestId = crypto.randomUUID()
    const input = {
      requestId,
      inputMode: "topic" as const,
      topic: "Timing test topic",
    }
    const runPath = buildRunDirName(input)
    await ensureRunDir(runsRoot, input)

    expect(await resolveRunName(runPath)).toBe(runPath)
    expect(await resolveRunName(requestId)).toBe(runPath)
  })
})
