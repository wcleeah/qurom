import { describe, expect, test } from "bun:test"

import {
  aggregatedFindingsSchema,
  auditResultSchema,
  graphInputSchema,
  researchStateSchema,
} from "../src/schema.ts"

describe("schema validation", () => {
  test("rejects approve audits with findings", () => {
    const result = auditResultSchema.safeParse({
      vote: "approve",
      summary: "Looks good.",
      findings: [
        {
          severity: "major",
          category: "sources",
          issue: "Missing source.",
          evidence: ["No citation present."],
          required_fix: "Add a citation.",
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  test("rejects revise audits without findings", () => {
    const result = auditResultSchema.safeParse({
      vote: "revise",
      summary: "Needs work.",
      findings: [],
    })

    expect(result.success).toBe(false)
  })

  test("rejects approved aggregate outcomes with unresolved findings", () => {
    const result = aggregatedFindingsSchema.safeParse({
      outcome: "approved",
      approvedAgents: ["logic-auditor"],
      unresolvedFindings: [
        {
          findingId: "finding-1",
          agent: "logic-auditor",
          severity: "major",
          category: "coherence",
          issue: "Contradiction in section 2.",
          evidence: ["Claim A conflicts with Claim B."],
          required_fix: "Resolve the contradiction.",
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  test("accepts graph input with optional requestId", () => {
    const topicInput = graphInputSchema.safeParse({
      inputMode: "topic",
      topic: "How Raft leader election works",
      requestId: "req-1",
    })
    const documentInput = graphInputSchema.safeParse({
      inputMode: "document",
      documentPath: "docs/input.md",
      requestId: "req-2",
    })

    expect(topicInput.success).toBe(true)
    expect(documentInput.success).toBe(true)
  })

  test("requires topic for topic-mode research state", () => {
    const result = researchStateSchema.safeParse({
      requestId: "req-1",
      inputMode: "topic",
      round: 0,
      draft: "",
      audits: [],
      auditSessionIds: {},
      activeRebuttals: {},
      currentRebuttalResponsesByFinding: {},
      rebuttalTurnCounts: {},
      rebuttalHistory: [],
      rebuttalResponseHistory: [],
      unresolvedFindings: [],
      approvedAgents: [],
      status: "drafting",
    })

    expect(result.success).toBe(false)
  })
})
