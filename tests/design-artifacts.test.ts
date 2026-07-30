import { describe, expect, test } from "bun:test"

import {
  designHtmlArtifactName,
  designHtmlArtifacts,
  latestDesignHtmlArtifact,
  previousDesignHtmlArtifact,
} from "../src/design-artifacts.ts"

describe("design artifacts", () => {
  test("names artifacts by role", () => {
    expect(designHtmlArtifactName("html-designer")).toBe("design-html-html-designer.html")
    expect(designHtmlArtifactName("interactive-enhancer")).toBe("design-html-interactive-enhancer.html")
    expect(designHtmlArtifactName("reading-experience-enhancer")).toBe("design-html-reading-experience-enhancer.html")
  })

  test("orders pipeline artifacts and prefers the latest role stage", () => {
    const files = [
      "design-html-reading-experience-enhancer.html",
      "design-html-html-designer.html",
      "design-html-interactive-enhancer.html",
      "final.html",
    ]
    expect(designHtmlArtifacts(files)).toEqual([
      "design-html-html-designer.html",
      "design-html-interactive-enhancer.html",
      "design-html-reading-experience-enhancer.html",
    ])
    expect(latestDesignHtmlArtifact(files)).toBe("design-html-reading-experience-enhancer.html")
    expect(previousDesignHtmlArtifact("interactive-enhancer", files)).toBe("design-html-html-designer.html")
    expect(previousDesignHtmlArtifact("reading-experience-enhancer", files)).toBe("design-html-interactive-enhancer.html")
  })

  test("falls back to legacy round artifacts", () => {
    expect(latestDesignHtmlArtifact(["design-html-round-0.html", "design-html-round-2.html"]))
      .toBe("design-html-round-2.html")
    expect(previousDesignHtmlArtifact("interactive-enhancer", ["design-html-round-0.html"]))
      .toBe("design-html-round-0.html")
  })
})
