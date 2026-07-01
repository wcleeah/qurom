import { describe, expect, test } from "bun:test"

import { renderStructuredJson } from "../src/view/artifact-renderers.ts"
import { POLLING_SCRIPT } from "../src/view/client-script.ts"
import { renderInterviewChatCard, renderLivePipeline } from "../src/view/components.ts"
import { classifyFile } from "../src/view/file-browser.ts"
import { card, section, summaryRow, summaryTable } from "../src/view/html.ts"
import { RUNS_DIR, safeFilePath, safeRunPath } from "../src/view/paths.ts"
import { CSS } from "../src/view/styles.ts"
import type { LiveStatus } from "../src/view/types.ts"

describe("view path helpers", () => {
  test("safeRunPath resolves run names inside the runs directory", () => {
    expect(safeRunPath("example-run")).toBe(`${RUNS_DIR}/example-run`)
  })

  test("safeFilePath blocks traversal and sqlite artifacts", () => {
    expect(() => safeFilePath("../outside", "request.json")).toThrow("Path traversal blocked")
    expect(() => safeFilePath("example-run", "checkpoints.sqlite")).toThrow("Sqlite files blocked")
  })
})

describe("view artifact renderers", () => {
  test("dispatches reader-profile.json to the reader profile card", () => {
    const html = renderStructuredJson("reader-profile.json", {
      profile: {
        learningGoal: "Understand quorum reads",
        concepts: [{ concept: "linearizability", level: "heard-of", evidence: "named it" }],
      },
    })

    expect(html).toContain("Reader profile")
    expect(html).toContain("Understand quorum reads")
    expect(html).toContain("linearizability")
  })

  test("falls back to the generic JSON card for unknown artifacts", () => {
    const html = renderStructuredJson("custom.json", { ok: true })

    expect(html).toContain("json-details")
    expect(html).toContain("ok")
  })
})

describe("view assets and html helpers", () => {
  test("keeps styles and client script split into focused modules", () => {
    expect(CSS).toContain(".stack-card")
    expect(CSS).not.toContain("<script>")
    expect(POLLING_SCRIPT).toContain("<script>")
    expect(POLLING_SCRIPT).toContain("data-refresh-now")
  })

  test("renders small reusable card, section, and summary table fragments", () => {
    const html = section("Details", card(summaryTable([summaryRow("Status", "<strong>ok</strong>")])))

    expect(html).toContain('class="section"')
    expect(html).toContain('class="card"')
    expect(html).toContain('class="summary-table"')
    expect(html).toContain("<td>Status</td>")
    expect(html).toContain("<strong>ok</strong>")
  })
})

describe("view file browser classification", () => {
  test("classifies design and reader artifacts into stable groups", () => {
    expect(classifyFile("reader-profile.json")).toMatchObject({
      group: "Run Metadata",
      subGroup: "Reader",
      label: "Reader profile",
    })
    expect(classifyFile("design-consensus-round-2.json")).toMatchObject({
      group: "Design Rounds",
      subGroup: "Consensus",
      label: "Design consensus round 2",
    })
  })
})

describe("view components", () => {
  test("renders discoverReader in the live pipeline", () => {
    const html = renderLivePipeline(
      { node: "discoverReaderPrompt", phase: "running", round: 0, maxRounds: 2, agents: {}, nodeHistory: [] },
      ["request.json"],
      "running",
      "example-run",
    )

    expect(html).toContain("discoverReader")
    expect(html).toContain("interviewing")
    expect(html).toContain("stack-card-tight")
    expect(html).not.toContain('style="')
  })

  test("renders the interview reply form from live status", () => {
    const liveStatus: LiveStatus = {
      phase: "running",
      node: "discoverReaderPrompt",
      round: 0,
      maxRounds: 2,
      agents: {},
      nodeHistory: [],
      awaitingReaderReply: {
        turn: 2,
        questions: ["What do you already know?"],
        transcript: [
          { role: "interviewer", text: "First question?" },
          { role: "reader", text: "First answer" },
          { role: "interviewer", text: "What do you already know?" },
        ],
      },
    }

    const html = renderInterviewChatCard("example-run", liveStatus)

    expect(html).toContain("Reader interview")
    expect(html).toContain("Answered history")
    expect(html).toContain("What do you already know?")
    expect(html).toContain('method="POST"')
  })
})
