import { describe, expect, test } from "bun:test"

import type { RuntimeConfig } from "../src/config.ts"
import {
  aggregateConsensus,
  auditScopeGuidance,
  dedupeFindings,
  effectiveResponsesByFinding,
  ingestRequest,
  prepareOutputPath,
  routeAfterAggregate,
  routeAfterDrafterReview,
  routeAfterRebuttalResponses,
  summarizeInputDocument,
  summarizeOutputArtifact,
} from "../src/graph.ts"
import type { AggregatedFinding, AuditResultRecord, RebuttalResponseRecord, ResearchState } from "../src/schema.ts"
import { resolveRunDir } from "../src/output.ts"

const config = {
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
    maxRounds: 2,
    maxRebuttalTurnsPerFinding: 2,
    recursionLimit: 80,
    requireUnanimousApproval: true,
    artifactDir: "runs",
    promptAssetsDir: "assets/prompts",
    promptManagement: {
      source: "local",
      label: "production",
    },
    researchTools: {
      prefer: ["context7", "exa"],
      webSearchProvider: "exa",
    },
  },
} satisfies RuntimeConfig

function finding(input: Partial<AggregatedFinding> & Pick<AggregatedFinding, "findingId" | "agent" | "issue">): AggregatedFinding {
  return {
    findingId: input.findingId,
    agent: input.agent,
    severity: input.severity ?? "major",
    category: input.category ?? "sources",
    issue: input.issue,
    evidence: input.evidence ?? ["Evidence"],
    required_fix: input.required_fix ?? "Fix it",
  }
}

function audit(input: Partial<AuditResultRecord> & Pick<AuditResultRecord, "agent" | "vote" | "summary" | "findings">): AuditResultRecord {
  return {
    agent: input.agent,
    vote: input.vote,
    summary: input.summary,
    findings: input.findings,
  }
}

function response(input: RebuttalResponseRecord): RebuttalResponseRecord {
  return input
}

function baseState(overrides: Partial<ResearchState> = {}): ResearchState {
  return {
    requestId: "req-1",
    inputMode: "topic",
    topic: "How Raft leader election works",
    round: 1,
    sectionDrafts: [],
    draft: "Draft",
    audits: [],
    auditSessionIds: {},
    activeRebuttals: {},
    currentRebuttalResponsesByFinding: {},
    rebuttalTurnCounts: {},
    rebuttalHistory: [],
    rebuttalResponseHistory: [],
    unresolvedFindings: [],
    approvedAgents: [],
    status: "aggregating",
    ...overrides,
  }
}

