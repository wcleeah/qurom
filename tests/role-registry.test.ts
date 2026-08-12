import { describe, expect, test } from "bun:test"

import {
  AUDITOR_ROLES,
  configuredAgentRoles,
  DRAFTER_ROLE,
  HTML_REPAIR_ROLE,
  requiredOpenCodeAgentRoles,
  SUMMARIZER_ROLE,
  TAGGER_ROLE,
} from "../src/role-registry"
import { testRuntimeConfig } from "./test-env"

describe("role registry", () => {
  test("exposes hardcoded auditor role ids", () => {
    expect(AUDITOR_ROLES).toEqual([
      "source-auditor",
      "logic-auditor",
      "clarity-auditor",
    ])
  })

  test("configuredAgentRoles includes design quorum roles when enabled", () => {
    const withDesign = testRuntimeConfig({
      dataDir: "/tmp/qurom-role-registry-design",
      quorumOverrides: { designQuorum: { enabled: true } },
    })
    const withoutDesign = testRuntimeConfig({
      dataDir: "/tmp/qurom-role-registry-no-design",
      quorumOverrides: { designQuorum: undefined },
    })

    expect(configuredAgentRoles(withDesign)).toContain("html-designer")
    expect(configuredAgentRoles(withDesign)).toContain("interactive-enhancer")
    expect(configuredAgentRoles(withDesign)).toContain("reading-experience-enhancer")
    expect(configuredAgentRoles(withoutDesign)).not.toContain("html-designer")
    expect(configuredAgentRoles(withoutDesign)).not.toContain("reading-experience-enhancer")
    expect(configuredAgentRoles(withDesign)).toContain(DRAFTER_ROLE)
    expect(configuredAgentRoles(withDesign)).toContain(SUMMARIZER_ROLE)
    expect(configuredAgentRoles(withDesign)).toContain(TAGGER_ROLE)
    expect(configuredAgentRoles(withDesign)).toContain(HTML_REPAIR_ROLE)
    expect(configuredAgentRoles(withDesign)).toContain("reader-profile-repairer")
  })

  test("requiredOpenCodeAgentRoles includes tagger and designer when design quorum enabled", () => {
    const config = testRuntimeConfig({
      dataDir: "/tmp/qurom-role-registry-opencode",
      quorumOverrides: { designQuorum: { enabled: true } },
    })
    expect(requiredOpenCodeAgentRoles(config)).toEqual([
      DRAFTER_ROLE,
      ...AUDITOR_ROLES,
      SUMMARIZER_ROLE,
      TAGGER_ROLE,
      "html-designer",
    ])
  })

  test("requiredOpenCodeAgentRoles includes tagger when design quorum disabled", () => {
    const config = testRuntimeConfig({
      dataDir: "/tmp/qurom-role-registry-opencode-no-design",
      quorumOverrides: { designQuorum: undefined },
    })
    expect(requiredOpenCodeAgentRoles(config)).toEqual([
      DRAFTER_ROLE,
      ...AUDITOR_ROLES,
      SUMMARIZER_ROLE,
      TAGGER_ROLE,
    ])
  })
})
