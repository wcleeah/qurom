import { describe, expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createAgentRuntime } from "../src/agent-runtime/runtime"
import type { RuntimeConfig } from "../src/config"
import { createEventBus, type RunnerEvent } from "../src/runner"
import type { AgentProvider } from "../src/providers/types"
import { testQuorumConfig, testRuntimeEnv, unitTestDataDir } from "./test-env"

const config: RuntimeConfig = {
  env: {
    ...testRuntimeEnv({ dataDir: unitTestDataDir("agent-runtime"), workspaceDir: process.cwd() }),
    CURSOR_API_KEY: undefined,
    LANGFUSE_PUBLIC_KEY: undefined,
    LANGFUSE_SECRET_KEY: undefined,
    LANGFUSE_BASE_URL: undefined,
  },
  quorumConfig: testQuorumConfig({
    maxRounds: 1,
    researchTools: { prefer: ["webfetch"], webSearchProvider: "exa" },
  }),
  roleBindings: {},
}

function collect(bus: ReturnType<typeof createEventBus>) {
  const events: RunnerEvent[] = []
  bus.on((event) => events.push(event))
  return events
}

describe("createAgentRuntime", () => {
  test("emits coarse events for a provider without streaming", async () => {
    const provider: AgentProvider = {
      id: "fake",
      capabilities: new Set(["plainJsonOutput"]),
      async createRunHandle(input) {
        return {
          id: `handle:${input.role}`,
          providerId: "fake",
          role: input.role,
          title: input.title,
        }
      },
      async prompt() {
        return { text: "ok", provider: "fake-provider", model: "fake-model" }
      },
    }
    const bus = createEventBus()
    const events = collect(bus)
    const runtime = createAgentRuntime(config, bus, { providerForRole: () => provider })

    const handle = await runtime.createHandle("research-drafter", "draft")
    const result = await runtime.prompt({ role: "research-drafter", handle, prompt: "hello" })

    expect(result.text).toBe("ok")
    expect(events).toContainEqual({ kind: "session.created", sessionID: "handle:research-drafter", role: "research-drafter" })
    expect(events).toContainEqual({ kind: "session.status", sessionID: "handle:research-drafter", status: "running" })
    expect(events).toContainEqual({ kind: "session.status", sessionID: "handle:research-drafter", status: "completed" })
  })

  test("inlines input files for providers with inline input context support", async () => {
    let seenPrompt = ""
    let seenInputFiles: unknown
    const dir = await mkdtemp(join(tmpdir(), "qurom-runtime-inline-"))
    const filePath = join(dir, "draft.md")
    await writeFile(filePath, "# Draft\n\nHello")
    const provider: AgentProvider = {
      id: "fake",
      capabilities: new Set(["plainJsonOutput", "inlineInputContext"]),
      async createRunHandle(input) {
        return { id: `handle:${input.role}`, providerId: "fake", role: input.role, title: input.title }
      },
      async prompt(input) {
        seenPrompt = input.prompt
        seenInputFiles = input.inputFiles
        return { text: "ok" }
      },
    }
    const runtime = createAgentRuntime(config, undefined, { providerForRole: () => provider })
    const handle = await runtime.createHandle("source-auditor", "audit")

    await runtime.prompt({
      role: "source-auditor",
      handle,
      prompt: "Review this.",
      inputFiles: [{ path: filePath, mime: "text/markdown", filename: "draft.md" }],
    })

    expect(seenInputFiles).toBeUndefined()
    expect(seenPrompt).toContain("Review this.")
    expect(seenPrompt).toContain("The following context is included directly")
    expect(seenPrompt).toContain("--- BEGIN CONTEXT: draft ---")
    expect(seenPrompt).not.toContain("draft.md")
    expect(seenPrompt).not.toContain(filePath)
    expect(seenPrompt).toContain("# Draft\n\nHello")
  })

  test("passes input files through for providers with input file attachment support", async () => {
    let seenPrompt = ""
    let seenInputFiles: unknown
    const provider: AgentProvider = {
      id: "fake",
      capabilities: new Set(["plainJsonOutput", "inputFileAttachments"]),
      async createRunHandle(input) {
        return { id: `handle:${input.role}`, providerId: "fake", role: input.role, title: input.title }
      },
      async prompt(input) {
        seenPrompt = input.prompt
        seenInputFiles = input.inputFiles
        return { text: "ok" }
      },
    }
    const runtime = createAgentRuntime(config, undefined, { providerForRole: () => provider })
    const handle = await runtime.createHandle("source-auditor", "audit")
    const inputFiles = [{ path: "/tmp/draft.md", mime: "text/markdown", filename: "draft.md" }]

    await runtime.prompt({ role: "source-auditor", handle, prompt: "Review this.", inputFiles })

    expect(seenPrompt).toBe("Review this.")
    expect(seenInputFiles).toBe(inputFiles)
  })

  test("rejects input files when provider declares no input mode", async () => {
    const provider: AgentProvider = {
      id: "fake",
      capabilities: new Set(["plainJsonOutput"]),
      async createRunHandle(input) {
        return { id: `handle:${input.role}`, providerId: "fake", role: input.role, title: input.title }
      },
      async prompt() {
        return { text: "ok" }
      },
    }
    const runtime = createAgentRuntime(config, undefined, { providerForRole: () => provider })
    const handle = await runtime.createHandle("source-auditor", "audit")

    await expect(runtime.prompt({
      role: "source-auditor",
      handle,
      prompt: "Review this.",
      inputFiles: [{ path: "/tmp/draft.md", mime: "text/markdown", filename: "draft.md" }],
    })).rejects.toThrow("does not support input files or inline input context")
  })

  test("passes the task prompt through without role-instruction wrapping", async () => {
    let seenPrompt = ""
    const provider: AgentProvider = {
      id: "fake",
      capabilities: new Set(["plainJsonOutput"]),
      async createRunHandle(input) {
        return { id: `handle:${input.role}`, providerId: "fake", role: input.role, title: input.title }
      },
      async prompt(input) {
        seenPrompt = input.prompt
        return { text: "ok" }
      },
    }
    const runtime = createAgentRuntime(config, undefined, {
      providerForRole: () => provider,
    })
    const handle = await runtime.createHandle("source-auditor", "audit")

    await runtime.prompt({ role: "source-auditor", handle, prompt: "Review draft." })

    expect(seenPrompt).toBe("Review draft.")
  })

  test("inlines frontend-design for design quorum roles", async () => {
    let seenPrompt = ""
    const provider: AgentProvider = {
      id: "fake",
      capabilities: new Set(["plainJsonOutput"]),
      async createRunHandle(input) {
        return { id: `handle:${input.role}`, providerId: "fake", role: input.role, title: input.title }
      },
      async prompt(input) {
        seenPrompt = input.prompt
        return { text: "ok" }
      },
    }
    const runtime = createAgentRuntime(config, undefined, { providerForRole: () => provider })
    const handle = await runtime.createHandle("html-designer", "design")

    await runtime.prompt({ role: "html-designer", handle, prompt: "Convert the draft." })

    expect(seenPrompt).toContain("<frontend_design_skill>")
    expect(seenPrompt).toContain("name: frontend-design")
    expect(seenPrompt).toContain("Convert the draft.")
  })

  test("resumes a ledger session and harvests a finished local artifact without prompting", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "qurom-runtime-harvest-"))
    const outputFile = join(runDir, "draft-round-0.md")
    await writeFile(outputFile, "# Harvested draft\n")
    let created = 0
    let prompted = 0
    const provider: AgentProvider = {
      id: "fake",
      capabilities: new Set(["fileOutput", "plainTextOutput"]),
      async createRunHandle(input) {
        created += 1
        return { id: `new:${created}`, providerId: "fake", role: input.role, title: input.title }
      },
      async resumeRunHandle(input) {
        return { id: input.handleId, providerId: "fake", role: input.role, title: input.title }
      },
      async prompt() {
        prompted += 1
        return { text: "should not run" }
      },
    }
    const bus = createEventBus()
    const runtime = createAgentRuntime(config, bus, { providerForRole: () => provider })
    bus.emit({
      kind: "graph.node",
      node: "draftFullDraft",
      phase: "start",
      state: {
        inputMode: "topic",
        topic: "x",
        requestId: "req-harvest",
        round: 0,
        outputPath: runDir,
      } as never,
    })

    const first = await runtime.createHandle("research-drafter", "draft")
    await runtime.prompt({
      role: "research-drafter",
      handle: first,
      prompt: "Write the draft.",
      outputFile,
    })
    expect(prompted).toBe(1)

    const runtime2 = createAgentRuntime(config, bus, { providerForRole: () => provider })
    bus.emit({
      kind: "graph.node",
      node: "draftFullDraft",
      phase: "start",
      state: {
        inputMode: "topic",
        topic: "x",
        requestId: "req-harvest",
        round: 0,
        outputPath: runDir,
      } as never,
    })
    const resumed = await runtime2.createHandle("research-drafter", "draft")
    expect(resumed.id).toBe(first.id)
    const result = await runtime2.prompt({
      role: "research-drafter",
      handle: resumed,
      prompt: "Write the draft again.",
      outputFile,
    })
    expect(prompted).toBe(1)
    expect(result.harvested).toBe(true)
    expect(result.harvestSource).toBe("local")
    expect(result.text).toContain("Harvested draft")
  })

  test("reattaches to a live provider run instead of sending a new prompt", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "qurom-runtime-wait-"))
    const outputFile = join(runDir, "draft-round-0.md")
    let prompted = 0
    const provider: AgentProvider = {
      id: "fake",
      capabilities: new Set(["fileOutput", "plainTextOutput"]),
      async createRunHandle(input) {
        return { id: "bc-live", providerId: "fake", role: input.role, title: input.title }
      },
      async resumeRunHandle(input) {
        return { id: input.handleId, providerId: "fake", role: input.role, title: input.title }
      },
      async collectExistingOutput(input) {
        await writeFile(input.outputFile!, "# From live run\n")
        return {
          status: "harvested",
          source: "wait",
          result: { text: "# From live run\n", outputSource: "file", harvested: true, harvestSource: "wait" },
        }
      },
      async prompt() {
        prompted += 1
        return { text: "should not run" }
      },
    }
    const bus = createEventBus()
    const runtime = createAgentRuntime(config, bus, { providerForRole: () => provider })
    bus.emit({
      kind: "graph.node",
      node: "draftFullDraft",
      phase: "start",
      state: {
        inputMode: "topic",
        topic: "x",
        requestId: "req-wait",
        round: 0,
        outputPath: runDir,
      } as never,
    })
    const handle = await runtime.createHandle("research-drafter", "draft")
    handle.harvest = { ...handle.harvest!, resumed: true }
    const result = await runtime.prompt({
      role: "research-drafter",
      handle,
      prompt: "Write the draft.",
      outputFile,
    })
    expect(prompted).toBe(0)
    expect(result.harvested).toBe(true)
    expect(result.harvestSource).toBe("wait")
    expect(result.text).toContain("From live run")
  })
})
