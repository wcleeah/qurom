import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  DESIGN_WORKING_FILENAME,
  designHtmlArtifactName,
  designHtmlArtifacts,
  designStageLabel,
  designWorkingPath,
  latestDesignHtmlArtifact,
  presentDesignHtmlArtifact,
  previousDesignHtmlArtifact,
  restoreWorkingDesignFromPreviousSnapshot,
  snapshotWorkingDesign,
} from "../src/design-artifacts.ts"

describe("design artifacts", () => {
  test("names artifacts by role", () => {
    expect(designHtmlArtifactName("html-designer")).toBe("design-html-html-designer.html")
    expect(designHtmlArtifactName("graphical-enhancer")).toBe("design-html-graphical-enhancer.html")
    expect(designHtmlArtifactName("interactive-enhancer")).toBe("design-html-interactive-enhancer.html")
    expect(designHtmlArtifactName("reading-experience-enhancer")).toBe("design-html-reading-experience-enhancer.html")
    expect(designHtmlArtifactName("html-reviewer")).toBe("design-html-html-reviewer.html")
  })

  test("labels design stages without round language", () => {
    expect(designStageLabel("html-designer")).toBe("HTML designer")
    expect(designStageLabel("graphical-enhancer")).toBe("Graphical enhancer")
    expect(designStageLabel("reading-experience-enhancer")).toBe("Reading experience")
    expect(designStageLabel("html-reviewer")).toBe("HTML review")
  })

  test("orders pipeline artifacts and prefers the latest role stage", () => {
    const files = [
      "design-html-reading-experience-enhancer.html",
      "design-html-html-designer.html",
      "design-html-graphical-enhancer.html",
      "design-html-html-reviewer.html",
      "final.html",
    ]
    expect(designHtmlArtifacts(files)).toEqual([
      "design-html-html-designer.html",
      "design-html-graphical-enhancer.html",
      "design-html-reading-experience-enhancer.html",
      "design-html-html-reviewer.html",
    ])
    expect(latestDesignHtmlArtifact(files)).toBe("design-html-html-reviewer.html")
    expect(previousDesignHtmlArtifact("graphical-enhancer", files)).toBe("design-html-html-designer.html")
    expect(previousDesignHtmlArtifact("reading-experience-enhancer", files)).toBe("design-html-graphical-enhancer.html")
    expect(previousDesignHtmlArtifact("html-reviewer", files)).toBe("design-html-reading-experience-enhancer.html")
  })

  test("treats the retired interactive-enhancer filename as the graphical stage", () => {
    const files = [
      "design-html-html-designer.html",
      "design-html-interactive-enhancer.html",
      "design-html-reading-experience-enhancer.html",
    ]
    expect(presentDesignHtmlArtifact("graphical-enhancer", files)).toBe("design-html-interactive-enhancer.html")
    expect(designHtmlArtifacts(files)).toEqual([
      "design-html-html-designer.html",
      "design-html-interactive-enhancer.html",
      "design-html-reading-experience-enhancer.html",
    ])
    expect(previousDesignHtmlArtifact("reading-experience-enhancer", files)).toBe("design-html-interactive-enhancer.html")
  })

  test("falls back to legacy round artifacts", () => {
    expect(latestDesignHtmlArtifact(["design-html-round-0.html", "design-html-round-2.html"]))
      .toBe("design-html-round-2.html")
    expect(previousDesignHtmlArtifact("graphical-enhancer", ["design-html-round-0.html"]))
      .toBe("design-html-round-0.html")
  })

  test("snapshots the live working HTML to a role artifact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qurom-design-working-"))
    try {
      expect(designWorkingPath(dir)).toBe(join(dir, DESIGN_WORKING_FILENAME))
      await Bun.write(join(dir, DESIGN_WORKING_FILENAME), "<html><body>Live</body></html>\n")
      const text = await snapshotWorkingDesign(dir, designHtmlArtifactName("html-designer"))
      expect(text).toContain("Live")
      expect(await Bun.file(join(dir, "design-html-html-designer.html")).text()).toContain("Live")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("restores design.html from the previous role snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qurom-design-restore-"))
    try {
      await Bun.write(join(dir, "design-html-html-designer.html"), "<html><body>Designed</body></html>\n")
      await Bun.write(join(dir, "design.html"), "<html><body>PARTIAL</body></html>\n")
      const name = await restoreWorkingDesignFromPreviousSnapshot(dir, "graphical-enhancer")
      expect(name).toBe("design-html-html-designer.html")
      expect(await Bun.file(join(dir, "design.html")).text()).toContain("Designed")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
