import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { renderNodeGrid } from "../src/view/node-view.ts"
import { classifyFile } from "../src/view/file-browser.ts"
import { renderAuditVoteTable, renderAuditorFindingsBlocks, renderCompactAuditVoteTable, renderRoundAuditVoteTable, buildRoundAuditVoteRows } from "../src/view/audit-view.ts"
import { filesForNode, isNodeComplete } from "../src/view/node-registry.ts"
import { renderRoundStrip } from "../src/view/round-view.ts"
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

  test("renders compact vote table with findings count only", () => {
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

    const table = renderCompactAuditVoteTable(audits)
    expect(table).toContain("methodologist")
    expect(table).toContain("revise")
    expect(table).toContain("fact-checker")
    expect(table).toContain("approve")
    expect(table).toContain("Findings")
    expect(table).not.toContain("Blocker")
    expect(table).not.toContain("sample bias")
  })

  test("renders live audit rows with per-agent loading states", () => {
    const table = renderRoundAuditVoteTable([
      { agent: "source-auditor", vote: "approve", findings: 0, status: "complete" },
      { agent: "logic-auditor", status: "running" },
      { agent: "clarity-auditor", status: "pending" },
    ])

    expect(table).toContain("source-auditor")
    expect(table).toContain("approve")
    expect(table).toContain("auditing…")
    expect(table).toContain("audit-row-spinner")
    expect(table).toContain("waiting…")
    expect(table).toContain("audit-row-running")
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

describe("node grid rebuttal detection", () => {
  test("includes rebuttal nodes with turn-based artifacts", () => {
    const html = renderNodeGrid(
      "example-run",
      [
        "auditor-rebuttal-responses-round-0-turn-1.json",
        "drafter-rebuttal-review-round-0-turn-1.json",
      ],
      null,
      "running",
    )

    expect(html).toContain("Targeted rebuttals")
    expect(html).toContain("Rebuttal review")
    expect(html).toContain("/runs/example-run/node/runTargetedRebuttals")
  })

  test("highlights active node in the grid", () => {
    const html = renderNodeGrid(
      "example-run",
      ["audits-round-0.json", "audits-round-1.json"],
      {
        phase: "running",
        node: "runParallelAudits",
        round: 1,
        maxRounds: 3,
        agents: {},
        nodeHistory: [],
      },
      "running",
    )

    expect(html).toContain("node-grid-card active")
    expect(html).toContain("/runs/example-run/node/runParallelAudits")
  })
})

describe("renderRoundStrip audit summaries", () => {
  let dir: string
  let originalRunsDir: string | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "qurom-round-strip-"))
    const runDir = join(dir, "demo-run")
    await mkdir(runDir, { recursive: true })
    await writeFile(
      join(runDir, "audits-round-0.json"),
      JSON.stringify([
        {
          agent: "methodologist",
          vote: "revise",
          summary: "gaps",
          findings: [{ severity: "major", category: "method", issue: "bias", evidence: [], required_fix: "fix", findingId: "f1" }],
        },
        { agent: "fact-checker", vote: "approve", summary: "ok", findings: [] },
      ]),
    )
    originalRunsDir = process.env.QUORUM_RUNS_DIR
    process.env.QUORUM_RUNS_DIR = dir
  })

  afterEach(async () => {
    if (originalRunsDir === undefined) delete process.env.QUORUM_RUNS_DIR
    else process.env.QUORUM_RUNS_DIR = originalRunsDir
    await rm(dir, { recursive: true, force: true })
  })

  test("includes compact voting table per round with audits", async () => {
    const html = await renderRoundStrip("demo-run", ["draft-round-0.md", "audits-round-0.json"], null)

    expect(html).toContain("Research rounds")
    expect(html).toContain("round-audit-summaries")
    expect(html).toContain("methodologist")
    expect(html).toContain("revise")
    expect(html).toContain("fact-checker")
    expect(html).toContain("approve")
    expect(html).toContain("audit-vote-table-compact")
    expect(html).toContain("/runs/demo-run/round/0")
  })

  test("shows live loading rows while parallel audits are running", async () => {
    await writeFile(
      join(dir, "demo-run", "audit-source-auditor-round-0.json"),
      JSON.stringify({
        agent: "source-auditor",
        vote: "approve",
        summary: "ok",
        findings: [],
      }),
    )

    const liveStatus: LiveStatus = {
      phase: "running",
      node: "runParallelAudits",
      round: 0,
      maxRounds: 3,
      agents: {
        "auditor:logic-auditor": {
          status: "running",
          tokensIn: 100,
          tokensOut: 20,
          usageAvailable: true,
          toolCalls: [],
          reasoning: "",
        },
        "auditor:clarity-auditor": {
          status: "idle",
          tokensIn: 0,
          tokensOut: 0,
          usageAvailable: false,
          toolCalls: [],
          reasoning: "",
        },
      },
      nodeHistory: [],
    }

    const html = await renderRoundStrip(
      "demo-run",
      ["draft-round-0.md", "audit-source-auditor-round-0.json"],
      liveStatus,
    )

    expect(html).toContain("source-auditor")
    expect(html).toContain("approve")
    expect(html).toContain("logic-auditor")
    expect(html).toContain("auditing…")
    expect(html).toContain("clarity-auditor")
    expect(html).toContain("waiting…")
  })

  test("buildRoundAuditVoteRows merges per-agent files with live status", async () => {
    await writeFile(
      join(dir, "demo-run", "draft-round-0.md"),
      "# draft",
    )
    await writeFile(
      join(dir, "demo-run", "audit-source-auditor-round-0.json"),
      JSON.stringify({
        agent: "source-auditor",
        vote: "revise",
        summary: "issues",
        findings: [{ severity: "major", category: "x", issue: "y", evidence: [], required_fix: "z", findingId: "f1" }],
      }),
    )

    const rows = await buildRoundAuditVoteRows(
      "demo-run",
      {
        round: 0,
        perAgentAudits: ["audit-source-auditor-round-0.json"],
        perAgentRebuttalInputs: [],
        rebuttalTurns: [],
      },
      {
        phase: "running",
        node: "runParallelAudits",
        round: 0,
        maxRounds: 3,
        agents: {
          "auditor:logic-auditor": {
            status: "running",
            tokensIn: 0,
            tokensOut: 0,
            usageAvailable: false,
            toolCalls: [],
            reasoning: "",
          },
        },
        nodeHistory: [],
      },
      { isCurrentRound: true },
    )

    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ agent: "source-auditor", vote: "revise", findings: 1, status: "complete" })
    expect(rows[1]).toMatchObject({ agent: "logic-auditor", status: "running" })
    expect(rows[2]).toMatchObject({ agent: "clarity-auditor", status: "pending" })
  })
})
