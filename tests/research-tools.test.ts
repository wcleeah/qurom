import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildResearchToolHint } from "../src/research-tools"
import { testRuntimeConfig } from "./test-env"

describe("buildResearchToolHint", () => {
  test("asks agents not to use Exa Agent", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "qurom-research-tools-"))
    const hint = buildResearchToolHint(testRuntimeConfig({ dataDir }))
    expect(hint).toContain("Prefer exa when it matches the task.")
    expect(hint).toContain("Preferred web search provider: exa.")
    expect(hint).toContain("Do not use Exa Agent or other Exa subagent/delegation tools. Use Exa only for direct search or fetch.")
  })
})
