import { describe, expect, test } from "bun:test"

import { createAgentRuntime } from "../src/agent-runtime/runtime"
import type { RuntimeConfig } from "../src/config"
import { createEventBus, type RunnerEvent } from "../src/runner"
import type { AgentProvider } from "../src/providers/types"

const config: RuntimeConfig = {
  env: {
    OPENCODE_BASE_URL: "http://127.0.0.1:4096",
    OPENCODE_DIRECTORY: process.cwd(),
    QUORUM_CHECKPOINT_PATH: "runs/checkpoints.sqlite",
    QUORUM_CAPTURE_OPENCODE_EVENTS: "0",
    QUORUM_CAPTURE_SYNC_HISTORY: "0",
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
})
