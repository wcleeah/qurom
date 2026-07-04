import { describe, expect, test } from "bun:test"

import { renderDebugLogHtml } from "../src/view/debug-log-viewer.ts"
import { renderStructuredJson } from "../src/view/artifact-renderers.ts"
import { POLLING_SCRIPT } from "../src/view/client-script.ts"
import { renderInterviewChatCard } from "../src/view/components.ts"
import { renderNodeGrid } from "../src/view/node-view.ts"
import { renderHtmlViewerPage } from "../src/view/html-viewer.ts"
import { classifyFile } from "../src/view/file-browser.ts"
import { card, section, summaryRow, summaryTable } from "../src/view/html.ts"
import { getRunsDir, safeFilePath, safeRunPath } from "../src/view/paths.ts"
import { CSS } from "../src/view/styles.ts"
import type { LiveStatus } from "../src/view/types.ts"

describe("view path helpers", () => {
  test("safeRunPath resolves run names inside the runs directory", () => {
    expect(safeRunPath("example-run")).toBe(`${getRunsDir()}/example-run`)
  })

  test("safeFilePath blocks traversal and sqlite artifacts", () => {
    expect(() => safeFilePath("../outside", "request.json")).toThrow("Path traversal blocked")
    expect(() => safeFilePath("example-run", "checkpoints.sqlite")).toThrow("Sqlite files blocked")
  })
})

describe("view artifact renderers", () => {
  test("dispatches reader-profile-N.json to the reader profile card", () => {
    const html = renderStructuredJson("reader-profile-2.json", {
      done: true,
      profile: {
        intent: { goal: "Understand quorum reads", depth: "conceptual" },
        background: { summary: "Backend engineer" },
        competence: {
          inTopic: { level: "intermediate", summary: "Knows replication basics", evidence: [] },
          adjacent: { summary: "Strong distributed systems background", evidence: [] },
        },
        inferredGaps: [{ concept: "linearizability", treatment: "must-explain", rationale: "named it but could not define it" }],
      },
    })

    expect(html).toContain("Reader profile")
    expect(html).toContain("Understand quorum reads")
    expect(html).toContain("linearizability")
  })

  test("falls back to the generic JSON viewer for unknown artifacts", () => {
    const html = renderStructuredJson("custom.json", { ok: true, count: 2, nested: { alpha: 1 } })

    expect(html).toContain("json-viewer")
    expect(html).toContain("json-kv-table")
    expect(html).toContain("ok")
    expect(html).toContain("nested")
  })

  test("renders uniform object arrays as data tables", () => {
    const html = renderStructuredJson("metrics.json", [
      { name: "latency", value: 12 },
      { name: "errors", value: 0 },
    ])

    expect(html).toContain("json-data-table")
    expect(html).toContain("latency")
    expect(html).toContain("errors")
  })

  test("renders debug log entries with expandable payloads", () => {
    const html = renderDebugLogHtml([
      {
        ts: "2026-07-04T10:15:30.123Z",
        type: "node.start",
        node: "runParallelAudits",
        round: 0,
      },
      {
        ts: "2026-07-04T10:15:31.456Z",
        type: "pipeline.error",
        error: "StructuredRecoveryError",
      },
    ])

    expect(html).toContain("debug-log-viewer")
    expect(html).toContain("node.start")
    expect(html).toContain("pipeline.error")
    expect(html).toContain("runParallelAudits")
    expect(html).toContain("StructuredRecoveryError")
    expect(html).toContain("json-kv-table")
    expect(html).toContain("badge-running")
    expect(html).toContain("badge-failed")
  })
})

