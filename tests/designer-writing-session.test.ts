import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "os"
import { join } from "node:path"

import type { AgentRuntime } from "../src/agent-runtime/runtime"
import { KeepAliveSessionDeadError } from "../src/agent-runtime/keep-alive"
import {
  designHtmlNode,
  disposeDesignerWritingSession,
  graphicalEnhanceNode,
  htmlReviewNode,
  persistDesignMarkdownInstructions,
  readingExperienceEnhanceNode,
} from "../src/graph"
import { emptyPromptBundle } from "../src/prompt-assets"
import type { ResearchState } from "../src/schema"
import { upsertSessionLedgerEntry } from "../src/session-ledger"
import { testRuntimeConfig } from "./test-env"

describe("designer writing session reuse", () => {
  const requestId = "req-design-session"

  afterEach(async () => {
    await disposeDesignerWritingSession(requestId)
  })

  test("reuses one keepAlive handle through generative design and mints html-reviewer separately", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qurom-designer-session-"))
    try {
      await Bun.write(join(dir, "final.md"), "# Approved article\n")
      const createdRoles: string[] = []
      const createdHandles: Array<{ role: string; keepAlive?: boolean }> = []
      const runtime = {
        createHandle: async (role: string) => {
          createdRoles.push(role)
          const handle = {
            id: role === "html-reviewer" ? "reviewer-session" : "designer-session",
            providerId: "opencode",
            role,
            title: role,
            keepAlive: false,
          }
          createdHandles.push(handle)
          return handle
        },
        resumeHandle: async () => {
          throw new Error("should reuse the in-memory designer handle")
        },
        prompt: async (input: {
          role: string
          handle: { id: string }
          outputFile?: string
          outputAction?: string
          inputFiles?: Array<{ filename: string }>
        }) => {
          if (input.role === "html-designer") {
            expect(input.outputFile).toBe(join(dir, "design.html"))
            expect(input.outputAction).toBeUndefined()
            expect(input.inputFiles?.map((file) => file.filename)).toEqual(["content.md"])
            await Bun.write(input.outputFile!, "<html><body>Designed</body></html>\n")
            return { text: "OK" }
          }
          if (input.role === "graphical-enhancer" || input.role === "reading-experience-enhancer") {
            expect(input.handle.id).toBe("designer-session")
            expect(input.outputFile).toBe(join(dir, "design.html"))
            expect(input.outputAction).toBe("edit")
            expect(input.inputFiles).toBeUndefined()
            const suffix = input.role === "graphical-enhancer" ? "Graphics" : "Reading"
            await Bun.write(input.outputFile!, `<html><body>${suffix}</body></html>\n`)
            return { text: "OK" }
          }
          expect(input.role).toBe("html-reviewer")
          expect(input.handle.id).toBe("reviewer-session")
          expect(input.inputFiles?.map((file) => file.filename)).toEqual(["document.html"])
          await Bun.write(input.outputFile!, "<html><body>Reviewed</body></html>\n")
          return { text: "OK" }
        },
      } as unknown as AgentRuntime

      const config = testRuntimeConfig({
        dataDir: join(dir, "data"),
        quorumOverrides: { designQuorum: { enabled: true } },
      })
      const prompts = emptyPromptBundle({
        htmlDesignerDesign: "Design {topic}.\n",
        graphicalEnhancerEnhance: "Add figures.\n",
        readingExperienceEnhancerEnhance: "Add reading chrome.\n",
        htmlReviewerReview: "Check layout.\n",
      })
      const base = {
        requestId,
        inputMode: "topic" as const,
        topic: "How framing works",
        round: 0,
        draft: "# Approved article\n",
        audits: [],
        activeRebuttals: {},
        currentRebuttalResponsesByFinding: {},
        rebuttalTurnCounts: {},
        rebuttalHistory: [],
        rebuttalResponseHistory: [],
        unresolvedFindings: [],
        approvedAgents: [],
        status: "approved" as const,
        outputPath: dir,
      }

      const designed = await designHtmlNode(config, runtime, prompts, { ...base } as ResearchState)
      expect(createdRoles).toEqual(["html-designer"])
      expect(createdHandles[0]?.keepAlive).toBe(true)
      expect(designed.designHtml).toContain("Designed")
      expect(await Bun.file(join(dir, "design.html")).text()).toContain("Designed")
      expect(await Bun.file(join(dir, "design-html-html-designer.html")).text()).toContain("Designed")

      const graphed = await graphicalEnhanceNode(config, runtime, prompts, designed)
      expect(createdRoles).toEqual(["html-designer"])
      expect(graphed.designHtml).toContain("Graphics")
      expect(await Bun.file(join(dir, "design-html-graphical-enhancer.html")).text()).toContain("Graphics")

      const reading = await readingExperienceEnhanceNode(config, runtime, prompts, graphed)
      expect(createdRoles).toEqual(["html-designer"])
      expect(reading.designHtml).toContain("Reading")
      expect(await Bun.file(join(dir, "design-html-reading-experience-enhancer.html")).text()).toContain("Reading")

      const reviewed = await htmlReviewNode(config, runtime, prompts, reading)
      expect(createdRoles).toEqual(["html-designer", "html-reviewer"])
      expect(createdHandles[1]?.keepAlive).not.toBe(true)
      expect(reviewed.designHtml).toContain("Reviewed")
      expect(await Bun.file(join(dir, "design-html-html-reviewer.html")).text()).toContain("Reviewed")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("asks inline providers to persist content.md on the first design prompt only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qurom-designer-persist-md-"))
    try {
      await Bun.write(join(dir, "final.md"), "# Approved article\n")
      const promptsSeen: string[] = []
      const runtime = {
        createHandle: async (role: string) => ({
          id: "designer-session",
          providerId: "cursor",
          role,
          title: role,
          keepAlive: false,
        }),
        resumeHandle: async () => {
          throw new Error("should reuse the in-memory designer handle")
        },
        prompt: async (input: {
          role: string
          prompt?: string
          outputFile?: string
          outputAction?: string
          inputFiles?: Array<{ filename: string }>
        }) => {
          promptsSeen.push(input.prompt ?? "")
          if (input.role === "html-designer") {
            expect(input.inputFiles?.map((file) => file.filename)).toEqual(["content.md"])
            expect(input.prompt).toContain(persistDesignMarkdownInstructions().trim())
            await Bun.write(input.outputFile!, "<html><body>Designed</body></html>\n")
            return { text: "OK" }
          }
          expect(input.role).toBe("graphical-enhancer")
          expect(input.inputFiles).toBeUndefined()
          expect(input.prompt).not.toContain("persist that markdown verbatim")
          await Bun.write(input.outputFile!, "<html><body>Graphics</body></html>\n")
          return { text: "OK" }
        },
        providerForRole: () => ({
          id: "cursor",
          capabilities: new Set(["inlineInputContext", "fileOutput"]),
        }),
      } as unknown as AgentRuntime

      const config = testRuntimeConfig({
        dataDir: join(dir, "data"),
        quorumOverrides: { designQuorum: { enabled: true } },
      })
      const prompts = emptyPromptBundle({
        htmlDesignerDesign: "Design {topic}.\n",
        graphicalEnhancerEnhance: "Add figures.\n",
      })
      const base = {
        requestId,
        inputMode: "topic" as const,
        topic: "How framing works",
        round: 0,
        draft: "# Approved article\n",
        audits: [],
        activeRebuttals: {},
        currentRebuttalResponsesByFinding: {},
        rebuttalTurnCounts: {},
        rebuttalHistory: [],
        rebuttalResponseHistory: [],
        unresolvedFindings: [],
        approvedAgents: [],
        status: "approved" as const,
        outputPath: dir,
      }

      const designed = await designHtmlNode(config, runtime, prompts, { ...base } as ResearchState)
      await graphicalEnhanceNode(config, runtime, prompts, designed)
      expect(promptsSeen).toHaveLength(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("resumes the html-designer session from the ledger after process restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qurom-designer-resume-"))
    try {
      await Bun.write(join(dir, "design.html"), "<html><body>Designed</body></html>\n")
      await Bun.write(join(dir, "design-html-html-designer.html"), "<html><body>Designed</body></html>\n")
      await upsertSessionLedgerEntry(dir, {
        role: "html-designer",
        node: "runDesignHtml",
        round: 0,
        requestId,
        handleId: "designer-session",
        status: "finished",
      })

      let created = 0
      let resumed = 0
      const runtime = {
        createHandle: async () => {
          created += 1
          throw new Error("should resume the designer writing session")
        },
        resumeHandle: async (role: string, _title: string, handleId: string) => {
          resumed += 1
          expect(role).toBe("html-designer")
          expect(handleId).toBe("designer-session")
          return {
            id: handleId,
            providerId: "opencode",
            role,
            title: "html-designer",
            keepAlive: false,
          }
        },
        prompt: async (input: {
          role: string
          handle: { id: string; keepAlive?: boolean }
          outputFile?: string
          outputAction?: string
          inputFiles?: unknown[]
        }) => {
          expect(input.role).toBe("graphical-enhancer")
          expect(input.handle.id).toBe("designer-session")
          expect(input.handle.keepAlive).toBe(true)
          expect(input.outputFile).toBe(join(dir, "design.html"))
          expect(input.outputAction).toBe("edit")
          expect(input.inputFiles).toBeUndefined()
          await Bun.write(input.outputFile!, "<html><body>Graphics</body></html>\n")
          return { text: "OK" }
        },
      } as unknown as AgentRuntime

      const graphed = await graphicalEnhanceNode(
        testRuntimeConfig({
          dataDir: join(dir, "data"),
          quorumOverrides: { designQuorum: { enabled: true } },
        }),
        runtime,
        emptyPromptBundle({ graphicalEnhancerEnhance: "Add figures.\n" }),
        {
          requestId,
          inputMode: "topic",
          topic: "How framing works",
          round: 0,
          draft: "# Approved article\n",
          audits: [],
          activeRebuttals: {},
          currentRebuttalResponsesByFinding: {},
          rebuttalTurnCounts: {},
          rebuttalHistory: [],
          rebuttalResponseHistory: [],
          unresolvedFindings: [],
          approvedAgents: [],
          status: "approved",
          outputPath: dir,
          designHtml: "<html><body>Designed</body></html>\n",
          designStatus: "running",
          designRound: 0,
        } as ResearchState,
      )

      expect(created).toBe(0)
      expect(resumed).toBe(1)
      expect(graphed.designHtml).toContain("Graphics")
      expect(await Bun.file(join(dir, "design-html-graphical-enhancer.html")).text()).toContain("Graphics")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("does not reattach a dead designer session; restores snapshot and attaches HTML", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qurom-designer-dead-"))
    try {
      await Bun.write(join(dir, "design.html"), "<html><body>PARTIAL</body></html>\n")
      await Bun.write(join(dir, "design-html-html-designer.html"), "<html><body>Designed</body></html>\n")
      await upsertSessionLedgerEntry(dir, {
        role: "html-designer",
        node: "runDesignHtml",
        round: 0,
        requestId,
        handleId: "bc-dead",
        status: "finished",
      })
      await upsertSessionLedgerEntry(dir, {
        role: "html-designer",
        node: "graphicalEnhance",
        round: 0,
        requestId,
        handleId: "bc-dead",
        status: "error",
      })

      let created = 0
      let resumed = 0
      const runtime = {
        createHandle: async (role: string) => {
          created += 1
          return {
            id: "designer-fresh",
            providerId: "opencode",
            role,
            title: "html-designer",
            keepAlive: false,
          }
        },
        resumeHandle: async () => {
          resumed += 1
          throw new Error("should not resume a dead designer session")
        },
        prompt: async (input: {
          role: string
          handle: { id: string }
          outputFile?: string
          outputAction?: string
          inputFiles?: Array<{ filename: string }>
        }) => {
          expect(input.role).toBe("graphical-enhancer")
          expect(input.handle.id).toBe("designer-fresh")
          expect(input.outputAction).toBe("edit")
          expect(input.inputFiles?.map((file) => file.filename)).toEqual(["document.html", "content.md"])
          expect(await Bun.file(join(dir, "design.html")).text()).toContain("Designed")
          await Bun.write(input.outputFile!, "<html><body>Graphics</body></html>\n")
          return { text: "OK" }
        },
      } as unknown as AgentRuntime

      const graphed = await graphicalEnhanceNode(
        testRuntimeConfig({
          dataDir: join(dir, "data"),
          quorumOverrides: { designQuorum: { enabled: true } },
        }),
        runtime,
        emptyPromptBundle({ graphicalEnhancerEnhance: "Add figures.\n" }),
        {
          requestId,
          inputMode: "topic",
          topic: "How framing works",
          round: 0,
          draft: "# Approved article\n",
          audits: [],
          activeRebuttals: {},
          currentRebuttalResponsesByFinding: {},
          rebuttalTurnCounts: {},
          rebuttalHistory: [],
          rebuttalResponseHistory: [],
          unresolvedFindings: [],
          approvedAgents: [],
          status: "approved",
          outputPath: dir,
          designHtml: "<html><body>PARTIAL</body></html>\n",
          designStatus: "running",
          designRound: 0,
        } as ResearchState,
      )

      expect(created).toBe(1)
      expect(resumed).toBe(0)
      expect(graphed.designHtml).toContain("Graphics")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("replaces a keepAlive designer session that dies mid-turn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qurom-designer-die-"))
    try {
      await Bun.write(join(dir, "final.md"), "# Approved article\n")
      let createCount = 0
      let enhancePrompts = 0
      const runtime = {
        createHandle: async (role: string) => {
          createCount += 1
          return {
            id: `designer-${createCount}`,
            providerId: "opencode",
            role,
            title: role,
            keepAlive: false,
          }
        },
        resumeHandle: async () => {
          throw new Error("should not resume a dead designer session")
        },
        prompt: async (input: {
          role: string
          handle: { id: string }
          outputFile?: string
          outputAction?: string
          inputFiles?: Array<{ filename: string }>
        }) => {
          if (input.role === "html-designer") {
            await Bun.write(input.outputFile!, "<html><body>Designed</body></html>\n")
            return { text: "OK" }
          }
          enhancePrompts += 1
          if (enhancePrompts === 1) {
            await Bun.write(input.outputFile!, "<html><body>PARTIAL</body></html>\n")
            throw new KeepAliveSessionDeadError(input.handle.id, "cancelled")
          }
          expect(input.handle.id).toBe("designer-2")
          expect(input.inputFiles?.map((file) => file.filename)).toEqual(["document.html", "content.md"])
          expect(await Bun.file(join(dir, "design.html")).text()).toContain("Designed")
          await Bun.write(input.outputFile!, "<html><body>Graphics</body></html>\n")
          return { text: "OK" }
        },
      } as unknown as AgentRuntime

      const config = testRuntimeConfig({
        dataDir: join(dir, "data"),
        quorumOverrides: { designQuorum: { enabled: true } },
      })
      const prompts = emptyPromptBundle({
        htmlDesignerDesign: "Design {topic}.\n",
        graphicalEnhancerEnhance: "Add figures.\n",
      })
      const designed = await designHtmlNode(config, runtime, prompts, {
        requestId,
        inputMode: "topic",
        topic: "How framing works",
        round: 0,
        draft: "# Approved article\n",
        audits: [],
        activeRebuttals: {},
        currentRebuttalResponsesByFinding: {},
        rebuttalTurnCounts: {},
        rebuttalHistory: [],
        rebuttalResponseHistory: [],
        unresolvedFindings: [],
        approvedAgents: [],
        status: "approved",
        outputPath: dir,
      } as ResearchState)

      const graphed = await graphicalEnhanceNode(config, runtime, prompts, designed)
      expect(createCount).toBe(2)
      expect(enhancePrompts).toBe(2)
      expect(graphed.designHtml).toContain("Graphics")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
