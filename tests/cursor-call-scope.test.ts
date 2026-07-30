import { describe, expect, test } from "bun:test"

import { inferCursorCallScope } from "../src/cursor-call-scope.ts"

describe("inferCursorCallScope", () => {
  test("maps design artifacts by role filename", () => {
    expect(inferCursorCallScope({
      role: "html-designer",
      artifact: "design-html-html-designer.html",
    })).toEqual({ node: "runDesignHtml", round: 0 })

    expect(inferCursorCallScope({
      role: "interactive-enhancer",
      artifact: "design-html-interactive-enhancer.html",
    })).toEqual({ node: "interactiveEnhance", round: 0 })

    expect(inferCursorCallScope({
      role: "reading-experience-enhancer",
      artifact: "design-html-reading-experience-enhancer.html",
    })).toEqual({ node: "readingExperienceEnhance", round: 0 })
  })

  test("maps legacy design-html-round artifacts by role", () => {
    expect(inferCursorCallScope({
      role: "html-designer",
      artifact: "design-html-round-0.html",
    })).toEqual({ node: "runDesignHtml", round: 0 })

    expect(inferCursorCallScope({
      role: "interactive-enhancer",
      artifact: "design-html-round-0.html",
    })).toEqual({ node: "interactiveEnhance", round: 0 })
  })

  test("maps draft artifacts to draft or revise nodes", () => {
    expect(inferCursorCallScope({
      role: "research-drafter",
      artifact: "draft-round-0.md",
    })).toEqual({ node: "draftFullDraft", round: 0 })

    expect(inferCursorCallScope({
      role: "research-drafter",
      artifact: "draft-round-4.md",
    })).toEqual({ node: "reviseDraft", round: 3 })
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
    expect(inferCursorCallScope({ role: "interactive-enhancer" }))
      .toEqual({ node: "interactiveEnhance", round: 0 })
    expect(inferCursorCallScope({ role: "reading-experience-enhancer" }))
      .toEqual({ node: "readingExperienceEnhance", round: 0 })
  })
})
