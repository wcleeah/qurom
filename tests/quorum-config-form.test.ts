import { describe, expect, test } from "bun:test"

import { parseQuorumConfigForm, renderQuorumConfigForm } from "../src/view/quorum-config-form"
import { testQuorumConfig } from "./test-env"

describe("quorum config form", () => {
  test("renders policy fields without raw JSON textarea", () => {
    const html = renderQuorumConfigForm({
      action: "/config/quorum",
      config: testQuorumConfig(),
      submitLabel: "Save quorum config",
      researchToolIds: ["context7", "firecrawl"],
    })

    expect(html).toContain('name="maxRounds"')
    expect(html).toContain('name="researchTools.prefer"')
    expect(html).toContain('value="firecrawl"')
    expect(html).not.toContain('<textarea name="content"')
  })

  test("parses form fields into quorum policy object", () => {
    const parsed = parseQuorumConfigForm(new URLSearchParams({
      maxRounds: "5",
      maxRebuttalTurnsPerFinding: "3",
      recursionLimit: "90",
      "auditRestart.maxRestarts": "2",
      requireUnanimousApproval: "1",
      "designQuorum.enabled": "1",
      "readerDiscovery.enabled": "1",
      "readerDiscovery.maxTurns": "4",
      "researchTools.prefer": "exa",
      "researchTools.webSearchProvider": "exa",
    }))

    expect(parsed.maxRounds).toBe(5)
    expect(parsed.designQuorum).toEqual({ enabled: true })
    expect(parsed.readerDiscovery?.maxTurns).toBe(4)
    expect(parsed.researchTools.prefer).toEqual(["exa"])
  })
})
