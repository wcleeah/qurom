import { describe, expect, test } from "bun:test"

import type { RuntimeConfig } from "../src/config"
import { configuredAgentRoles, providerForRole } from "../src/providers/registry"

const baseConfig: RuntimeConfig = {
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
    auditors: ["source-auditor", "logic-auditor", "clarity-auditor"],
    summarizerAgent: "markdown-summarizer",
    maxRounds: 1,
    maxRebuttalTurnsPerFinding: 1,
    recursionLimit: 80,
    requireUnanimousApproval: true,
    artifactDir: "runs",
    promptAssetsDir: "assets/prompts",
    promptManagement: {
      source: "local",
      label: "production",
    },
    researchTools: { prefer: ["webfetch"], webSearchProvider: "exa" },
    designQuorum: {
      enabled: true,
      designatedDesigner: "html-designer",
      auditors: ["visual-layout-auditor", "technical-html-auditor", "script-security-auditor"],
      maxRounds: 2,
    },
    auditRestart: { maxRestarts: 1 },
    readerDiscovery: { maxTurns: 6, enabled: true },
    agentRuntime: {
      defaultProvider: "opencode",
      roles: {},
    },
  },
}

describe("provider registry", () => {
  test("collects all configured logical agent roles", () => {
    const roles = configuredAgentRoles(baseConfig)

    expect(roles).toContain("research-drafter")
    expect(roles).toContain("source-auditor")
    expect(roles).toContain("markdown-summarizer")
    expect(roles).toContain("html-designer")
    expect(roles).toContain("interactive-enhancer")
    expect(roles).toContain("json-fixer")
    expect(new Set(roles).size).toBe(roles.length)
  })

  test("uses the default provider when a role has no override", () => {
    expect(providerForRole(baseConfig, "research-drafter").id).toBe("opencode")
  })

  test("rejects unknown per-role providers early", () => {
    const config: RuntimeConfig = {
      ...baseConfig,
      quorumConfig: {
        ...baseConfig.quorumConfig,
        agentRuntime: {
          defaultProvider: "opencode",
          roles: {
            "clarity-auditor": { provider: "missing-provider", options: {} },
          },
        },
      },
    }

    expect(() => providerForRole(config, "clarity-auditor")).toThrow("Unknown agent provider")
  })
})
