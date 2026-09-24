import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { AgentRuntime } from "../src/agent-runtime/runtime"
import { KeepAliveSessionDeadError } from "../src/agent-runtime/keep-alive"
import { FINDINGS_WORKING_FILENAME, findingsWorkingPath, unresolvedFindingsFilename } from "../src/draft-artifacts"
import {
  disposeDrafterWritingSession,
  draftFullDraft,
  persistFindingsPrompt,
  providerPersistsFindingsToWorkspace,
  reviseDraft,
  revisionPrompt,
} from "../src/graph"
import { promptAssetFiles } from "../src/prompt-asset-defs"
import { emptyPromptBundle } from "../src/prompt-assets"
import type { ProviderCapability } from "../src/providers/types"
import type { AggregatedFinding, ResearchState } from "../src/schema"
import { testRuntimeConfig } from "./test-env"

const requestId = "req-revise-findings"

const finding: AggregatedFinding = {
  findingId: "finding-1",
  agent: "logic-auditor",
  severity: "major",
  category: "coherence",
  issue: "Contradiction in section 2.",
  evidence: ["Claim A conflicts with Claim B."],
  required_fix: "Resolve the contradiction.",
}

const readerProfile = {
  intent: { goal: "evaluate framing", depth: "evaluation" as const, secondaryGoals: [] },
  background: { summary: "Knows TCP" },
  competence: {
    inTopic: { level: "intermediate" as const, summary: "Can sketch a frame", evidence: ["drew a frame"] },
    adjacent: { summary: "Networking", evidence: [] },
  },
  inferredGaps: [],
}

function baseState(dir: string, status: ResearchState["status"]): ResearchState {
  return {
    requestId,
    inputMode: "topic",
    topic: "How framing works",
    round: 0,
    draft: status === "drafting" ? "" : "First complete article.\n",
    audits: [],
    activeRebuttals: {},
    currentRebuttalResponsesByFinding: {},
    rebuttalTurnCounts: {},
    rebuttalHistory: [],
    rebuttalResponseHistory: [],
    unresolvedFindings: status === "revising" ? [finding] : [],
    approvedAgents: [],
    outputPath: dir,
    status,
    readerProfile,
  } as ResearchState
}

const prompts = emptyPromptBundle({
  researchDrafterDraft: "Write the article.\n",
  researchDrafterPersistFindings: "Persist findings.\nRequest: {requestLabel}\n",
  researchDrafterRevise: "Revise the article.\n{standingContext}Request: {requestLabel}\n",
})

type PromptCall = {
  handleId: string
  outputFile?: string
  outputAction?: string
  filenames?: string[]
  prompt: string
}

function runtimeWithCapabilities(input: {
  capabilities: ProviderCapability[]
  prompt: AgentRuntime["prompt"]
}): AgentRuntime {
  let createCount = 0
  return {
    createHandle: async () => {
      createCount += 1
      return {
        id: `drafter-${createCount}`,
        providerId: input.capabilities.includes("inputFileAttachments") ? "opencode" : "cursor",
        role: "research-drafter",
        title: "draft",
        keepAlive: false,
      }
    },
    resumeHandle: async () => {
      throw new Error("should reuse the in-memory handle")
    },
    prompt: input.prompt,
    providerForRole: () => ({
      id: input.capabilities.includes("inputFileAttachments") ? "opencode" : "cursor",
      capabilities: new Set(input.capabilities),
    }),
  } as unknown as AgentRuntime
}

