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
      await writeFile(join(runsRoot, runName, "question-1.json"), JSON.stringify({
        questions: ["What is your goal?"],
      }))
      await writeFile(join(runsRoot, runName, "reply-1.json"), JSON.stringify({ reply: "I want to understand select." }))
      await writeFile(join(runsRoot, runName, "reader-profile.json"), JSON.stringify({
        intent: { goal: "Learn Go", depth: "overview" },
      }))

      const html = await renderDiscoverReaderScope(runName, [
        "question-1.json",
        "reply-1.json",
        "reader-profile.json",
      ], null)

      expect(html).toContain("Interview turns")
      expect(html).toContain("What is your goal?")
      expect(html).toContain("understand select")
      expect(html).toContain("Reader profile")
      expect(html).not.toContain("<h2>Summary</h2>")
    } finally {
      await rm(runsRoot, { recursive: true, force: true })
      delete process.env.QUORUM_RUNS_DIR
    }
  })

  test("loads reader replies from disk when omitted from the run file list", async () => {
    await setupRun()
    try {
      await writeFile(join(runsRoot, runName, "question-1.json"), JSON.stringify({
        questions: ["What is your goal?"],
      }))
      await writeFile(join(runsRoot, runName, "reply-1.json"), JSON.stringify({
        reply: "Understand select internals.",
      }))

      const html = await renderDiscoverReaderScope(runName, ["question-1.json"], null)

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

  test("renderDiscoverReaderScope shows completed interview without waiting text", async () => {
    await setupRun()
    try {
      await writeFile(join(runsRoot, runName, "question-3.json"), JSON.stringify({
        questions: ["Third question?"],
      }))
      await writeFile(join(runsRoot, runName, "reply-3.json"), JSON.stringify({ reply: "Third answer." }))
      await writeFile(join(runsRoot, runName, "reader-profile.json"), JSON.stringify({
        intent: { goal: "Learn Go", depth: "implementation" },
      }))
      await writeFile(join(runsRoot, runName, "draft-round-0.md"), "# Draft")

      const html = await renderDiscoverReaderScope(runName, [
        "question-3.json",
        "reply-3.json",
        "reader-profile.json",
        "draft-round-0.md",
      ], { phase: "complete", round: 0, maxRounds: 2, agents: {}, nodeHistory: [] })

      expect(html).toContain("Third question?")
      expect(html).toContain("Third answer.")
      expect(html).toContain("Reader profile")
      expect(html).not.toContain("Waiting for reader reply")
    } finally {
      await rm(runsRoot, { recursive: true, force: true })
      delete process.env.QUORUM_RUNS_DIR
    }
  })

  test("renderDesignHtmlScope embeds html preview", async () => {
    await setupRun()
    try {
      await writeFile(join(runsRoot, runName, "design-html-html-designer.html"), "<html><body><h1>Design</h1></body></html>")

      const html = await renderDesignHtmlScope(runName, ["design-html-html-designer.html"], "total", null)

      expect(html).toContain("Design HTML")
      expect(html).toContain("design-html-html-designer.html")
      expect(html).toContain("design-preview-frame")
      expect(html).toContain("Open in viewer")
    } finally {
      await rm(runsRoot, { recursive: true, force: true })
      delete process.env.QUORUM_RUNS_DIR
    }
  })
})
