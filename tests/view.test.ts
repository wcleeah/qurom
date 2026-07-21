import { describe, expect, test } from "bun:test"

import { renderDebugLogHtml } from "../src/view/debug-log-viewer.ts"
import { renderStructuredJson, renderConsensusRound, renderRebuttalsRound, renderRebuttalReviewRound, renderTargetedRebuttalsRound } from "../src/view/artifact-renderers.ts"
import { POLLING_SCRIPT } from "../src/view/client-script.ts"
import { renderFailureBanner, renderInterviewChatCard } from "../src/view/components.ts"
import { renderNodeGrid, renderGlobalResearchRoundStrip, renderNodeMiniPipeline, researchRoundNumbers } from "../src/view/node-view.ts"
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
  test("dispatches reader-profile.json to the reader profile card", () => {
    const html = renderStructuredJson("reader-profile.json", {
      intent: { goal: "Understand quorum reads", depth: "conceptual" },
      background: { summary: "Backend engineer" },
      competence: {
        inTopic: { level: "intermediate", summary: "Knows replication basics", evidence: [] },
        adjacent: { summary: "Strong distributed systems background", evidence: [] },
      },
      inferredGaps: [{ concept: "linearizability", treatment: "must-explain", rationale: "named it but could not define it" }],
    })

    expect(html).toContain("Reader profile")
    expect(html).toContain("Understand quorum reads")
    expect(html).toContain("linearizability")
  })

  test("renders rebuttal input files with structured rebuttal entries", () => {
    const rebuttal = {
      findingId: "run:0:source-auditor:1",
      position: "rebut",
      argument: "The source is accessible and supports the claim.",
      evidence: ["Fetched transcript confirms timing guidance."],
      requestedResolution: "reclassify",
    }
    const fileHtml = renderStructuredJson("rebuttals-source-auditor-round-0.json", [rebuttal])
    expect(fileHtml).toContain("structured-card")
    expect(fileHtml).toContain("rebuttal-entry")
    expect(fileHtml).toContain("source-auditor")
    expect(fileHtml).toContain("reclassify")

    const roundHtml = renderTargetedRebuttalsRound(0, [{ agent: "source-auditor", rebuttals: [rebuttal] }])
    expect(roundHtml).toContain("<h3>Round 0</h3>")
    expect(roundHtml).toContain("Drafter rebuttal")
  })

  test("renders rebuttal review turns with auditor responses and drafter review sections", () => {
    const response = {
      findingId: "run:0:source-auditor:1",
      decision: "uphold",
      argument: "The source still does not support the claim.",
      agent: "source-auditor",
      turn: 1,
    }
    const review = {
      acceptedFindingIds: ["run:0:source-auditor:1"],
      rebuttals: [],
    }
    const html = renderRebuttalReviewRound(0, [{
      turn: 1,
      responses: { "run:0:source-auditor:1": response },
      review,
    }])

    expect(html).toContain("<h3>Round 0</h3>")
    expect(html).toContain("Auditor responses")
    expect(html).toContain("Accepted (1 finding")
    expect(html).toContain("UPHELD")
  })

  test("renders merged rebuttals round with written rebuttals and review turns", () => {
    const rebuttal = {
      findingId: "run:0:source-auditor:1",
      position: "rebut",
      argument: "The source supports the claim.",
      evidence: ["Fetched transcript"],
      requestedResolution: "reclassify",
    }
    const response = {
      findingId: "run:0:source-auditor:1",
      decision: "uphold",
      argument: "Still insufficient.",
      agent: "source-auditor",
      turn: 1,
    }
    const html = renderRebuttalsRound({
      roundNum: 0,
      agentRebuttals: [{ agent: "source-auditor", rebuttals: [rebuttal] }],
      turns: [{ turn: 1, responses: { "run:0:source-auditor:1": response } }],
    })

    expect(html).toContain("Written rebuttals")
    expect(html).toContain("Auditor responses")
    expect(html).toContain("UPHELD")
  })

  test("renders consensus rounds with outcome banner and unresolved findings section", () => {
    const html = renderConsensusRound(0, {
      outcome: "needs_revision",
      approvedAgents: [],
      unresolvedFindings: [{
        severity: "major",
        category: "clarity",
        issue: "Missing timeline",
        evidence: ["No consolidated sequence"],
        required_fix: "Add timeline",
        findingId: "run:0:clarity:1",
        agent: "clarity-auditor",
      }],
    })

    expect(html).toContain("<h3>Round 0</h3>")
    expect(html).toContain("Needs revision")
    expect(html).toContain("Unresolved findings (1)")
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
    expect(POLLING_SCRIPT).toContain("Live refresh paused during interview")
    expect(POLLING_SCRIPT).toContain("preserveInFlightRead")
    expect(POLLING_SCRIPT).toContain("data-interview-reply-form")
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
    expect(classifyFile("reader-profile.json")).toMatchObject({
      group: "Run Metadata",
      subGroup: "Reader",
      label: "Reader profile",
    })
    expect(classifyFile("question-1.json")).toMatchObject({
      group: "Run Metadata",
      subGroup: "Reader",
      label: "Interview question 1",
    })
    expect(classifyFile("reply-1.json")).toMatchObject({
      group: "Run Metadata",
      subGroup: "Reader",
      label: "Interview reply 1",
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

  test("marks discoverReader complete when reader profile exists", () => {
    const html = renderNodeGrid(
      "example-run",
      ["request.json", "reader-profile.json"],
      null,
      "running",
    )

    expect(html).toContain("Discover reader")
    expect(html).toContain("✓")
  })

  test("renders a run-scoped global research round strip", () => {
    const files = ["draft-round-0.md", "audits-round-0.json", "draft-round-1.md"]
    expect(researchRoundNumbers(files, null)).toEqual([0, 1])

    const html = renderGlobalResearchRoundStrip("example-run", files, {
      phase: "running",
      round: 1,
      maxRounds: 2,
      agents: {},
      nodeHistory: [],
    })

    expect(html).toContain("data-run-round-tabs=\"example-run\"")
    expect(html).toContain('data-round-tab="total"')
    expect(html).toContain('data-round-tab="0"')
    expect(html).toContain('data-round-tab="1"')
    expect(html).toContain("round-chip-live")
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
    expect(html).toContain('name="turn" value="2"')
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

  test("does not render interview reply form when run phase is complete", () => {
    const liveStatus: LiveStatus = {
      phase: "complete",
      node: "finalizeDesign",
      round: 0,
      maxRounds: 2,
      agents: {},
      nodeHistory: [],
      awaitingReaderReply: {
        turn: 3,
        answeredQuestions: [],
        newQuestions: ["Stale question after complete?"],
        transcript: [{ role: "interviewer", text: "Stale question after complete?" }],
      },
    }

    const html = renderInterviewChatCard("example-run", liveStatus)

    expect(html).toBe("")
  })

  test("node mini pipeline is one continuous graph strip", () => {
    const html = renderNodeMiniPipeline("example-run", "runDesignHtml", ["design-html-round-0.html"])
    expect(html).toContain("/runs/example-run/node/discoverReader")
    expect(html).toContain("/runs/example-run/node/draftFullDraft")
    expect(html).toContain("/runs/example-run/node/runParallelAudits")
    expect(html).toContain("/runs/example-run/node/runDesignHtml")
    expect(html).toContain("/runs/example-run/node/interactiveEnhance")
    expect(html).toContain("/runs/example-run/node/finalizeDesign")
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
