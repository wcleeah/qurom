import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { RUN_INPUT_DOCUMENT } from "../src/output"
import { resolveRunForResume } from "../src/run-resume"

describe("run-resume document input", () => {
  let runsRoot: string

  afterEach(async () => {
    if (runsRoot) await rm(runsRoot, { recursive: true, force: true })
  })

  test("resolveRunForResume loads document runs that only persist input.md path", async () => {
    runsRoot = join(tmpdir(), `resume-doc-${Date.now()}`)
    const runDir = join(runsRoot, "browser-doc-req-abc")
    await mkdir(runDir, { recursive: true })
    await Bun.write(join(runDir, RUN_INPUT_DOCUMENT), "# Saved source\n\nFrom browser.")
    await Bun.write(join(runDir, "request.json"), JSON.stringify({
      requestId: "req-abc",
      inputMode: "document",
      documentPath: join(runDir, RUN_INPUT_DOCUMENT),
      documentSource: "inline",
    }))

    const resolved = await resolveRunForResume("browser-doc-req-abc", runsRoot)
    expect(resolved.request.inputMode).toBe("document")
    if (resolved.request.inputMode !== "document") return
    expect(resolved.request.documentPath).toEndWith(RUN_INPUT_DOCUMENT)
  })
})
