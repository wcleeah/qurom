import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  renderDiscoverReaderScope,
  renderDraftFullDraftScope,
  renderDesignHtmlScope,
  designRoundNumbers,
} from "../src/view/node-content-view.ts"

describe("node content view", () => {
  let runsRoot = ""
  let runName = ""

  async function setupRun() {
    runsRoot = await mkdtemp(join(tmpdir(), "qurom-node-content-"))
    process.env.QUORUM_RUNS_DIR = runsRoot
    runName = "node-content-run"
    await mkdir(join(runsRoot, runName), { recursive: true })
  }

  test("designRoundNumbers collects design html rounds", () => {
    expect(designRoundNumbers(["design-html-round-0.html", "design-html-round-2.html"], null)).toEqual([0, 2])
  })

  test("renderDiscoverReaderScope shows interview turns and profile", async () => {
    await setupRun()
    try {
      await writeFile(join(runsRoot, runName, "reader-profile-1.json"), JSON.stringify({
        newQuestions: ["What is your goal?"],
        done: false,
        profile: { intent: { goal: "Learn Go", depth: "overview" } },
      }))
      await writeFile(join(runsRoot, runName, "reader-reply-turn-1.json"), JSON.stringify({ reply: "I want to understand select." }))

      const html = await renderDiscoverReaderScope(runName, [
        "reader-profile-1.json",
        "reader-reply-turn-1.json",
      ], null)

      expect(html).toContain("Interview turns")
      expect(html).toContain("What is your goal?")
      expect(html).toContain("understand select")
      expect(html).not.toContain("<h2>Summary</h2>")
    } finally {
      await rm(runsRoot, { recursive: true, force: true })
      delete process.env.QUORUM_RUNS_DIR
    }
  })

  test("loads reader replies from disk when omitted from the run file list", async () => {
    await setupRun()
    try {
      await writeFile(join(runsRoot, runName, "reader-profile-1.json"), JSON.stringify({
        newQuestions: ["What is your goal?"],
        done: false,
        profile: { intent: { goal: "Learn Go", depth: "overview" } },
      }))
      await writeFile(join(runsRoot, runName, "reader-reply-turn-1.json"), JSON.stringify({
        reply: "Understand select internals.",
      }))

      const html = await renderDiscoverReaderScope(runName, ["reader-profile-1.json"], null)

      expect(html).toContain("What is your goal?")
      expect(html).toContain("Understand select internals.")
    } finally {
      await rm(runsRoot, { recursive: true, force: true })
      delete process.env.QUORUM_RUNS_DIR
    }
  })

  test("renderDraftFullDraftScope renders markdown preview", async () => {
    await setupRun()
    try {
      await writeFile(join(runsRoot, runName, "draft-round-0.md"), "# Title\n\nBody paragraph.")

      const html = await renderDraftFullDraftScope(runName, ["draft-round-0.md"], 0, null)

      expect(html).toContain("Round 0 draft")
      expect(html).toContain("Draft preview")
      expect(html).toContain("Title")
      expect(html).not.toContain("<h2>Summary</h2>")
    } finally {
      await rm(runsRoot, { recursive: true, force: true })
      delete process.env.QUORUM_RUNS_DIR
    }
  })

  test("renderDiscoverReaderScope omits done profile turns and waiting text on completed runs", async () => {
    await setupRun()
    try {
      await writeFile(join(runsRoot, runName, "reader-profile-3.json"), JSON.stringify({
        newQuestions: ["Third question?"],
        done: false,
        profile: { intent: { goal: "Learn Go", depth: "overview" } },
      }))
      await writeFile(join(runsRoot, runName, "reader-reply-turn-3.json"), JSON.stringify({ reply: "Third answer." }))
      await writeFile(join(runsRoot, runName, "reader-profile-4.json"), JSON.stringify({
        newQuestions: [],
        done: true,
        profile: { intent: { goal: "Learn Go", depth: "implementation" } },
      }))
      await writeFile(join(runsRoot, runName, "draft-round-0.md"), "# Draft")

      const html = await renderDiscoverReaderScope(runName, [
        "reader-profile-3.json",
        "reader-reply-turn-3.json",
        "reader-profile-4.json",
        "draft-round-0.md",
      ], { phase: "complete", round: 0, maxRounds: 2, agents: {}, nodeHistory: [] })

      expect(html).toContain("Third question?")
      expect(html).toContain("Third answer.")
      expect(html).not.toContain("Waiting for reader reply")
      expect(html).not.toContain("Turn 4")
    } finally {
      await rm(runsRoot, { recursive: true, force: true })
      delete process.env.QUORUM_RUNS_DIR
    }
  })

  test("renderDesignHtmlScope embeds html preview", async () => {
    await setupRun()
    try {
      await writeFile(join(runsRoot, runName, "design-html-round-0.html"), "<html><body><h1>Design</h1></body></html>")

      const html = await renderDesignHtmlScope(runName, ["design-html-round-0.html"], 0, null)

      expect(html).toContain("Round 0 design HTML")
      expect(html).toContain("design-preview-frame")
      expect(html).toContain("Open in viewer")
    } finally {
      await rm(runsRoot, { recursive: true, force: true })
      delete process.env.QUORUM_RUNS_DIR
    }
  })
})