describe("graph helpers", () => {
  test("dedupeFindings keeps latest findingId entry and sorts by severity then fields", () => {
    const result = dedupeFindings([
      finding({ findingId: "b", agent: "logic-auditor", issue: "Issue B", severity: "minor" }),
      finding({ findingId: "a", agent: "source-auditor", issue: "Issue A", severity: "major" }),
      finding({ findingId: "a", agent: "source-auditor", issue: "Issue A updated", severity: "blocker" }),
    ])

    expect(result).toHaveLength(2)
    expect(result[0]?.findingId).toBe("a")
    expect(result[0]?.issue).toBe("Issue A updated")
    expect(result[1]?.findingId).toBe("b")
  })

  test("effectiveResponsesByFinding keeps the highest-turn response per finding", () => {
    const result = effectiveResponsesByFinding(
      baseState({
        rebuttalResponseHistory: [
          {
            findingKey: "finding-1",
            round: 1,
            turn: 1,
            response: response({
              agent: "source-auditor",
              targetAgent: "source-auditor",
              findingId: "finding-1",
              findingCategory: "sources",
              findingIssue: "Missing source",
              argument: "Initial response",
              decision: "uphold",
              turn: 1,
            }),
          },
          {
            findingKey: "finding-1",
            round: 1,
            turn: 2,
            response: response({
              agent: "source-auditor",
              targetAgent: "source-auditor",
              findingId: "finding-1",
              findingCategory: "sources",
              findingIssue: "Missing source",
              argument: "Later response",
              decision: "withdraw",
              turn: 2,
            }),
          },
        ],
      }),
    )

    expect(result["finding-1"]?.decision).toBe("withdraw")
    expect(result["finding-1"]?.turn).toBe(2)
  })

  test("aggregateConsensus approves when all auditors approve and no unresolved findings remain", async () => {
    const result = await aggregateConsensus(
      config,
      baseState({
        audits: [
          audit({ agent: "source-auditor", vote: "approve", summary: "ok", findings: [] }),
          audit({ agent: "logic-auditor", vote: "approve", summary: "ok", findings: [] }),
          audit({ agent: "clarity-auditor", vote: "approve", summary: "ok", findings: [] }),
        ],
      }),
    )

    expect(result.status).toBe("approved")
    expect(result.unresolvedFindings).toHaveLength(0)
    expect(result.approvedAgents).toEqual(config.quorumConfig.auditors)
  })

  test("aggregateConsensus fails on stagnation when unresolved signature repeats", async () => {
    const unresolved = finding({
      findingId: "finding-1",
      agent: "logic-auditor",
      issue: "Contradiction remains",
      category: "coherence",
    })

    const result = await aggregateConsensus(
      config,
      baseState({
        audits: [
          audit({
            agent: "logic-auditor",
            vote: "revise",
            summary: "Needs revision",
            findings: [unresolved],
          }),
        ],
        lastUnresolvedSignature: JSON.stringify([
          {
            agent: unresolved.agent,
            category: unresolved.category,
            severity: unresolved.severity,
            issue: unresolved.issue,
            required_fix: unresolved.required_fix,
          },
        ]),
      }),
    )

    expect(result.status).toBe("failed")
    expect(result.failureReason).toBe("stagnated_findings")
  })

  test("aggregateConsensus fails when max rounds are exhausted with unresolved findings", async () => {
    const result = await aggregateConsensus(
      config,
      baseState({
        round: config.quorumConfig.maxRounds,
        audits: [
          audit({
            agent: "source-auditor",
            vote: "revise",
            summary: "Needs revision",
            findings: [finding({ findingId: "finding-1", agent: "source-auditor", issue: "Need citation" })],
          }),
        ],
      }),
    )

    expect(result.status).toBe("failed")
    expect(result.failureReason).toBe("max_rounds_exhausted")
  })

  test("routeAfterDrafterReview routes to targeted rebuttals when eligible turns remain", () => {
    const result = routeAfterDrafterReview(
      config,
      baseState({
        status: "awaiting_auditor_rebuttal",
        activeRebuttals: {
          "finding-1": {
            targetAgent: "source-auditor",
            findingId: "finding-1",
            findingCategory: "sources",
            findingIssue: "Need citation",
            position: "rebut",
            argument: "There is already a citation",
            evidence: ["Section 2 cites the source"],
            requestedResolution: "withdraw",
          },
        },
        rebuttalTurnCounts: {
          "finding-1": 1,
        },
      }),
    )

    expect(result).toBe("runTargetedRebuttals")
  })

  test("routeAfterRebuttalResponses routes to aggregateConsensus when status is aggregating", () => {
    const result = routeAfterRebuttalResponses(
      config,
      baseState({
        status: "aggregating",
      }),
    )

    expect(result).toBe("aggregateConsensus")
  })

  test("routeAfterAggregate chooses the expected next node", () => {
    expect(routeAfterAggregate(baseState({ status: "approved" }))).toBe("finalizeApprovedDraft")
    expect(routeAfterAggregate(baseState({ status: "failed" }))).toBe("finalizeFailedRun")
    expect(routeAfterAggregate(baseState({ status: "revising" }))).toBe("reviseDraft")
  })

  test("ingestRequest prefers cached documentText over rereading the file", async () => {
    const originalFile = Bun.file
    let fileRead = false

    Bun.file = ((path: string | URL) => {
      fileRead = true
      return originalFile(path)
    }) as typeof Bun.file

    try {
      const state = await ingestRequest({
        inputMode: "document",
        documentPath: "missing.md",
        documentText: "cached draft",
        requestId: "req-cached",
      })

      expect(state.documentText).toBe("cached draft")
      expect(fileRead).toBe(false)
    } finally {
      Bun.file = originalFile
    }
  })

  test("auditScopeGuidance keeps source and logic auditor lanes distinct", () => {
    const sourceGuidance = auditScopeGuidance("source-auditor").join("\n")
    const logicGuidance = auditScopeGuidance("logic-auditor").join("\n")

    expect(sourceGuidance).toContain("citation quality")
    expect(sourceGuidance).toContain("Do not raise missing-step or incomplete-example findings")
    expect(logicGuidance).toContain("missing prerequisites")
    expect(logicGuidance).toContain("Do not raise citation-quality findings")
  })

  test("resolveRunDir builds a slugged document-mode path from the first heading", () => {
    const state = baseState({
      inputMode: "document",
      documentPath: "/tmp/generated.md",
      documentText: "# Hybrid reranking in Qdrant\n\nbody",
    })

    const runDir = resolveRunDir(config.quorumConfig.artifactDir, {
      requestId: state.requestId,
      inputMode: state.inputMode,
      topic: undefined,
      documentPath: state.documentPath,
      documentText: state.documentText,
    })

    expect(runDir).toBe("runs/hybrid-reranking-in-qdrant-req-1")
  })

  test("ingestRequest preserves a runner-provided outputPath", async () => {
    const state = await ingestRequest({
      inputMode: "topic",
      topic: "How Raft leader election works",
      requestId: "req-out",
    })

    expect(state.outputPath).toBeUndefined()
  })

  test("prepareOutputPath uses the input summary slug hint when present", async () => {
    const state = await prepareOutputPath(
      config,
      baseState({
        status: "drafting",
        round: 0,
        inputMode: "document",
        documentPath: "/tmp/doc.md",
        documentText: "# ignored",
        inputSummary: {
          title: "Hybrid reranking in Qdrant",
          summary: "Dense and sparse retrieval feed reranking.",
          slugHint: "Hybrid reranking in Qdrant",
          sourcePath: "/tmp/doc.md",
        },
      }),
    )

    expect(state.outputPath).toBe("runs/hybrid-reranking-in-qdrant-req-1")
  })

  test("summarizeInputDocument is a no-op for topic runs", async () => {
    const state = await summarizeInputDocument(
      config,
      baseState({
        status: "drafting",
        round: 0,
      }),
    )

    expect(state.inputSummary).toBeUndefined()
  })

  test("summarizeOutputArtifact preserves state when the artifact file is missing", async () => {
    const state = await summarizeOutputArtifact(
      config,
      baseState({
        status: "approved",
        outputPath: "runs/does-not-exist-req-1",
      }),
    )

    expect(state.artifactSummary).toBeUndefined()
  })
})