describe("reviseDraft findings durability", () => {
  afterEach(async () => {
    await disposeDrafterWritingSession(requestId)
  })

  async function withDir<T>(fn: (dir: string) => Promise<T>) {
    const dir = await mkdtemp(join(tmpdir(), "qurom-revise-findings-"))
    try {
      return await fn(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  test("attachment providers skip persist and attach findings.json on the follow-up", async () => {
    await withDir(async (dir) => {
      const calls: PromptCall[] = []
      const runtime = runtimeWithCapabilities({
        capabilities: ["inputFileAttachments", "fileOutput"],
        prompt: async (input) => {
          calls.push({
            handleId: input.handle.id,
            outputFile: input.outputFile,
            outputAction: input.outputAction,
            filenames: input.inputFiles?.map((file) => file.filename),
            prompt: input.prompt,
          })
          const text = input.outputAction === "edit" ? "Revised article.\n" : "First complete article.\n"
          await Bun.write(input.outputFile!, text)
          return { text: "OK" }
        },
      })

      const config = testRuntimeConfig({ dataDir: join(dir, "data") })
      await draftFullDraft(config, runtime, prompts, baseState(dir, "drafting"))
      const revised = await reviseDraft(config, runtime, prompts, baseState(dir, "revising"))

      expect(calls).toHaveLength(2)
      expect(calls[1]?.outputFile).toBe(join(dir, "draft.md"))
      expect(calls[1]?.outputAction).toBe("edit")
      expect(calls[1]?.filenames).toEqual(["findings.json"])
      expect(calls[1]?.prompt).not.toContain("Persist findings.")
      expect(calls[1]?.prompt).not.toContain("Research tool preferences")
      expect(revised.draft).toContain("Revised article")
      expect(await Bun.file(findingsWorkingPath(dir)).text()).toContain("Contradiction in section 2")
      expect(await Bun.file(join(dir, unresolvedFindingsFilename(0))).text()).toContain("finding-1")
    })
  })

  test("inline file-output providers persist findings before revise and do not re-inline them", async () => {
    await withDir(async (dir) => {
      const calls: PromptCall[] = []
      const runtime = runtimeWithCapabilities({
        capabilities: ["inlineInputContext", "fileOutput"],
        prompt: async (input) => {
          calls.push({
            handleId: input.handle.id,
            outputFile: input.outputFile,
            outputAction: input.outputAction,
            filenames: input.inputFiles?.map((file) => file.filename),
            prompt: input.prompt,
          })
          if (input.outputFile?.endsWith(FINDINGS_WORKING_FILENAME)) {
            expect(input.outputAction).toBe("write")
            expect(input.prompt).toContain("Persist findings.")
            expect(input.prompt).not.toContain("Research tool preferences")
            expect(input.prompt).not.toContain("Reader calibration")
            return { text: "OK" }
          }
          const text = input.outputAction === "edit" ? "Revised article.\n" : "First complete article.\n"
          await Bun.write(input.outputFile!, text)
          return { text: "OK" }
        },
      })

      const config = testRuntimeConfig({ dataDir: join(dir, "data") })
      await draftFullDraft(config, runtime, prompts, baseState(dir, "drafting"))
      const revised = await reviseDraft(config, runtime, prompts, baseState(dir, "revising"))

      expect(calls).toHaveLength(3)
      expect(calls[1]?.outputFile).toBe(findingsWorkingPath(dir))
      expect(calls[1]?.filenames).toEqual(["findings.json"])
      expect(calls[2]?.outputFile).toBe(join(dir, "draft.md"))
      expect(calls[2]?.outputAction).toBe("edit")
      expect(calls[2]?.filenames).toBeUndefined()
      expect(calls[2]?.prompt).toContain("Revise the article.")
      expect(calls[2]?.prompt).not.toContain("Persist findings.")
      expect(calls[2]?.prompt).not.toContain("Research tool preferences")
      expect(revised.draft).toContain("Revised article")
    })
  })

  test("re-persists findings on a replacement session if revise dies after persist", async () => {
    await withDir(async (dir) => {
      let persistCount = 0
      let reviseCount = 0
      const calls: PromptCall[] = []
      const runtime = runtimeWithCapabilities({
        capabilities: ["inlineInputContext", "fileOutput"],
        prompt: async (input) => {
          calls.push({
            handleId: input.handle.id,
            outputFile: input.outputFile,
            outputAction: input.outputAction,
            filenames: input.inputFiles?.map((file) => file.filename),
            prompt: input.prompt,
          })
          if (input.outputFile?.endsWith(FINDINGS_WORKING_FILENAME)) {
            persistCount += 1
            return { text: "OK" }
          }
          if (input.outputAction === "edit") {
            reviseCount += 1
            if (reviseCount === 1) {
              throw new KeepAliveSessionDeadError(input.handle.id, "cancelled")
            }
            expect(input.handle.id).toBe("drafter-2")
            expect(input.inputFiles?.map((file) => file.filename)).toEqual(["draft.md"])
            expect(input.prompt).toContain("Research tool preferences")
            await Bun.write(input.outputFile!, "Revised article.\n")
            return { text: "OK" }
          }
          await Bun.write(input.outputFile!, "First complete article.\n")
          return { text: "OK" }
        },
      })

      const config = testRuntimeConfig({ dataDir: join(dir, "data") })
      await draftFullDraft(config, runtime, prompts, baseState(dir, "drafting"))
      const revised = await reviseDraft(config, runtime, prompts, baseState(dir, "revising"))

      expect(persistCount).toBe(2)
      expect(reviseCount).toBe(2)
      expect(calls.map((call) => call.handleId)).toEqual([
        "drafter-1",
        "drafter-1",
        "drafter-1",
        "drafter-2",
        "drafter-2",
      ])
      expect(revised.draft).toContain("Revised article")
    })
  })
})

describe("revise findings prompt assets", () => {
  test("registers persist-findings and tells revise to re-read findings.json", async () => {
    expect(promptAssetFiles.researchDrafterPersistFindings).toBe("research-drafter.persist-findings.md")
    expect(promptAssetFiles.researchDrafterRevise).toBe("research-drafter.revise.md")

    const persist = await Bun.file(join("defaults", "prompts", "research-drafter.persist-findings.md")).text()
    expect(persist).toContain("verbatim")
    expect(persist).toContain("Do not edit the article")

    const revise = await Bun.file(join("defaults", "prompts", "research-drafter.revise.md")).text()
    expect(revise).toContain("findings.json")
    expect(revise).toContain("compacted")
  })

  test("persistFindingsPrompt stays small and omits standing context", () => {
    const text = persistFindingsPrompt(prompts, baseState("/tmp/qurom-persist-prompt", "revising"))
    expect(text).toContain("Persist findings.")
    expect(text).toContain("How framing works")
    expect(text).not.toContain("Research tool preferences")
    expect(text).not.toContain("Reader calibration")
  })

  test("revisionPrompt still omits standing context on follow-up turns", () => {
    const omitted = revisionPrompt(
      testRuntimeConfig({ dataDir: "/tmp/qurom-revision-findings-standing" }),
      prompts,
      baseState("/tmp/qurom-revision-findings-standing", "revising"),
      { includeStandingContext: false },
    )
    expect(omitted).not.toContain("Research tool preferences")
    expect(omitted).not.toContain("Reader calibration")
    expect(omitted).toContain("How framing works")
  })
})

describe("providerPersistsFindingsToWorkspace", () => {
  test("persists only for inline file-output providers", () => {
    expect(providerPersistsFindingsToWorkspace({
      providerForRole: () => ({ capabilities: new Set(["inlineInputContext", "fileOutput"]) }),
    } as unknown as AgentRuntime, "research-drafter")).toBe(true)

    expect(providerPersistsFindingsToWorkspace({
      providerForRole: () => ({ capabilities: new Set(["inputFileAttachments", "fileOutput"]) }),
    } as unknown as AgentRuntime, "research-drafter")).toBe(false)

    expect(providerPersistsFindingsToWorkspace({} as AgentRuntime, "research-drafter")).toBe(false)
  })
})
