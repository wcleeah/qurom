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
  test("dispatches reader-profile-N.json to the reader profile card", () => {
    const html = renderStructuredJson("reader-profile-2.json", {
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
    expect(classifyFile("reader-profile-2.json")).toMatchObject({
      group: "Run Metadata",
      subGroup: "Reader",
      label: "Reader profile turn 2",
    })
    expect(classifyFile("cursor-reader-interviewer-call-1-attempt-1-run-123-artifacts.json")).toMatchObject({
      group: "Debug",
      subGroup: "Cursor",
    })
    expect(classifyFile("design-html-round-0.html")).toMatchObject({
      group: "Design",
      subGroup: "HTML Drafts",
      label: "HTML draft round 0",
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

  test("marks discoverReader complete when numbered reader profile exists", () => {
    const html = renderLivePipeline(
      null,
      ["request.json", "reader-profile-1.json"],
      "running",
      "example-run",
    )

    expect(html).toContain("profile ready")
  })

  test("renders browser QA in the design pipeline from node history", () => {
    const html = renderLivePipeline(
      {
        phase: "complete",
        node: "browserQaEnhance",
        round: 2,
        maxRounds: 3,
        agents: {},
        nodeHistory: [
          { node: "browserQaEnhance", startedAt: 1, completedAt: 2, status: "completed", round: 2 },
        ],
      },
      ["final.md", "design-html-round-0.html", "final.html"],
      "approved",
      "example-run",
    )

    expect(html).toContain("browserQaEnhance")
    expect(html).toContain("browser checked")
    expect(html).toContain("/runs/example-run/node/browserQaEnhance")
  })

  test("renders active browser QA agent activity in the pipeline", () => {
    const html = renderLivePipeline(
      {
        phase: "running",
        node: "browserQaEnhance",
        round: 2,
        maxRounds: 3,
        agents: {
          "browser-qa-enhancer": { status: "running", toolCalls: [], messages: [], reasoning: "" },
        },
        nodeHistory: [],
      },
      ["final.md", "design-html-round-0.html", "final.html"],
      "approved",
      "example-run",
    )

    expect(html).toContain("browserQaEnhance")
    expect(html).toContain("browser-qa-enhancer")
    expect(html).toContain("pipeline-node active")
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
        answeredQuestions: [{ question: "First question?", answer: "First answer" }],
        newQuestions: ["What do you already know?"],
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

  test("renders batched interview history as numbered question and answer pairs", () => {
    const liveStatus: LiveStatus = {
      phase: "running",
      node: "discoverReaderPrompt",
      round: 0,
      maxRounds: 2,
      agents: {},
      nodeHistory: [],
      awaitingReaderReply: {
        turn: 2,
        answeredQuestions: [
          { question: "What are you trying to accomplish?", answer: "Pure curiosity." },
          { question: "How familiar are you with ML?", answer: "Quite new." },
        ],
        newQuestions: ["Next question?"],
        transcript: [
          { role: "interviewer", text: "What are you trying to accomplish?\nHow familiar are you with ML?" },
          { role: "reader", text: "Answer 1: Pure curiosity.\n\nAnswer 2: Quite new." },
          { role: "interviewer", text: "Next question?" },
        ],
      },
    }

    const html = renderInterviewChatCard("example-run", liveStatus)

    expect(html).toContain("Question 1")
    expect(html).toContain("What are you trying to accomplish?")
    expect(html).toContain("Answer 1")
    expect(html).toContain("Pure curiosity.")
    expect(html).toContain("Question 2")
    expect(html).toContain("How familiar are you with ML?")
    expect(html).toContain("Answer 2")
    expect(html).toContain("Quite new.")
  })
})
