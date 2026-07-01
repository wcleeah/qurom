import { describe, expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createAgentRuntime } from "../src/agent-runtime/runtime"
import type { RuntimeConfig } from "../src/config"
import { createEventBus, type RunnerEvent } from "../src/runner"
import type { AgentProvider } from "../src/providers/types"

const config: RuntimeConfig = {
  env: {
    OPENCODE_BASE_URL: "http://127.0.0.1:4096",
    OPENCODE_DIRECTORY: process.cwd(),
    QUORUM_WORKSPACE_DIRECTORY: process.cwd(),
    QUORUM_CHECKPOINT_PATH: "runs/checkpoints.sqlite",
    QUORUM_CONFIG_DB_PATH: "runs/quorum-config.sqlite",
    QUORUM_CAPTURE_OPENCODE_EVENTS: "0",
    QUORUM_CAPTURE_SYNC_HISTORY: "0",
    CURSOR_API_KEY: undefined,
    LANGFUSE_PUBLIC_KEY: undefined,
    LANGFUSE_SECRET_KEY: undefined,
    LANGFUSE_BASE_URL: undefined,
  },
  quorumConfig: {
    designatedDrafter: "research-drafter",
    auditors: ["source-auditor"],
    summarizerAgent: "markdown-summarizer",
    maxRounds: 1,
    maxRebuttalTurnsPerFinding: 1,
    recursionLimit: 80,
    requireUnanimousApproval: true,
    artifactDir: "runs",
    promptAssetsDir: "assets/prompts",
    promptManagement: { source: "local", label: "production" },
    researchTools: { prefer: ["webfetch"], webSearchProvider: "exa" },
    auditRestart: { maxRestarts: 1 },
    readerDiscovery: { maxTurns: 6, enabled: true },
    agentRuntime: { defaultProvider: "fake", roles: {} },
  },
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

  test("inlines input files for providers without file attachment support", async () => {
    let seenPrompt = ""
    let seenInputFiles: unknown
    const dir = await mkdtemp(join(tmpdir(), "qurom-runtime-inline-"))
    const filePath = join(dir, "draft.md")
    await writeFile(filePath, "# Draft\n\nHello")
    const provider: AgentProvider = {
      id: "fake",
      capabilities: new Set(["plainJsonOutput"]),
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

  test("passes input files through for providers with file attachment support", async () => {
    let seenPrompt = ""
    let seenInputFiles: unknown
    const provider: AgentProvider = {
      id: "fake",
      capabilities: new Set(["plainJsonOutput", "fileAttachments"]),
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

  test("injects role instructions only for providers that request them", async () => {
    const prompts: string[] = []
    const provider: AgentProvider = {
      id: "fake",
      capabilities: new Set(["plainJsonOutput", "roleInstructions"]),
      async createRunHandle(input) {
        return { id: `handle:${input.role}`, providerId: "fake", role: input.role, title: input.title }
      },
      async prompt(input) {
        prompts.push(input.prompt)
        return { text: "ok" }
      },
    }
    const runtime = createAgentRuntime(config, undefined, {
      providerForRole: () => provider,
      roleInstructions: { "source-auditor": "Only check source fidelity." },
    })
    const handle = await runtime.createHandle("source-auditor", "audit")

    await runtime.prompt({ role: "source-auditor", handle, prompt: "Review draft." })

    expect(prompts[0]).toContain("## Role instructions")
    expect(prompts[0]).toContain("Only check source fidelity.")
    expect(prompts[0]).toContain("## Task")
    expect(prompts[0]).toContain("Review draft.")
  })

  test("does not inject role instructions for providers without the capability", async () => {
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
      roleInstructions: { "source-auditor": "Only check source fidelity." },
    })
    const handle = await runtime.createHandle("source-auditor", "audit")

    await runtime.prompt({ role: "source-auditor", handle, prompt: "Review draft." })

    expect(seenPrompt).toBe("Review draft.")
  })
})
