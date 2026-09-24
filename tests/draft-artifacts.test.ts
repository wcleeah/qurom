import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  latestDraftSnapshotFilename,
  restoreWorkingDraftFromLatestSnapshot,
} from "../src/draft-artifacts"

describe("draft artifacts", () => {
  test("prefers the newest readability snapshot over an older round file", () => {
    expect(latestDraftSnapshotFilename([
      "draft-round-0.md",
      "draft-round-0-readability-1.md",
      "draft-round-0-readability-2.md",
    ])).toBe("draft-round-0-readability-2.md")
    expect(latestDraftSnapshotFilename([
      "draft-round-0-readability-2.md",
      "draft-round-1.md",
    ])).toBe("draft-round-1.md")
  })

  test("restores draft.md from the latest snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qurom-draft-restore-"))
    try {
      await Bun.write(join(dir, "draft-round-0.md"), "First article\n")
      await Bun.write(join(dir, "draft.md"), "PARTIAL\n")
      const name = await restoreWorkingDraftFromLatestSnapshot(dir)
      expect(name).toBe("draft-round-0.md")
      expect(await Bun.file(join(dir, "draft.md")).text()).toContain("First article")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
