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

    expect(html).toContain('name="auditRestart.maxRestarts"')
    expect(html).toContain('name="nodeRetry.maxRetries"')
    expect(html).toContain('name="maxConcurrentRuns"')
    expect(html).toContain('name="readability.enabled"')
    expect(html).toContain('name="readability.scoreTrip"')
    expect(html).not.toContain('<textarea name="content"')
    expect(html).toContain('value="firecrawl"')
    expect(html).not.toContain('<textarea name="content"')
  })

  test("parses form fields into quorum policy object", () => {
    const parsed = parseQuorumConfigForm(new URLSearchParams({
      maxRounds: "5",
      maxRebuttalTurnsPerFinding: "3",
      recursionLimit: "90",
      "auditRestart.maxRestarts": "2",
      "nodeRetry.maxRetries": "3",
      requireUnanimousApproval: "1",
      "designQuorum.enabled": "1",
      "readerDiscovery.enabled": "1",
      "readerDiscovery.maxTurns": "4",
      "tagging.enabled": "1",
      "tagging.maxArticleTags": "8",
      "tagging.maxNoteTags": "8",
      "readability.enabled": "1",
      "readability.model": "jev-latest",
      "readability.maxTries": "3",
      "readability.scoreTrip": "1.4",
      "readability.formalityTrip": "1.7",
      "readability.scoreConfidence": "0.6",
      "readability.noulVeto": "0.3",
      "researchTools.prefer": "exa",
      "researchTools.webSearchProvider": "exa",
    }))

    expect(parsed.maxRounds).toBe(5)
    expect(parsed.nodeRetry?.maxRetries).toBe(3)
    expect(parsed.maxConcurrentRuns).toBe(1)
    expect(parsed.designQuorum).toEqual({ enabled: true })
    expect(parsed.readerDiscovery?.maxTurns).toBe(4)
    expect(parsed.readability.maxTries).toBe(3)
    expect(parsed.readability.scoreTrip).toBe(1.4)
    expect(parsed.readability.formalityTrip).toBe(1.7)
    expect(parsed.readability.noulVeto).toBe(0.3)
    expect(parsed.researchTools.prefer).toEqual(["exa"])
  })
})