describe("view assets and html helpers", () => {
  test("keeps styles and client script split into focused modules", () => {
    expect(CSS).toContain(".table-wrap")
    expect(CSS).toContain("overflow-x: auto")
    expect(CSS).not.toContain("<script>")
    expect(POLLING_SCRIPT).toContain("<script>")
    expect(POLLING_SCRIPT).toContain("data-refresh-now")
    expect(POLLING_SCRIPT).toContain("data-refresh-toggle")
    expect(POLLING_SCRIPT).toContain("qurom-view-live-refresh")
  })

  test("renders small reusable card, section, and summary table fragments", () => {
    const html = section("Details", card(summaryTable([summaryRow("Status", "<strong>ok</strong>")])))

    expect(html).toContain('class="section"')
    expect(html).toContain('class="card"')
    expect(html).toContain('class="summary-table"')
    expect(html).toContain('class="table-wrap"')
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
  test("renders discoverReader in the node grid", () => {
    const html = renderNodeGrid(
      "example-run",
      ["request.json"],
      { node: "discoverReaderPrompt", phase: "running", round: 0, maxRounds: 2, agents: {}, nodeHistory: [] },
      "running",
    )

    expect(html).toContain("Discover reader")
    expect(html).toContain("node-grid-card active")
    expect(html).toContain("/runs/example-run/node/discoverReader")
    expect(html).not.toContain('style="')
  })

  test("marks discoverReader complete when numbered reader profile exists", () => {
    const html = renderNodeGrid(
      "example-run",
      ["request.json", "reader-profile-1.json"],
      null,
      "running",
    )

    expect(html).toContain("Discover reader")
    expect(html).toContain("✓")
  })

  test("renders finalizeDesign in the node grid", () => {
    const html = renderNodeGrid(
      "example-run",
      ["final.md", "design-html-round-0.html", "final.html"],
      {
        phase: "complete",
        node: "finalizeDesign",
        round: 2,
        maxRounds: 3,
        agents: {},
        nodeHistory: [
          { node: "finalizeDesign", startedAt: 1, completedAt: 2, status: "completed", round: 2 },
        ],
      },
      "approved",
    )

    expect(html).toContain("Finalize design")
    expect(html).toContain("/runs/example-run/node/finalizeDesign")
    expect(html).not.toContain("browserQaEnhance")
  })

  test("does not surface stale browser QA nodes in the node grid", () => {
    const html = renderNodeGrid(
      "example-run",
      ["final.md", "design-html-round-0.html", "final.html"],
      {
        phase: "complete",
        node: "finalizeDesign",
        round: 2,
        maxRounds: 3,
        agents: {},
        nodeHistory: [
          { node: "browserQaEnhance", startedAt: 1, completedAt: 2, status: "completed", round: 2 },
        ],
      },
      "approved",
    )

    expect(html).toContain("Finalize design")
    expect(html).not.toContain("browserQaEnhance")
    expect(html).not.toContain("browser-qa-enhancer")
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

  test("renders partial profile during the interview", () => {
    const liveStatus: LiveStatus = {
      phase: "running",
      node: "discoverReaderPrompt",
      round: 0,
      maxRounds: 2,
      agents: {},
      nodeHistory: [],
      awaitingReaderReply: {
        turn: 1,
        answeredQuestions: [],
        newQuestions: ["What are you trying to get out of this topic?"],
        transcript: [{ role: "interviewer", text: "What are you trying to get out of this topic?" }],
        partialProfile: {
          intent: { goal: "not yet clear", depth: "overview" },
          background: { summary: "Unknown so far" },
          competence: {
            inTopic: { level: "novice", summary: "Unknown so far", evidence: [] },
            adjacent: { summary: "Unknown so far", evidence: [] },
          },
          inferredGaps: [],
        },
      },
    }

    const html = renderInterviewChatCard("example-run", liveStatus)

    expect(html).toContain("Profile so far")
    expect(html).toContain("not yet clear")
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

describe("html viewer renderer", () => {
  test("includes sticky navbar controls and notes form action", () => {
    const html = renderHtmlViewerPage("example-run", "design-html-round-0.html", "", [])

    expect(html).toContain("app-navbar")
    expect(html).toContain("app-navbar-pill")
    expect(html).toContain("/runs/example-run/html-notes")
    expect(html).toContain('data-html-notes-form')
    expect(html).toContain("data-html-save-indicator")
    expect(html).toContain("Download")
    expect(html).toContain('data-html-tab="ask"')
  })
})
