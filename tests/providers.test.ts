import { describe, expect, test } from "bun:test"

import type { RuntimeConfig } from "../src/config"
import { availableProviderIds, configuredAgentRoles, providerForRole } from "../src/providers/registry"
import { testQuorumConfig, testRuntimeConfig } from "./test-env"

const baseConfig = testRuntimeConfig({
  dataDir: "/tmp/qurom-providers",
  quorumOverrides: {
    maxRounds: 1,
    researchTools: { prefer: ["webfetch"], webSearchProvider: "exa" },
    designQuorum: { enabled: true },
  },
})

describe("provider registry", () => {
  test("collects all configured logical agent roles", () => {
    const roles = configuredAgentRoles(baseConfig)

    expect(roles).toContain("research-drafter")
    expect(roles).toContain("source-auditor")
    expect(roles).toContain("markdown-summarizer")
    expect(roles).toContain("html-designer")
    expect(roles).toContain("interactive-enhancer")
    expect(roles).toContain("reading-experience-enhancer")
    expect(roles).toContain("json-fixer")
    expect(roles).not.toContain("browser-qa-enhancer")
    expect(new Set(roles).size).toBe(roles.length)
  })

  test("uses the default provider when a role has no override", () => {
    expect(providerForRole(baseConfig, "research-drafter").id).toBe("opencode")
  })

  test("exposes cursor as a selectable provider", () => {
    expect(availableProviderIds()).toContain("cursor")
  })

  test("uses cursor for a role override", () => {
    const config: RuntimeConfig = {
      ...baseConfig,
      roleBindings: {
        "clarity-auditor": { provider: "cursor", model: "composer-2.5", options: {} },
      },
    }

    expect(providerForRole(config, "clarity-auditor").id).toBe("cursor")
  })

  test("rejects unknown per-role providers early", () => {
    const config: RuntimeConfig = {
      ...baseConfig,
      roleBindings: {
        "clarity-auditor": { provider: "missing-provider", options: {} },
      },
    }

    expect(() => providerForRole(config, "clarity-auditor")).toThrow("Unknown agent provider")
  })
})
