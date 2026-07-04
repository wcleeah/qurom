import { describe, expect, test } from "bun:test"

import { renderLivePipeline } from "../src/view/components.ts"
import { classifyFile } from "../src/view/file-browser.ts"
import { renderAuditVoteTable, renderAuditorFindingsBlocks } from "../src/view/audit-view.ts"
import { filesForNode, isNodeComplete } from "../src/view/node-registry.ts"
import type { LiveStatus } from "../src/view/types.ts"
import {
  indexRunArtifacts,
  maxRebuttalTurn,
  roundHasRebuttals,
  summarizeAuditRoundData,
} from "../src/view/run-artifacts.ts"

describe("run-artifacts indexer", () => {
  test("groups multi-round audit and rebuttal artifacts", () => {
    const files = [
      "draft-round-0.md",
      "audits-round-0.json",
      "audit-methodologist-round-0.json",
      "drafter-finding-review-round-0.json",
      "auditor-rebuttal-responses-round-0-turn-1.json",
      "drafter-rebuttal-review-round-0-turn-1.json",
      "auditor-rebuttal-responses-round-0-turn-2.json",
      "aggregated-findings-round-0.json",
      "draft-round-1.md",
      "audits-round-1.json",
      "aggregated-findings-round-1.json",
    ]

    const index = indexRunArtifacts(files)
    expect(index.rounds).toHaveLength(2)
    expect(index.rounds[0]?.round).toBe(0)
    expect(index.rounds[0]?.audits).toBe("audits-round-0.json")
    expect(index.rounds[0]?.rebuttalTurns).toHaveLength(2)
    expect(maxRebuttalTurn(index.rounds[0]!)).toBe(2)
    expect(roundHasRebuttals(index.rounds[0]!)).toBe(true)
    expect(index.rounds[1]?.consensus).toBe("aggregated-findings-round-1.json")
  })

  test("summarizes audit bundle findings", () => {
    const summary = summarizeAuditRoundData([
      {
        agent: "methodologist",
        vote: "reject",
        summary: "issues",
        findings: [
          { severity: "major", category: "c", issue: "i", evidence: [], required_fix: "f", findingId: "1" },
        ],
      },
      {
        agent: "fact-checker",
        vote: "approve",
        summary: "ok",
        findings: [],
      },
    ])

    expect(summary.auditorCount).toBe(2)
    expect(summary.totalFindings).toBe(1)
    expect(summary.findingsBySeverity.major).toBe(1)
    expect(summary.votes.methodologist).toBe("reject")
  })
})

describe("audit-view rendering", () => {
  test("renders vote table and findings per auditor", () => {
    const audits = [
      {
        agent: "methodologist",
        vote: "revise",
        summary: "methodology gaps",
        findings: [
          { severity: "major", category: "method", issue: "sample bias", evidence: ["p.2"], required_fix: "fix", findingId: "f1" },
        ],
      },
      {
        agent: "fact-checker",
        vote: "approve",
        summary: "looks good",
        findings: [],
      },
    ]

    const table = renderAuditVoteTable(audits)
    expect(table).toContain("methodologist")
    expect(table).toContain("revise")
    expect(table).toContain("fact-checker")
    expect(table).toContain("approve")

    const findings = renderAuditorFindingsBlocks(audits)
    expect(findings).toContain("sample bias")
    expect(findings).toContain("No findings")
  })
})

describe("node-registry completion", () => {
  test("marks setup nodes complete once the run has artifacts during discoverReader", () => {
    const liveStatus: LiveStatus = {
      phase: "running",
      node: "discoverReaderPrompt",
      round: 0,
      maxRounds: 3,
      agents: {},
      nodeHistory: [],
    }
    const files = ["request.json", "reader-profile-1.json"]

    expect(isNodeComplete("summarizeInputDocument", files, "running", liveStatus)).toBe(true)
    expect(isNodeComplete("prepareOutputPath", files, "running", liveStatus)).toBe(true)
    expect(isNodeComplete("discoverReader", files, "running", liveStatus)).toBe(false)
  })
})

describe("node-registry file assignment", () => {
  test("assigns rebuttal turn files to rebuttal nodes", () => {
    const files = [
      "auditor-rebuttal-responses-round-1-turn-1.json",
      "drafter-rebuttal-review-round-1-turn-1.json",
      "disputed-round-1.json",
    ]

    const rebuttalFiles = filesForNode("runTargetedRebuttals", files)
    expect(rebuttalFiles).toContain("auditor-rebuttal-responses-round-1-turn-1.json")

    const reviewFiles = filesForNode("reviewRebuttalResponses", files)
    expect(reviewFiles).toContain("drafter-rebuttal-review-round-1-turn-1.json")
    expect(reviewFiles).toContain("disputed-round-1.json")
  })
})

describe("classifyFile rebuttal artifacts", () => {
  test("classifies disputed and per-agent rebuttal files", () => {
    expect(classifyFile("disputed-round-2.json")).toMatchObject({
      group: "Rebuttals",
      subGroup: "Disputed",
    })
    expect(classifyFile("rebuttals-methodologist-round-1.json")).toMatchObject({
      group: "Rebuttals",
      subGroup: "Rebuttal Inputs",
    })
    expect(classifyFile("drafter-rebuttal-review-round-0-turn-2.json")).toMatchObject({
      group: "Rebuttals",
      subGroup: "Drafter Reviews",
    })
  })
})

describe("live pipeline rebuttal detection", () => {
  test("marks rebuttal nodes complete with turn-based artifacts", () => {
    const html = renderLivePipeline(
      null,
      [
        "auditor-rebuttal-responses-round-0-turn-1.json",
        "drafter-rebuttal-review-round-0-turn-1.json",
      ],
      "running",
      "example-run",
    )

    expect(html).toContain("runTargetedRebuttals")
    expect(html).toContain("reviewRebuttalResponses")
    expect(html).toContain("/runs/example-run/node/runTargetedRebuttals")
    expect(html).toContain("1 turn")
  })

  test("links active pipeline nodes", () => {
    const html = renderLivePipeline(
      {
        phase: "running",
        node: "runParallelAudits",
        round: 1,
        maxRounds: 3,
        agents: {},
        nodeHistory: [],
      },
      ["audits-round-0.json", "audits-round-1.json"],
      "running",
      "example-run",
    )

    expect(html).toContain('pipeline-node active')
    expect(html).toContain("/runs/example-run/node/runParallelAudits")
  })
})
