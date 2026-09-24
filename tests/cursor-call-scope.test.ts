import { describe, expect, test } from "bun:test"

import { inferCursorCallScope, inferScopeFromNodeHistory } from "../src/cursor-call-scope.ts"

describe("inferCursorCallScope", () => {
  test("maps design artifacts by role filename", () => {
    expect(inferCursorCallScope({
      role: "html-designer",
      artifact: "design-html-html-designer.html",
    })).toEqual({ node: "runDesignHtml", round: 0 })

    expect(inferCursorCallScope({
      role: "graphical-enhancer",
      artifact: "design-html-graphical-enhancer.html",
    })).toEqual({ node: "graphicalEnhance", round: 0 })

    expect(inferCursorCallScope({
      role: "interactive-enhancer",
      artifact: "design-html-interactive-enhancer.html",
    })).toEqual({ node: "graphicalEnhance", round: 0 })

    expect(inferCursorCallScope({
      role: "html-reviewer",
      artifact: "design-html-html-reviewer.html",
    })).toEqual({ node: "htmlReview", round: 0 })
  })

  test("maps legacy design-html-round artifacts by role", () => {
    expect(inferCursorCallScope({
      role: "html-designer",
      artifact: "design-html-round-0.html",
    })).toEqual({ node: "runDesignHtml", round: 0 })

    expect(inferCursorCallScope({
      role: "graphical-enhancer",
      artifact: "design-html-round-0.html",
    })).toEqual({ node: "graphicalEnhance", round: 0 })

    expect(inferCursorCallScope({
      role: "interactive-enhancer",
      artifact: "design-html-round-0.html",
    })).toEqual({ node: "graphicalEnhance", round: 0 })
  })

  test("maps draft artifacts to draft or revise nodes", () => {
    expect(inferCursorCallScope({
      role: "research-drafter",
      artifact: "draft-round-0.md",
    })).toEqual({ node: "draftFullDraft", round: 0 })

    expect(inferCursorCallScope({
      role: "research-drafter",
      artifact: "draft-round-0-readability-1.md",
    })).toEqual({ node: "reviseReadability", round: 0 })

    expect(inferCursorCallScope({
      role: "research-drafter",
      artifact: "draft.md",
    })).toEqual({})
  })

  test("maps summarizer artifacts and role", () => {
    expect(inferCursorCallScope({
      role: "markdown-summarizer",
      artifact: "artifact-summary.json",
    })).toEqual({ node: "summarizeOutputArtifact", round: 0 })
    expect(inferCursorCallScope({ role: "markdown-summarizer" }))
      .toEqual({ node: "summarizeOutputArtifact", round: 0 })
  })

  test("maps working design files by role because metadata is per stage", () => {
    expect(inferCursorCallScope({
      role: "html-designer",
      artifact: "design.html",
    })).toEqual({ node: "runDesignHtml", round: 0 })
    expect(inferCursorCallScope({
      role: "graphical-enhancer",
      artifact: "design.html",
    })).toEqual({ node: "graphicalEnhance", round: 0 })
    expect(inferCursorCallScope({
      role: "reading-experience-enhancer",
      artifact: "design.html",
    })).toEqual({ node: "readingExperienceEnhance", round: 0 })
  })

  test("maps audit and review artifacts", () => {
    expect(inferCursorCallScope({
      role: "source-auditor",
      artifact: "audit-source-auditor-round-2.json",
    })).toEqual({ node: "runParallelAudits", round: 2 })

    expect(inferCursorCallScope({
      role: "research-drafter",
      artifact: "drafter-finding-review-round-3.json",
    })).toEqual({ node: "reviewFindingsByDrafter", round: 3 })
  })

  test("falls back to role-only mapping when artifact is missing", () => {
    expect(inferCursorCallScope({ role: "html-designer" }))
      .toEqual({ node: "runDesignHtml", round: 0 })
    expect(inferCursorCallScope({ role: "graphical-enhancer" }))
      .toEqual({ node: "graphicalEnhance", round: 0 })
    expect(inferCursorCallScope({ role: "interactive-enhancer" }))
      .toEqual({ node: "graphicalEnhance", round: 0 })
    expect(inferCursorCallScope({ role: "reading-experience-enhancer" }))
      .toEqual({ node: "readingExperienceEnhance", round: 0 })
    expect(inferCursorCallScope({ role: "html-reviewer" }))
      .toEqual({ node: "htmlReview", round: 0 })
    expect(inferCursorCallScope({ role: "markdown-summarizer" }))
      .toEqual({ node: "summarizeOutputArtifact", round: 0 })
  })
})

describe("inferScopeFromNodeHistory", () => {
  test("maps a completed call onto the longest overlapping node", () => {
    expect(inferScopeFromNodeHistory(500, [
      { node: "draftFullDraft", round: 0, startedAt: 1, completedAt: 400, durationMs: 399 },
      { node: "reviseReadability", round: 0, startedAt: 450, completedAt: 800, durationMs: 350 },
    ])).toEqual({ node: "reviseReadability", round: 0 })
  })
})
