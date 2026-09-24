import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { AgentRuntime } from "../src/agent-runtime/runtime"
import { FINDINGS_MCP_TOKEN_OPTION, resetFindingsMcpGrantsForTests } from "../src/findings-mcp"
import { findingsWorkingPath, unresolvedFindingsFilename } from "../src/draft-artifacts"
import {
  disposeDrafterWritingSession,
  draftFullDraft,
  providerUsesFindingsMcp,
  reviseDraft,
} from "../src/graph"
import { emptyPromptBundle } from "../src/prompt-assets"
import type { ProviderCapability } from "../src/providers/types"
import type { AggregatedFinding, ResearchState } from "../src/schema"
import { testRuntimeConfig } from "./test-env"

const requestId = "req-findings-mcp"

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
  researchDrafterRevise: "Revise the article.\n{standingContext}Request: {requestLabel}\n",
})

type PromptCall = {
  outputFile?: string
  outputAction?: string
  filenames?: string[]
}

function runtimeWithCapabilities(input: {
  capabilities: ProviderCapability[]
  prompt: AgentRuntime["prompt"]
  onCreate?: (options?: { providerOptions?: Record<string, unknown> }) => void
}): AgentRuntime {
  let createCount = 0
  return {
    createHandle: async (_role, _title, _parent, options) => {
      createCount += 1
      input.onCreate?.(options)
      return {
        id: `drafter-${createCount}`,
        providerId: input.capabilities.includes("inputFileAttachments") ? "opencode" : "cursor",
        role: "research-drafter",
        title: "draft",
        keepAlive: false,
        findingsMcpToken: typeof options?.providerOptions?.[FINDINGS_MCP_TOKEN_OPTION] === "string"
          ? options.providerOptions[FINDINGS_MCP_TOKEN_OPTION]
          : undefined,
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

describe("reviseDraft findings MCP", () => {
  afterEach(async () => {
    await disposeDrafterWritingSession(requestId)
    resetFindingsMcpGrantsForTests()
  })

  async function withDir<T>(fn: (dir: string) => Promise<T>) {
    const dir = await mkdtemp(join(tmpdir(), "qurom-revise-mcp-"))
    try {
      return await fn(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  test("attachment providers skip MCP and attach findings.json", async () => {
    await withDir(async (dir) => {
      const calls: PromptCall[] = []
      let createOptions: { providerOptions?: Record<string, unknown> } | undefined
      const runtime = runtimeWithCapabilities({
        capabilities: ["inputFileAttachments", "fileOutput"],
        onCreate: (options) => {
          createOptions = options
        },
        prompt: async (input) => {
          calls.push({
            outputFile: input.outputFile,
            outputAction: input.outputAction,
            filenames: input.inputFiles?.map((file) => file.filename),
          })
          const text = input.outputAction === "edit" ? "Revised article.\n" : "First complete article.\n"
          await Bun.write(input.outputFile!, text)
          return { text: "OK" }
        },
      })

      const config = testRuntimeConfig({ dataDir: join(dir, "data") })
      await draftFullDraft(config, runtime, prompts, baseState(dir, "drafting"))
      const revised = await reviseDraft(config, runtime, prompts, baseState(dir, "revising"))

      expect(createOptions?.providerOptions?.[FINDINGS_MCP_TOKEN_OPTION]).toBeUndefined()
      expect(calls[1]?.filenames).toEqual(["findings.json"])
      expect(revised.draft).toContain("Revised article")
      expect(await Bun.file(findingsWorkingPath(dir)).text()).toContain("Contradiction in section 2")
      expect(await Bun.file(join(dir, unresolvedFindingsFilename(0))).text()).toContain("finding-1")
    })
  })

  test("inline providers mint a findings MCP token and do not inline findings", async () => {
    await withDir(async (dir) => {
      const calls: PromptCall[] = []
      let createOptions: { providerOptions?: Record<string, unknown> } | undefined
      const runtime = runtimeWithCapabilities({
        capabilities: ["inlineInputContext", "fileOutput"],
        onCreate: (options) => {
          createOptions = options
        },
        prompt: async (input) => {
          calls.push({
            outputFile: input.outputFile,
            outputAction: input.outputAction,
            filenames: input.inputFiles?.map((file) => file.filename),
          })
          const text = input.outputAction === "edit" ? "Revised article.\n" : "First complete article.\n"
          await Bun.write(input.outputFile!, text)
          return { text: "OK" }
        },
      })

      const config = testRuntimeConfig({ dataDir: join(dir, "data") })
      await draftFullDraft(config, runtime, prompts, baseState(dir, "drafting"))
      const revised = await reviseDraft(config, runtime, prompts, baseState(dir, "revising"))

      expect(typeof createOptions?.providerOptions?.[FINDINGS_MCP_TOKEN_OPTION]).toBe("string")
      expect(calls[1]?.outputAction).toBe("edit")
      expect(calls[1]?.filenames).toBeUndefined()
      expect(revised.draft).toContain("Revised article")
    })
  })
})

describe("providerUsesFindingsMcp", () => {
  test("uses MCP only when the provider cannot attach files", () => {
    expect(providerUsesFindingsMcp({
      providerForRole: () => ({ capabilities: new Set(["inlineInputContext", "fileOutput"]) }),
    } as unknown as AgentRuntime, "research-drafter")).toBe(true)
    expect(providerUsesFindingsMcp({
      providerForRole: () => ({ capabilities: new Set(["inputFileAttachments", "fileOutput"]) }),
    } as unknown as AgentRuntime, "research-drafter")).toBe(false)
    expect(providerUsesFindingsMcp({} as AgentRuntime, "research-drafter")).toBe(false)
  })
})
