import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"

import { quorumDataPaths, resolveQuorumDataDir } from "../src/data-paths"

describe("data paths", () => {
  test("defaults to XDG data home with qurom suffix", () => {
    const previous = process.env.XDG_DATA_HOME
    const previousOverride = process.env.QUORUM_DATA_DIR
    delete process.env.XDG_DATA_HOME
    delete process.env.QUORUM_DATA_DIR

    expect(resolveQuorumDataDir()).toBe(join(homedir(), ".local", "share", "qurom"))

    process.env.XDG_DATA_HOME = previous
    process.env.QUORUM_DATA_DIR = previousOverride
  })

  test("honors QUORUM_DATA_DIR override", () => {
    expect(resolveQuorumDataDir("/tmp/custom-qurom")).toBe("/tmp/custom-qurom")
  })

  test("derives sqlite and runs paths from data dir", () => {
    const paths = quorumDataPaths("/tmp/custom-qurom")
    expect(paths).toEqual({
      root: "/tmp/custom-qurom",
      configDb: "/tmp/custom-qurom/quorum-config.sqlite",
      checkpointDb: "/tmp/custom-qurom/checkpoints.sqlite",
      runsDir: "/tmp/custom-qurom/runs",
      archiveDir: "/tmp/custom-qurom/archive",
    })
  })
})
