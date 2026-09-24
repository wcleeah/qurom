import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { AgentRuntime } from "../src/agent-runtime/runtime"
import { KeepAliveSessionDeadError } from "../src/agent-runtime/keep-alive"
import { disposeDrafterWritingSession, draftFullDraft, reviseReadability } from "../src/graph"
import { emptyPromptBundle } from "../src/prompt-assets"
import type { ResearchState } from "../src/schema"
import { testRuntimeConfig } from "./test-env"

describe("drafter writing session reuse", () => {
  const requestId = "req-writing-session"

  afterEach(async () => {
    await disposeDrafterWritingSession(requestId)
  })

  test("reuses one keepAlive handle from draft through readability and snapshots round files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qurom-drafter-session-"))
    try {
      let createCount = 0
      const handles: string[] = []
      const runtime = {
        createHandle: async () => {
          createCount += 1
          const handle = {
            id: "drafter-session",
            providerId: "opencode",
            role: "research-drafter",
            title: "draft",
            keepAlive: false,
          }
          handles.push(handle.id)
          return handle
        },
        resumeHandle: async () => {
          throw new Error("should reuse the in-memory handle")
        },
        prompt: async (input: { outputFile?: string; outputAction?: string; inputFiles?: unknown[] }) => {
          expect(input.outputFile).toBe(join(dir, "draft.md"))
          if (input.outputAction === "edit") {
            expect(input.inputFiles).toBeUndefined()
            await Bun.write(input.outputFile!, "Edited article for readability.\n")
            return { text: "OK" }
          }
          await Bun.write(input.outputFile!, "First complete article.\n")
          return { text: "OK" }
        },
      } as unknown as AgentRuntime

      const base = {
        requestId,
        inputMode: "topic" as const,
        topic: "How framing works",
        round: 0,
        draft: "",
        audits: [],
        activeRebuttals: {},
        currentRebuttalResponsesByFinding: {},
        rebuttalTurnCounts: {},
        rebuttalHistory: [],
        rebuttalResponseHistory: [],
        unresolvedFindings: [],
        approvedAgents: [],
        outputPath: dir,
      }

      const drafted = await draftFullDraft(
        testRuntimeConfig({ dataDir: join(dir, "data") }),
        runtime,
        emptyPromptBundle({ researchDrafterDraft: "Write the article.\n" }),
        { ...base, status: "drafting" } as ResearchState,
      )

      expect(createCount).toBe(1)
      expect(drafted.draft).toContain("First complete article")
      expect(await Bun.file(join(dir, "draft.md")).text()).toContain("First complete article")
      expect(await Bun.file(join(dir, "draft-round-0.md")).text()).toContain("First complete article")

      await Bun.write(join(dir, "readability-round-0-try-0.json"), JSON.stringify({
        round: 0,
        try: 0,
        model: "jev-latest",
        passed: false,
        units: [],
        hotspots: [{
          unitId: "s1-p1",
          section: "Wire format",
          quote: "First complete article.",
          criterion: "convolution",
          score: 1.8,
          confidence: 0.74,
          remedy: "unnest",
        }],
      }))

      const revised = await reviseReadability(
        testRuntimeConfig({ dataDir: join(dir, "data") }),
        runtime,
        emptyPromptBundle({ researchDrafterReadabilityRevise: "Apply notes.\n{readabilityHints}\n" }),
        {
          ...base,
          draft: drafted.draft,
          readabilityTry: 0,
          status: "revising_readability",
        } as ResearchState,
      )

      expect(createCount).toBe(1)
      expect(handles).toEqual(["drafter-session"])
      expect(revised.draft).toContain("Edited article")
      expect(await Bun.file(join(dir, "draft.md")).text()).toContain("Edited article")
      expect(await Bun.file(join(dir, "draft-round-0.md")).text()).toContain("Edited article")
      expect(await Bun.file(join(dir, "draft-round-0-readability-1.md")).text()).toContain("Edited article")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("replaces a keepAlive drafter session that dies mid-turn and attaches the snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qurom-drafter-dead-"))
    try {
      let createCount = 0
      let readabilityPrompts = 0
      const runtime = {
        createHandle: async () => {
          createCount += 1
          return {
            id: `drafter-${createCount}`,
            providerId: "opencode",
            role: "research-drafter",
            title: "draft",
            keepAlive: false,
          }
        },
        resumeHandle: async () => {
          throw new Error("should not resume a dead drafter session")
        },
        prompt: async (input: {
          handle: { id: string }
          outputFile?: string
          outputAction?: string
          inputFiles?: Array<{ filename: string }>
        }) => {
          if (input.outputAction === "edit") {
            readabilityPrompts += 1
            if (readabilityPrompts === 1) {
              await Bun.write(input.outputFile!, "PARTIAL\n")
              throw new KeepAliveSessionDeadError(input.handle.id, "cancelled")
            }
            expect(input.handle.id).toBe("drafter-2")
            expect(input.inputFiles?.map((file) => file.filename)).toEqual(["draft.md"])
            expect(await Bun.file(join(dir, "draft.md")).text()).toContain("First complete article")
            await Bun.write(input.outputFile!, "Edited article for readability.\n")
            return { text: "OK" }
          }
          await Bun.write(input.outputFile!, "First complete article.\n")
          return { text: "OK" }
        },
      } as unknown as AgentRuntime

      const base = {
        requestId,
        inputMode: "topic" as const,
        topic: "How framing works",
        round: 0,
        draft: "",
        audits: [],
        activeRebuttals: {},
        currentRebuttalResponsesByFinding: {},
        rebuttalTurnCounts: {},
        rebuttalHistory: [],
        rebuttalResponseHistory: [],
        unresolvedFindings: [],
        approvedAgents: [],
        outputPath: dir,
      }

      const drafted = await draftFullDraft(
        testRuntimeConfig({ dataDir: join(dir, "data") }),
        runtime,
        emptyPromptBundle({ researchDrafterDraft: "Write the article.\n" }),
        { ...base, status: "drafting" } as ResearchState,
      )

      await Bun.write(join(dir, "readability-round-0-try-0.json"), JSON.stringify({
        round: 0,
        try: 0,
        model: "jev-latest",
        passed: false,
        units: [],
        hotspots: [{
          unitId: "s1-p1",
          section: "Wire format",
          quote: "First complete article.",
          criterion: "convolution",
          score: 1.8,
          confidence: 0.74,
          remedy: "unnest",
        }],
      }))

      const revised = await reviseReadability(
        testRuntimeConfig({ dataDir: join(dir, "data") }),
        runtime,
        emptyPromptBundle({ researchDrafterReadabilityRevise: "Apply notes.\n{readabilityHints}\n" }),
        {
          ...base,
          draft: drafted.draft,
          readabilityTry: 0,
          status: "revising_readability",
        } as ResearchState,
      )

      expect(createCount).toBe(2)
      expect(readabilityPrompts).toBe(2)
      expect(revised.draft).toContain("Edited article")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
