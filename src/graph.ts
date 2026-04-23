import { randomUUID } from "node:crypto"
import { END, START, StateGraph } from "@langchain/langgraph"

import { BunSqliteSaver } from "./checkpointer"
import type { RuntimeConfig } from "./config"
import { ensureRunDirPath, resolveRunDir, writeApprovedArtifacts, writeFailedArtifacts } from "./output"
import { createSession, promptAgent } from "./opencode"
import type { PromptBundle } from "./prompt-assets"
import { summarizeMarkdown } from "./summarizer"
import {
  draftOutlineSchema,
  aggregatedFindingSchema,
  aggregatedFindingsSchema,
  type ActiveRebuttal,
  auditResultRecordSchema,
  auditResultSchema,
  drafterFindingReviewSchema,
  graphInputSchema,
  inputRequestSchema,
  rebuttalBatchResponseSchema,
  researchStateObjectSchema,
  researchStateSchema,
  runSummarySchema,
  type AggregatedFinding,
  type AggregatedFindings,
  type AuditResultRecord,
  type DraftOutlineSection,
  type GraphInput,
  type RunDisplaySummary,
  type Rebuttal,
  type RebuttalResponseRecord,
  type ResearchState,
  type SectionDraft,
} from "./schema"
import type { TelemetryRun, TraceObservation } from "./telemetry"

export type RunObserver = {
  onNodeStart?: (node: string, state: ResearchState | GraphInput) => void
  onNodeEnd?: (node: string, state: ResearchState | GraphInput) => void
  onSessionCreated?: (input: { sessionID: string; role: string; requestId: string }) => void
}

type GraphTelemetry = {
  run: TelemetryRun
  currentNode?: TraceObservation
  trackSessionObservation?: (sessionID: string, observation: TraceObservation | undefined) => void
}

function observeNode(observer: RunObserver | undefined, node: string, state: ResearchState | GraphInput) {
  observer?.onNodeStart?.(node, state)
}

function observeNodeResult<T>(
  observer: RunObserver | undefined,
  node: string,
  state: ResearchState | GraphInput,
  result: T,
) {
  observer?.onNodeEnd?.(node, state)
  return result
}

function requestLabel(state: ResearchState) {
  if (state.inputMode === "topic") return `topic ${JSON.stringify(state.topic ?? "")}`
  return `document ${JSON.stringify(state.documentPath ?? "")}`
}

function assertStatus(state: ResearchState, expected: ResearchState["status"], node: string) {
  if (state.status !== expected) {
    throw new Error(`Invalid status for ${node}: expected ${expected}, got ${state.status}`)
  }
}

function researchToolBlock(config: RuntimeConfig) {
  const lines = ["Tool preferences:"]

  for (const tool of config.quorumConfig.researchTools.prefer) {
    lines.push(`- Prefer ${tool} when it matches the task.`)
  }

  lines.push(`- Preferred web search provider: ${config.quorumConfig.researchTools.webSearchProvider}.`)
  return lines.join("\n")
}

export function auditScopeGuidance(agent: string) {
  const scopeGuidance: Record<string, string[]> = {
    "source-auditor": [
      "Stay in lane: raise findings about citation quality, claim support, overstatement relative to sources, and primary-vs-secondary sourcing.",
      "Do not raise missing-step or incomplete-example findings unless the actual problem is that the cited evidence does not support the claim.",
    ],
    "logic-auditor": [
      "Stay in lane: raise findings about contradictions, invalid inferences, missing prerequisites, incomplete end-to-end examples, and scope/coherence gaps.",
      "Do not raise citation-quality findings unless the reasoning problem depends on a source gap.",
    ],
    "clarity-auditor": [
      "Stay in lane: raise findings about reader comprehension, throughline, jargon load, and section structure.",
      "Do not raise source-support or implementation-completeness findings unless they materially create a clarity problem for the reader.",
    ],
  }

  return scopeGuidance[agent] ?? []
}

function requestContextBlock(state: ResearchState, options?: { includeDocumentText?: boolean }) {
  if (state.inputMode === "topic") {
    return [`Topic:`, state.topic ?? ""].join("\n")
  }

  const sections = []

  if (state.inputSummary) {
    sections.push(
      `Input summary:\n${JSON.stringify(
        {
          title: state.inputSummary.title,
          summary: state.inputSummary.summary,
        },
        null,
        2,
      )}`,
    )
  }

  if (options?.includeDocumentText) {
    sections.push(`Document text:\n${state.documentText ?? ""}`)
  } else if (state.documentPath) {
    sections.push(`Document path: ${state.documentPath}`)
  }

  return sections.join("\n\n")
}

function outlinePrompt(config: RuntimeConfig, promptBundle: PromptBundle, state: ResearchState) {
  return [
    promptBundle.assets.deepDiveContract,
    promptBundle.assets.draftOutline,
    researchToolBlock(config),
    `Plan a source-backed deep dive for ${requestLabel(state)}.`,
    "Return only JSON that matches the requested schema.",
    requestContextBlock(state, { includeDocumentText: true }),
  ].join("\n\n")
}

function sectionPrompt(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  state: ResearchState,
  section: DraftOutlineSection,
  sectionIndex: number,
) {
  return [
    promptBundle.assets.deepDiveContract,
    promptBundle.assets.draftSection,
    researchToolBlock(config),
    `Write section ${sectionIndex + 1} of ${state.outline?.sections.length ?? 0} for ${requestLabel(state)}.`,
    `Document scaffold:\n${JSON.stringify(
      {
        shortAnswer: state.outline?.shortAnswer,
        startingPoint: state.outline?.startingPoint,
        drivingQuestion: state.outline?.drivingQuestion,
        finishLine: state.outline?.finishLine,
        runningExample: state.outline?.runningExample,
      },
      null,
      2,
    )}`,
    `Section plan:\n${JSON.stringify(section, null, 2)}`,
    state.sectionDrafts.length > 0
      ? `Completed sections so far:\n${JSON.stringify(state.sectionDrafts.map((entry) => entry.heading), null, 2)}`
      : "",
    requestContextBlock(state),
  ]
    .filter(Boolean)
    .join("\n\n")
}

function stitchPrompt(config: RuntimeConfig, promptBundle: PromptBundle, state: ResearchState) {
  return [
    promptBundle.assets.deepDiveContract,
    promptBundle.assets.stitchDraft,
    researchToolBlock(config),
    `Assemble the full draft for ${requestLabel(state)}.`,
    requestContextBlock(state),
    `Approved outline:\n${JSON.stringify(state.outline, null, 2)}`,
    `Section drafts:\n${state.sectionDrafts.map((entry) => entry.markdown.trim()).join("\n\n")}`,
  ].join("\n\n")
}

function auditPrompt(config: RuntimeConfig, promptBundle: PromptBundle, agent: string, request: string, draft: string) {
  return [
    promptBundle.assets.audit,
    researchToolBlock(config),
    `Review this ${request} draft as the ${agent}.`,
    "Return only JSON that matches the requested schema.",
    "Vote approve only if there are no material issues in your review scope.",
    "Vote revise if you find any material problem.",
    ...auditScopeGuidance(agent),
    "Draft:",
    draft,
  ].join("\n\n")
}

function drafterReviewPrompt(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  request: string,
  draft: string,
  audits: AuditResultRecord[],
  rebuttalTurnCounts: Record<string, number>,
) {
  const promptAudits = []

  for (const audit of audits) {
    const promptFindings = []

    for (const finding of audit.findings) {
      promptFindings.push({
        findingId: finding.findingId,
        category: finding.category,
        issue: finding.issue,
        severity: finding.severity,
        required_fix: finding.required_fix,
      })
    }

    promptAudits.push({
      agent: audit.agent,
      vote: audit.vote,
      summary: audit.summary,
      findings: promptFindings,
    })
  }

  return [
    promptBundle.assets.reviewFindings,
    researchToolBlock(config),
    `Review the auditor findings for this ${request}.`,
    "Return only JSON that matches the requested schema.",
    "Put accepted finding IDs into acceptedFindingIds.",
    "Put only evidence-backed challenges into rebuttals.",
    `Do not rebut a finding that has already hit the rebuttal cap of ${config.quorumConfig.maxRebuttalTurnsPerFinding}.`,
    "Current draft:",
    draft,
    "Current rebuttal turn counts:",
    JSON.stringify(rebuttalTurnCounts, null, 2),
    "Audits:",
    JSON.stringify(promptAudits, null, 2),
  ].join("\n\n")
}

function rebuttalPrompt(config: RuntimeConfig, promptBundle: PromptBundle, request: string, draft: string, rebuttals: ActiveRebuttal[]) {
  return [
    promptBundle.assets.rebuttal,
    researchToolBlock(config),
    `Respond to the disputed findings for this ${request}.`,
    "Return only JSON that matches the requested schema.",
    "Answer only for the findings in the rebuttal list.",
    "Use uphold, soften, or withdraw for each response.",
    "Current draft:",
    draft,
    "Rebuttals:",
    JSON.stringify(rebuttals, null, 2),
  ].join("\n\n")
}

function rebuttalReviewPrompt(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  request: string,
  draft: string,
  disputed: Array<{ findingId: string; rebuttal: ActiveRebuttal; response: RebuttalResponseRecord }>,
  rebuttalTurnCounts: Record<string, number>,
) {
  const promptDisputed = []

  for (const entry of disputed) {
    promptDisputed.push({
      findingId: entry.findingId,
      targetAgent: entry.rebuttal.targetAgent,
      findingCategory: entry.rebuttal.findingCategory,
      findingIssue: entry.rebuttal.findingIssue,
      priorRebuttal: entry.rebuttal,
      auditorResponse: entry.response,
    })
  }

  return [
    promptBundle.assets.reviewRebuttalResponses,
    researchToolBlock(config),
    `Review the auditor rebuttal responses for this ${request}.`,
    "Return only JSON that matches the requested schema.",
    "For each disputed finding, either accept the auditor response or issue one narrower rebuttal with stronger evidence.",
    `Do not rebut a finding that has already hit the rebuttal cap of ${config.quorumConfig.maxRebuttalTurnsPerFinding}.`,
    "Current draft:",
    draft,
    "Current rebuttal turn counts:",
    JSON.stringify(rebuttalTurnCounts, null, 2),
    "Disputed findings:",
    JSON.stringify(promptDisputed, null, 2),
  ].join("\n\n")
}

function revisionPrompt(config: RuntimeConfig, promptBundle: PromptBundle, state: ResearchState) {
  return [
    promptBundle.assets.deepDiveContract,
    promptBundle.assets.reviseDraft,
    researchToolBlock(config),
    `Revise this draft for ${requestLabel(state)}.`,
    "Return markdown only.",
    "Preserve correct material and address only the unresolved findings.",
    "The final draft must still include a Sources section.",
    "Current draft:",
    state.draft,
    "Unresolved findings:",
    JSON.stringify(state.unresolvedFindings, null, 2),
  ].join("\n\n")
}

export async function summarizeInputDocument(config: RuntimeConfig, state: ResearchState, telemetry?: GraphTelemetry) {
  assertStatus(state, "drafting", "summarizeInputDocument")

  if (state.inputMode !== "document" || !state.documentText?.trim()) {
    return researchStateSchema.parse(state)
  }

  try {
    const summary = await summarizeMarkdown({
      config,
      title: `summary-input:${state.requestId}`,
      markdown: state.documentText,
      mode: "input",
      telemetry: !telemetry
        ? undefined
        : {
            run: telemetry.run,
            parentObservation: telemetry.currentNode,
            trackSessionObservation: telemetry.trackSessionObservation,
            name: "agent.summarizeInputDocument",
            metadata: {
              requestId: state.requestId,
              round: state.round,
            },
          },
    })

    return researchStateSchema.parse({
      ...state,
      inputSummary: {
        ...summary,
        sourcePath: state.documentPath,
      },
    })
  } catch {
    return researchStateSchema.parse(state)
  }
}

export async function prepareOutputPath(config: RuntimeConfig, state: ResearchState) {
  assertStatus(state, "drafting", "prepareOutputPath")

  return researchStateSchema.parse({
    ...state,
    outputPath: resolveRunDir(config.quorumConfig.artifactDir, {
      requestId: state.requestId,
      inputMode: state.inputMode,
      topic: state.inputMode === "topic" ? state.topic : undefined,
      documentPath: state.inputMode === "document" ? state.documentPath : undefined,
      documentText: state.inputMode === "document" ? state.documentText : undefined,
      slugHint: state.inputSummary?.slugHint,
    }),
  })
}

function findingStateKey(input: { findingId: string }) {
  return input.findingId
}

function turnForFinding(state: ResearchState, key: string) {
  const previous = state.rebuttalTurnCounts[key]
  if (!previous) return 1
  return previous + 1
}

function cappedFindingKeys(config: RuntimeConfig, state: ResearchState) {
  const capped = new Set<string>()

  for (const [key, turns] of Object.entries(state.rebuttalTurnCounts)) {
    if (turns >= config.quorumConfig.maxRebuttalTurnsPerFinding) {
      capped.add(key)
    }
  }

  return capped
}

function hasEligibleRebuttalTurn(config: RuntimeConfig, state: ResearchState) {
  const capped = cappedFindingKeys(config, state)

  for (const key of Object.keys(state.activeRebuttals)) {
    if (!capped.has(key)) {
      return true
    }
  }

  return false
}

export function dedupeFindings(findings: AggregatedFinding[]) {
  const uniqueByFindingId = new Map<string, AggregatedFinding>()

  for (const finding of findings) {
    uniqueByFindingId.set(finding.findingId, finding)
  }

  return [...uniqueByFindingId.values()].sort((left, right) => {
    const severityRank = { blocker: 0, major: 1, minor: 2 }
    return (
      severityRank[left.severity] - severityRank[right.severity] ||
      left.agent.localeCompare(right.agent) ||
      left.category.localeCompare(right.category) ||
      left.issue.localeCompare(right.issue)
    )
  })
}

function unresolvedSignature(findings: AggregatedFinding[]) {
  const normalized = []

  for (const finding of findings) {
    normalized.push({
      agent: finding.agent,
      category: finding.category,
      severity: finding.severity,
      issue: finding.issue,
      required_fix: finding.required_fix,
    })
  }

  return JSON.stringify(normalized)
}

function toAggregatedFindings(audits: AuditResultRecord[]) {
  const findings: AggregatedFinding[] = []

  for (const audit of audits) {
    for (const finding of audit.findings) {
      findings.push(
        aggregatedFindingSchema.parse({
          ...finding,
          agent: audit.agent,
        }),
      )
    }
  }

  return findings
}

function appendRebuttalHistory(state: ResearchState, rebuttals: Record<string, ActiveRebuttal>) {
  const history = [...state.rebuttalHistory]

  for (const [key, rebuttal] of Object.entries(rebuttals)) {
    history.push({
      findingKey: key,
      round: state.round,
      turn: turnForFinding(state, key),
      rebuttal,
    })
  }

  return history
}

function appendRebuttalResponseHistory(state: ResearchState, responses: Record<string, RebuttalResponseRecord>) {
  const history = [...state.rebuttalResponseHistory]

  for (const [key, response] of Object.entries(responses)) {
    history.push({
      findingKey: key,
      round: state.round,
      turn: response.turn,
      response,
    })
  }

  return history
}

function nextRebuttalTurnCounts(state: ResearchState, rebuttals: Record<string, ActiveRebuttal>) {
  const nextTurnCounts = { ...state.rebuttalTurnCounts }

  for (const key of Object.keys(rebuttals)) {
    nextTurnCounts[key] = (nextTurnCounts[key] ?? 0) + 1
  }

  return nextTurnCounts
}

function approvedAgentsForOutcome(state: ResearchState, unresolved: AggregatedFinding[]) {
  const unresolvedAgents = new Set<string>()

  for (const finding of unresolved) {
    unresolvedAgents.add(finding.agent)
  }

  const approvedAgents: string[] = []

  for (const audit of state.audits) {
    if (audit.vote === "approve" || !unresolvedAgents.has(audit.agent)) {
      approvedAgents.push(audit.agent)
    }
  }

  return approvedAgents
}

export function effectiveResponsesByFinding(state: ResearchState) {
  const responsesByFinding: Record<string, RebuttalResponseRecord> = {}

  for (const entry of state.rebuttalResponseHistory) {
    const existing = responsesByFinding[entry.findingKey]

    if (!existing || entry.response.turn > existing.turn) {
      responsesByFinding[entry.findingKey] = entry.response
    }
  }

  return responsesByFinding
}

function buildRunSummary(state: ResearchState, outcome: AggregatedFindings["outcome"]) {
  return runSummarySchema.parse({
    requestId: state.requestId,
    outcome,
    round: state.round,
    approvedAgents: state.approvedAgents,
    unresolvedFindings: state.unresolvedFindings,
    rebuttalTurnCounts: state.rebuttalTurnCounts,
    rebuttalHistory: state.rebuttalHistory,
    rebuttalResponseHistory: state.rebuttalResponseHistory,
    failureReason: state.failureReason,
  })
}

function nextSectionToDraft(state: ResearchState) {
  const planned = state.outline?.sections ?? []
  return planned[state.sectionDrafts.length]
}

function buildActiveRebuttalMap(audits: AuditResultRecord[], rebuttals: Rebuttal[]) {
  const findingsById = new Map<string, AggregatedFinding>()

  for (const finding of toAggregatedFindings(audits)) {
    findingsById.set(finding.findingId, finding)
  }

  const activeRebuttals: Record<string, ActiveRebuttal> = {}

  for (const rebuttal of rebuttals) {
    const finding = findingsById.get(rebuttal.findingId)
    if (!finding) continue

    activeRebuttals[rebuttal.findingId] = {
      ...rebuttal,
      targetAgent: finding.agent,
      findingCategory: finding.category,
      findingIssue: finding.issue,
    }
  }

  return activeRebuttals
}

export async function ingestRequest(input: GraphInput) {
  const parsed = inputRequestSchema.parse(input)
  const requestId = input.requestId ?? randomUUID()
  const baseState = {
    requestId,
    round: 0,
    outline: undefined,
    sectionDrafts: [],
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
    status: "drafting" as const,
    failureReason: undefined,
    lastUnresolvedSignature: undefined,
  }

  if (parsed.inputMode === "topic") {
    return researchStateSchema.parse({
      ...baseState,
      inputMode: "topic",
      topic: parsed.topic,
    })
  }

  return researchStateSchema.parse({
    ...baseState,
    inputMode: "document",
    documentPath: parsed.documentPath,
    documentText: parsed.documentText ?? (await Bun.file(parsed.documentPath).text()),
  })
}

async function bootstrapRun(config: RuntimeConfig, state: ResearchState) {
  assertStatus(state, "drafting", "bootstrapRun")

  const rootSession = await createSession(config, `research-quorum:${state.requestId}`)
  if (!state.outputPath) throw new Error("Missing outputPath during bootstrapRun")

  const childSessionPromises = [createSession(config, `research-drafter:${state.requestId}`, rootSession.id)]
  for (const agent of config.quorumConfig.auditors) {
    childSessionPromises.push(createSession(config, `audit:${state.requestId}:${agent}`, rootSession.id))
  }

  const childSessions = await Promise.all(childSessionPromises)
  const drafterSession = childSessions[0]
  const auditSessionIds: Record<string, string> = {}

  for (let index = 0; index < config.quorumConfig.auditors.length; index += 1) {
    const agent = config.quorumConfig.auditors[index]
    const session = childSessions[index + 1]
    auditSessionIds[agent] = session.id
  }

  return researchStateSchema.parse({
    ...state,
    rootSessionId: rootSession.id,
    drafterSessionId: drafterSession.id,
    auditSessionIds,
  })
}

async function draftOutline(config: RuntimeConfig, promptBundle: PromptBundle, state: ResearchState, telemetry?: GraphTelemetry) {
  assertStatus(state, "drafting", "draftOutline")
  if (!state.drafterSessionId) throw new Error("Missing drafterSessionId during draftOutline")

  const response = await promptAgent({
    config,
    sessionID: state.drafterSessionId,
    agent: config.quorumConfig.designatedDrafter,
    prompt: outlinePrompt(config, promptBundle, state),
    schema: draftOutlineSchema,
    telemetry: graphAgentTelemetry({
      telemetry,
      state,
      name: "agent.draftOutline",
      agentName: config.quorumConfig.designatedDrafter,
      sessionId: state.drafterSessionId,
    }),
  })

  if (!response.structured) {
    throw new Error("Missing structured outline from designated drafter")
  }

  return researchStateSchema.parse({
    ...state,
    outline: response.structured,
    sectionDrafts: [],
  })
}

async function draftNextSection(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  state: ResearchState,
  telemetry?: GraphTelemetry,
) {
  assertStatus(state, "drafting", "draftNextSection")
  if (!state.drafterSessionId) throw new Error("Missing drafterSessionId during draftNextSection")
  if (!state.outline) throw new Error("Missing outline during draftNextSection")

  const section = nextSectionToDraft(state)
  if (!section) {
    return researchStateSchema.parse(state)
  }

  const response = await promptAgent({
    config,
    sessionID: state.drafterSessionId,
    agent: config.quorumConfig.designatedDrafter,
    prompt: sectionPrompt(config, promptBundle, state, section, state.sectionDrafts.length),
    telemetry: graphAgentTelemetry({
      telemetry,
      state,
      name: "agent.draftSection",
      agentName: config.quorumConfig.designatedDrafter,
      sessionId: state.drafterSessionId,
      input: {
        requestId: state.requestId,
        round: state.round,
        heading: section.heading,
        sectionIndex: state.sectionDrafts.length,
      },
    }),
  })

  const nextSectionDrafts: SectionDraft[] = [
    ...state.sectionDrafts,
    {
      heading: section.heading,
      markdown: response.text ?? `## ${section.heading}`,
    },
  ]

  return researchStateSchema.parse({
    ...state,
    sectionDrafts: nextSectionDrafts,
  })
}

async function stitchDraft(config: RuntimeConfig, promptBundle: PromptBundle, state: ResearchState, telemetry?: GraphTelemetry) {
  assertStatus(state, "drafting", "stitchDraft")
  if (!state.drafterSessionId) throw new Error("Missing drafterSessionId during stitchDraft")
  if (!state.outline) throw new Error("Missing outline during stitchDraft")

  const response = await promptAgent({
    config,
    sessionID: state.drafterSessionId,
    agent: config.quorumConfig.designatedDrafter,
    prompt: stitchPrompt(config, promptBundle, state),
    telemetry: graphAgentTelemetry({
      telemetry,
      state,
      name: "agent.stitchDraft",
      agentName: config.quorumConfig.designatedDrafter,
      sessionId: state.drafterSessionId,
      input: {
        requestId: state.requestId,
        round: state.round,
        sectionCount: state.sectionDrafts.length,
      },
    }),
  })

  return researchStateSchema.parse({
    ...state,
    draft: response.text ?? state.draft,
    status: "auditing",
  })
}

function graphAgentTelemetry(input: {
  telemetry: GraphTelemetry | undefined
  state: ResearchState
  name: string
  agentName: string
  sessionId: string
  type?: "Span" | "Agent" | "Chain" | "Evaluator" | "Generation" | "Tool"
  input?: unknown
}) {
  if (!input.telemetry) return undefined

  return {
    run: input.telemetry.run,
    parentObservation: input.telemetry.currentNode,
    name: input.name,
    type: input.type ?? "Agent",
    input:
      input.input ??
      ({
        requestId: input.state.requestId,
        round: input.state.round,
        status: input.state.status,
      } satisfies Record<string, unknown>),
    metadata: {
      requestId: input.state.requestId,
      round: input.state.round,
      status: input.state.status,
      agentName: input.agentName,
      sessionId: input.sessionId,
    },
    trackSessionObservation: input.telemetry.trackSessionObservation,
  }
}

async function runParallelAudits(config: RuntimeConfig, promptBundle: PromptBundle, state: ResearchState, telemetry?: GraphTelemetry) {
  assertStatus(state, "auditing", "runParallelAudits")
  const request = requestLabel(state)
  const auditPromises: Promise<AuditResultRecord>[] = []

  for (const agent of config.quorumConfig.auditors) {
    const sessionID = state.auditSessionIds[agent]
    if (!sessionID) throw new Error(`Missing audit session for agent ${agent}`)

    auditPromises.push(
      promptAgent({
        config,
        sessionID,
        agent,
        prompt: auditPrompt(config, promptBundle, agent, request, state.draft),
        schema: auditResultSchema,
        telemetry: graphAgentTelemetry({
          telemetry,
          state,
          name: `agent.audit.${agent}`,
          agentName: agent,
          sessionId: sessionID,
          input: {
            requestId: state.requestId,
            round: state.round,
            agent,
          },
        }),
      }).then((response) => {
        if (!response.structured) {
          throw new Error(`Missing structured audit response from agent ${agent}`)
        }

        const findings = []

        for (let findingIndex = 0; findingIndex < response.structured.findings.length; findingIndex += 1) {
          const finding = response.structured.findings[findingIndex]
          findings.push({
            ...finding,
            findingId: `${state.requestId}:${state.round}:${agent}:${findingIndex}`,
          })
        }

        const record = auditResultRecordSchema.parse({
          ...response.structured,
          agent,
          findings,
        })

        return record
      }),
    )
  }

  const audits = await Promise.all(auditPromises)
  const approvedAgents: string[] = []

  for (const audit of audits) {
    if (audit.vote === "approve") {
      approvedAgents.push(audit.agent)
    }
  }

  return researchStateSchema.parse({
    ...state,
    audits,
    activeRebuttals: {},
    currentRebuttalResponsesByFinding: {},
    approvedAgents,
    status: "reviewing_findings",
    failureReason: undefined,
  })
}

async function reviewFindingsByDrafter(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  state: ResearchState,
  telemetry?: GraphTelemetry,
) {
  assertStatus(state, "reviewing_findings", "reviewFindingsByDrafter")
  if (!state.drafterSessionId) throw new Error("Missing drafterSessionId during reviewFindingsByDrafter")

  const findingsOnly: AuditResultRecord[] = []

  for (const audit of state.audits) {
    if (audit.findings.length > 0) {
      findingsOnly.push(audit)
    }
  }

  if (findingsOnly.length === 0) {
    return researchStateSchema.parse({
      ...state,
      activeRebuttals: {},
      currentRebuttalResponsesByFinding: {},
      status: "aggregating",
    })
  }

  const response = await promptAgent({
    config,
    sessionID: state.drafterSessionId,
    agent: config.quorumConfig.designatedDrafter,
    prompt: drafterReviewPrompt(config, promptBundle, requestLabel(state), state.draft, findingsOnly, state.rebuttalTurnCounts),
    schema: drafterFindingReviewSchema,
    telemetry: graphAgentTelemetry({
      telemetry,
      state,
      name: "agent.reviewFindingsByDrafter",
      agentName: config.quorumConfig.designatedDrafter,
      sessionId: state.drafterSessionId,
      input: {
        requestId: state.requestId,
        round: state.round,
        findings: findingsOnly.length,
      },
    }),
  })

  if (!response.structured) {
    throw new Error("Missing structured drafter finding review")
  }

  const accepted = new Set<string>()
  const currentFindingIds = new Set<string>()

  for (const audit of findingsOnly) {
    for (const finding of audit.findings) {
      currentFindingIds.add(finding.findingId)
    }
  }

  for (const key of response.structured.acceptedFindingIds) {
    if (!currentFindingIds.has(key)) continue
    accepted.add(key)
  }

  const capped = cappedFindingKeys(config, state)
  const activeRebuttals = buildActiveRebuttalMap(findingsOnly, response.structured.rebuttals)
  for (const key of Object.keys(activeRebuttals)) {
    if (!currentFindingIds.has(key) || accepted.has(key) || capped.has(key)) {
      delete activeRebuttals[key]
    }
  }

  const nextTurnCounts = nextRebuttalTurnCounts(state, activeRebuttals)
  let nextStatus: ResearchState["status"] = "aggregating"

  if (hasEligibleRebuttalTurn(config, {
    ...state,
    activeRebuttals,
    rebuttalTurnCounts: nextTurnCounts,
  } as ResearchState)) {
    nextStatus = "awaiting_auditor_rebuttal"
  }

  const nextState = {
    ...state,
    activeRebuttals,
    currentRebuttalResponsesByFinding: {},
    rebuttalTurnCounts: nextTurnCounts,
    rebuttalHistory: appendRebuttalHistory(state, activeRebuttals),
    status: nextStatus,
  }

  return researchStateSchema.parse(nextState)
}

async function runTargetedRebuttals(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  state: ResearchState,
  telemetry?: GraphTelemetry,
) {
  assertStatus(state, "awaiting_auditor_rebuttal", "runTargetedRebuttals")
  if (!hasEligibleRebuttalTurn(config, state)) {
    throw new Error("No eligible rebuttal turns remain for runTargetedRebuttals")
  }

  const rebuttalsByAgent: Record<string, ActiveRebuttal[]> = {}
  for (const rebuttal of Object.values(state.activeRebuttals)) {
    if (!rebuttalsByAgent[rebuttal.targetAgent]) {
      rebuttalsByAgent[rebuttal.targetAgent] = []
    }
    rebuttalsByAgent[rebuttal.targetAgent].push(rebuttal)
  }

  const responsePromises: Promise<Array<[string, RebuttalResponseRecord]>>[] = []

  async function runAgentRebuttal(
    agent: string,
    rebuttals: ActiveRebuttal[],
    sessionID: string,
  ): Promise<Array<[string, RebuttalResponseRecord]>> {
    const chainObservation = await telemetry?.run.startObservation({
      traceId: telemetry.run.traceId ?? "",
      parentObservationId: telemetry.currentNode?.id,
      name: `chain.rebuttal.${agent}`,
      type: "Chain",
      input: {
        requestId: state.requestId,
        round: state.round,
        rebuttalCount: rebuttals.length,
      },
      metadata: {
        requestId: state.requestId,
        round: state.round,
        agentName: agent,
        sessionId: sessionID,
      },
    })

    try {
      const response = await promptAgent({
        config,
        sessionID,
        agent,
        prompt: rebuttalPrompt(config, promptBundle, requestLabel(state), state.draft, rebuttals),
        schema: rebuttalBatchResponseSchema,
        telemetry: !telemetry
          ? undefined
          : {
              run: telemetry.run,
              parentObservation: chainObservation ?? telemetry.currentNode,
              trackSessionObservation: telemetry.trackSessionObservation,
              name: `agent.rebuttal.${agent}`,
              input: {
                requestId: state.requestId,
                round: state.round,
                rebuttalCount: rebuttals.length,
              },
              metadata: {
                requestId: state.requestId,
                round: state.round,
                status: state.status,
                agentName: agent,
                sessionId: sessionID,
              },
            },
      })

      if (!response.structured) {
        throw new Error(`Missing structured rebuttal response from agent ${agent}`)
      }

      const expectedFindingIds = new Set<string>()
      for (const rebuttal of rebuttals) {
        expectedFindingIds.add(rebuttal.findingId)
      }

      const receivedFindingIds = new Set<string>()
      const turnResponses: Array<[string, RebuttalResponseRecord]> = []

      for (const entry of response.structured.responses) {
        const active = rebuttals.find((rebuttal) => rebuttal.findingId === entry.findingId)
        if (!active) {
          throw new Error(`No active rebuttal found for ${agent}:${entry.findingId}`)
        }

        receivedFindingIds.add(entry.findingId)

        turnResponses.push([
          findingStateKey(active),
          {
            ...entry,
            agent,
            turn: state.rebuttalTurnCounts[active.findingId] ?? 1,
          },
        ])
      }

      for (const findingId of expectedFindingIds) {
        if (!receivedFindingIds.has(findingId)) {
          throw new Error(`Missing rebuttal response for ${agent}:${findingId}`)
        }
      }

      await telemetry?.run.endObservation(chainObservation, {
        output: {
          rebuttalCount: turnResponses.length,
        },
        metadata: {
          requestId: state.requestId,
          round: state.round,
          agentName: agent,
        },
      })

      return turnResponses
    } catch (error) {
      await telemetry?.run.endObservation(chainObservation, {
        level: "ERROR",
        statusMessage: error instanceof Error ? error.message : String(error),
        metadata: {
          requestId: state.requestId,
          round: state.round,
          agentName: agent,
        },
      })
      throw error
    }
  }

  for (const [agent, rebuttals] of Object.entries(rebuttalsByAgent)) {
    const sessionID = state.auditSessionIds[agent]
    if (!sessionID) throw new Error(`Missing audit session for rebuttal agent ${agent}`)
    responsePromises.push(runAgentRebuttal(agent, rebuttals, sessionID))
  }

  const responseEntries = await Promise.all(responsePromises)
  const currentRebuttalResponsesByFinding: Record<string, RebuttalResponseRecord> = {}

  for (const entries of responseEntries) {
    for (const [findingKey, response] of entries) {
      currentRebuttalResponsesByFinding[findingKey] = response
    }
  }

  return researchStateSchema.parse({
    ...state,
    currentRebuttalResponsesByFinding,
    rebuttalResponseHistory: appendRebuttalResponseHistory(state, currentRebuttalResponsesByFinding),
    status: "reviewing_rebuttal_responses",
  })
}

async function reviewRebuttalResponses(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  state: ResearchState,
  telemetry?: GraphTelemetry,
) {
  assertStatus(state, "reviewing_rebuttal_responses", "reviewRebuttalResponses")
  if (!state.drafterSessionId) throw new Error("Missing drafterSessionId during reviewRebuttalResponses")

  const capped = cappedFindingKeys(config, state)
  const disputed: Array<{ findingId: string; rebuttal: ActiveRebuttal; response: RebuttalResponseRecord }> = []

  for (const [findingId, rebuttal] of Object.entries(state.activeRebuttals)) {
    const response = state.currentRebuttalResponsesByFinding[findingId]
    if (!response) continue
    if (response.decision !== "uphold") continue
    if (capped.has(findingId)) continue

    disputed.push({
      findingId,
      rebuttal,
      response,
    })
  }

  if (disputed.length === 0) {
    return researchStateSchema.parse({
      ...state,
      activeRebuttals: {},
      currentRebuttalResponsesByFinding: {},
      status: "aggregating",
    })
  }

  const response = await promptAgent({
    config,
    sessionID: state.drafterSessionId,
    agent: config.quorumConfig.designatedDrafter,
    prompt: rebuttalReviewPrompt(
      config,
      promptBundle,
      requestLabel(state),
      state.draft,
      disputed,
      state.rebuttalTurnCounts,
    ),
    schema: drafterFindingReviewSchema,
    telemetry: graphAgentTelemetry({
      telemetry,
      state,
      name: "agent.reviewRebuttalResponses",
      agentName: config.quorumConfig.designatedDrafter,
      sessionId: state.drafterSessionId,
      input: {
        requestId: state.requestId,
        round: state.round,
        disputed: disputed.length,
      },
    }),
  })

  if (!response.structured) {
    throw new Error("Missing structured drafter rebuttal review")
  }

  const allowed = new Set<string>()
  for (const entry of disputed) {
    allowed.add(entry.findingId)
  }

  const accepted = new Set<string>()
  for (const key of response.structured.acceptedFindingIds) {
    if (allowed.has(key)) {
      accepted.add(key)
    }
  }

  const activeRebuttals = buildActiveRebuttalMap(state.audits, response.structured.rebuttals)
  for (const key of Object.keys(activeRebuttals)) {
    if (!allowed.has(key) || accepted.has(key) || capped.has(key)) {
      delete activeRebuttals[key]
    }
  }

  const nextTurnCounts = nextRebuttalTurnCounts(state, activeRebuttals)
  let nextStatus: ResearchState["status"] = "aggregating"

  if (hasEligibleRebuttalTurn(config, {
    ...state,
    activeRebuttals,
    rebuttalTurnCounts: nextTurnCounts,
  } as ResearchState)) {
    nextStatus = "awaiting_auditor_rebuttal"
  }

  const nextState = {
    ...state,
    activeRebuttals,
    currentRebuttalResponsesByFinding: {},
    rebuttalTurnCounts: nextTurnCounts,
    rebuttalHistory: appendRebuttalHistory(state, activeRebuttals),
    status: nextStatus,
  }

  return researchStateSchema.parse(nextState)
}

export async function aggregateConsensus(config: RuntimeConfig, state: ResearchState) {
  assertStatus(state, "aggregating", "aggregateConsensus")

  const effectiveResponses = effectiveResponsesByFinding(state)
  const unresolvedCandidates: AggregatedFinding[] = []
  const aggregatedFindings = toAggregatedFindings(state.audits)

  for (const finding of aggregatedFindings) {
    const response = effectiveResponses[finding.findingId]

    if (!response) {
      unresolvedCandidates.push(finding)
      continue
    }

    if (response.decision === "withdraw") {
      continue
    }

    if (response.decision === "soften") {
      unresolvedCandidates.push(
        aggregatedFindingSchema.parse({
          ...response.updatedFinding,
          findingId: finding.findingId,
          required_fix: response.updatedFinding.required_fix ?? finding.required_fix,
          agent: finding.agent,
        }),
      )
      continue
    }

    unresolvedCandidates.push(finding)
  }

  const unresolved = dedupeFindings(unresolvedCandidates)
  const signature = unresolvedSignature(unresolved)
  const approvedAgents = approvedAgentsForOutcome(state, unresolved)
  const allAuditorsApproved = approvedAgents.length === config.quorumConfig.auditors.length
  const isApproved = config.quorumConfig.requireUnanimousApproval ? allAuditorsApproved : unresolved.length === 0
  const stagnated = unresolved.length > 0 && state.lastUnresolvedSignature === signature
  const maxRoundsExhausted = unresolved.length > 0 && state.round >= config.quorumConfig.maxRounds
  let outcome: AggregatedFindings["outcome"] = "needs_revision"
  let failureReason: ResearchState["failureReason"] = undefined
  let nextStatus: ResearchState["status"] = "revising"

  if (isApproved) {
    outcome = "approved"
    nextStatus = "approved"
  } else if (stagnated) {
    outcome = "failed_non_convergent"
    failureReason = "stagnated_findings"
    nextStatus = "failed"
  } else if (maxRoundsExhausted) {
    outcome = "failed_non_convergent"
    failureReason = "max_rounds_exhausted"
    nextStatus = "failed"
  }

  aggregatedFindingsSchema.parse({
    outcome,
    approvedAgents,
    unresolvedFindings: unresolved,
    failureReason,
  })

  return researchStateSchema.parse({
    ...state,
    unresolvedFindings: unresolved,
    approvedAgents,
    lastUnresolvedSignature: signature,
    failureReason,
    status: nextStatus,
  })
}

function summarizeNodeResult(result: unknown) {
  if (!result || typeof result !== "object") return undefined

  if (researchStateSchema.safeParse(result).success) {
    const state = result as ResearchState
    return {
      requestId: state.requestId,
      round: state.round,
      status: state.status,
      inputSummary: state.inputSummary?.title,
      artifactSummary: state.artifactSummary?.title,
      approvedAgents: state.approvedAgents.length,
      audits: state.audits.length,
      activeRebuttals: Object.keys(state.activeRebuttals).length,
      rebuttalResponses: Object.keys(state.currentRebuttalResponsesByFinding).length,
      unresolvedFindings: state.unresolvedFindings.length,
      failureReason: state.failureReason,
      outputPath: state.outputPath,
    }
  }

  return result
}

async function reviseDraft(config: RuntimeConfig, promptBundle: PromptBundle, state: ResearchState, telemetry?: GraphTelemetry) {
  assertStatus(state, "revising", "reviseDraft")
  if (!state.drafterSessionId) throw new Error("Missing drafterSessionId during reviseDraft")
  if (!state.outputPath) throw new Error("Missing outputPath during reviseDraft")

  // Ensure the run dir exists before persisting intermediate drafts for a revision round.
  await ensureRunDirPath(state.outputPath)
  await Bun.write(`${state.outputPath}/draft-round-${state.round}.md`, state.draft)

  const response = await promptAgent({
    config,
    sessionID: state.drafterSessionId,
    agent: config.quorumConfig.designatedDrafter,
    prompt: revisionPrompt(config, promptBundle, state),
    telemetry: graphAgentTelemetry({
      telemetry,
      state,
      name: "agent.reviseDraft",
      agentName: config.quorumConfig.designatedDrafter,
      sessionId: state.drafterSessionId,
      input: {
        requestId: state.requestId,
        round: state.round,
        unresolvedFindings: state.unresolvedFindings.length,
      },
    }),
  })

  return researchStateSchema.parse({
    ...state,
    draft: response.text ?? state.draft,
    audits: [],
    activeRebuttals: {},
    currentRebuttalResponsesByFinding: {},
    approvedAgents: [],
    round: state.round + 1,
    status: "auditing",
    failureReason: undefined,
  })
}

async function finalizeApprovedDraft(_config: RuntimeConfig, state: ResearchState) {
  assertStatus(state, "approved", "finalizeApprovedDraft")
  if (!state.outputPath) throw new Error("Missing outputPath during finalizeApprovedDraft")

  await writeApprovedArtifacts(state.outputPath, {
    draft: state.draft,
    summary: buildRunSummary(state, "approved"),
  })

  return researchStateSchema.parse(state)
}

async function finalizeFailedRun(_config: RuntimeConfig, state: ResearchState) {
  assertStatus(state, "failed", "finalizeFailedRun")
  if (!state.outputPath) throw new Error("Missing outputPath during finalizeFailedRun")

  await writeFailedArtifacts(state.outputPath, {
    draft: state.draft,
    summary: buildRunSummary(state, "failed_non_convergent"),
  })

  return researchStateSchema.parse(state)
}

export async function summarizeOutputArtifact(config: RuntimeConfig, state: ResearchState, telemetry?: GraphTelemetry) {
  if (state.status !== "approved" && state.status !== "failed") {
    throw new Error(`Invalid status for summarizeOutputArtifact: ${state.status}`)
  }
  if (!state.outputPath) throw new Error("Missing outputPath during summarizeOutputArtifact")

  const artifactPath = state.status === "approved" ? `${state.outputPath}/final.md` : `${state.outputPath}/latest-draft.md`
  const artifactFile = Bun.file(artifactPath)
  if (!(await artifactFile.exists())) {
    return researchStateSchema.parse(state)
  }

  try {
    const summary = await summarizeMarkdown({
      config,
      title: `summary-artifact:${state.requestId}`,
      markdown: await artifactFile.text(),
      mode: "artifact",
      telemetry: !telemetry
        ? undefined
        : {
            run: telemetry.run,
            parentObservation: telemetry.currentNode,
            trackSessionObservation: telemetry.trackSessionObservation,
            name: "agent.summarizeOutputArtifact",
            metadata: {
              requestId: state.requestId,
              round: state.round,
            },
          },
    })

    return researchStateSchema.parse({
      ...state,
      artifactSummary: {
        ...summary,
        sourcePath: artifactPath,
      } satisfies RunDisplaySummary,
    })
  } catch {
    return researchStateSchema.parse(state)
  }
}

export function routeAfterDrafterReview(config: RuntimeConfig, state: ResearchState) {
  if (state.status === "awaiting_auditor_rebuttal") {
    if (!hasEligibleRebuttalTurn(config, state)) {
      throw new Error("State entered awaiting_auditor_rebuttal without eligible rebuttal turns")
    }

    return "runTargetedRebuttals"
  }

  if (state.status === "aggregating") {
    return "aggregateConsensus"
  }

  throw new Error(`Invalid routeAfterDrafterReview status: ${state.status}`)
}

export function routeAfterRebuttalResponses(config: RuntimeConfig, state: ResearchState) {
  if (state.status === "awaiting_auditor_rebuttal") {
    if (!hasEligibleRebuttalTurn(config, state)) {
      throw new Error("State entered awaiting_auditor_rebuttal without eligible rebuttal turns")
    }

    return "runTargetedRebuttals"
  }

  if (state.status === "aggregating") {
    return "aggregateConsensus"
  }

  throw new Error(`Invalid routeAfterRebuttalResponses status: ${state.status}`)
}

export function routeAfterAggregate(state: ResearchState) {
  if (state.status === "approved") return "finalizeApprovedDraft"
  if (state.status === "failed") return "finalizeFailedRun"
  if (state.status === "revising") return "reviseDraft"

  throw new Error(`Invalid routeAfterAggregate status: ${state.status}`)
}

export function createGraph(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  input?: {
    observer?: RunObserver
    telemetry?: GraphTelemetry
  },
) {
  const observer = input?.observer
  const graphTelemetry = input?.telemetry

  async function withNodeTelemetry<T>(node: string, state: ResearchState | GraphInput, fn: () => Promise<T>) {
    observeNode(observer, node, state)

    const round = "round" in state ? state.round : 0
    const status = "status" in state ? state.status : "starting"
    const parentObservationId = graphTelemetry?.currentNode?.id ?? graphTelemetry?.run.rootObservation?.id
    const observation = graphTelemetry?.run.traceId
      ? await graphTelemetry.run.startObservation({
          traceId: graphTelemetry.run.traceId,
          parentObservationId,
          name: `graph.${node}`,
          input: {
            node,
            round,
            status,
          },
          metadata: {
            node,
            round,
            status,
          },
        })
      : undefined

    const previousNode = graphTelemetry?.currentNode
    if (graphTelemetry && observation) {
      graphTelemetry.currentNode = observation
    }

    try {
      const result = await fn()
      await graphTelemetry?.run.endObservation(observation, {
        output: summarizeNodeResult(result) ?? {
          node,
          round,
          status: "completed",
        },
      })
      return observeNodeResult(observer, node, state, result)
    } catch (error) {
      await graphTelemetry?.run.endObservation(observation, {
        level: "ERROR",
        statusMessage: error instanceof Error ? error.message : String(error),
        metadata: {
          node,
          round,
          status,
        },
      })
      throw error
    } finally {
      if (graphTelemetry) {
        graphTelemetry.currentNode = previousNode
      }
    }
  }

  return new StateGraph(researchStateObjectSchema, {
    input: graphInputSchema,
  })
    .addNode(
      "ingestRequest",
      async (input) => withNodeTelemetry("ingestRequest", input, () => ingestRequest(input)),
      { input: graphInputSchema },
    )
    .addNode("summarizeInputDocument", async (state) =>
      withNodeTelemetry("summarizeInputDocument", state, () => summarizeInputDocument(config, state, graphTelemetry)),
    )
    .addNode("prepareOutputPath", async (state) =>
      withNodeTelemetry("prepareOutputPath", state, () => prepareOutputPath(config, state)),
    )
    .addNode("bootstrapRun", async (state) =>
      withNodeTelemetry("bootstrapRun", state, async () => {
        const nextState = await bootstrapRun(config, state)
        if (nextState.rootSessionId) {
          observer?.onSessionCreated?.({ sessionID: nextState.rootSessionId, role: "root", requestId: nextState.requestId })
        }
        if (nextState.drafterSessionId) {
          observer?.onSessionCreated?.({
            sessionID: nextState.drafterSessionId,
            role: "drafter",
            requestId: nextState.requestId,
          })
        }
        for (const [agent, sessionID] of Object.entries(nextState.auditSessionIds)) {
          observer?.onSessionCreated?.({ sessionID, role: `auditor:${agent}`, requestId: nextState.requestId })
        }
        return nextState
      }),
    )
    .addNode("draftOutline", async (state) =>
      withNodeTelemetry("draftOutline", state, () => draftOutline(config, promptBundle, state, graphTelemetry)),
    )
    .addNode("draftNextSection", async (state) =>
      withNodeTelemetry("draftNextSection", state, () => draftNextSection(config, promptBundle, state, graphTelemetry)),
    )
    .addNode("stitchDraft", async (state) =>
      withNodeTelemetry("stitchDraft", state, () => stitchDraft(config, promptBundle, state, graphTelemetry)),
    )
    .addNode("runParallelAudits", async (state) =>
      withNodeTelemetry("runParallelAudits", state, () => runParallelAudits(config, promptBundle, state, graphTelemetry)),
    )
    .addNode("reviewFindingsByDrafter", async (state) =>
      withNodeTelemetry("reviewFindingsByDrafter", state, () =>
        reviewFindingsByDrafter(config, promptBundle, state, graphTelemetry),
      ),
    )
    .addNode("runTargetedRebuttals", async (state) =>
      withNodeTelemetry("runTargetedRebuttals", state, () =>
        runTargetedRebuttals(config, promptBundle, state, graphTelemetry),
      ),
    )
    .addNode("reviewRebuttalResponses", async (state) =>
      withNodeTelemetry("reviewRebuttalResponses", state, () =>
        reviewRebuttalResponses(config, promptBundle, state, graphTelemetry),
      ),
    )
    .addNode("aggregateConsensus", async (state) =>
      withNodeTelemetry("aggregateConsensus", state, () => aggregateConsensus(config, state)),
    )
    .addNode("reviseDraft", async (state) =>
      withNodeTelemetry("reviseDraft", state, () => reviseDraft(config, promptBundle, state, graphTelemetry)),
    )
    .addNode("finalizeApprovedDraft", async (state) =>
      withNodeTelemetry("finalizeApprovedDraft", state, () => finalizeApprovedDraft(config, state)),
    )
    .addNode("finalizeFailedRun", async (state) =>
      withNodeTelemetry("finalizeFailedRun", state, () => finalizeFailedRun(config, state)),
    )
    .addNode("summarizeOutputArtifact", async (state) =>
      withNodeTelemetry("summarizeOutputArtifact", state, () => summarizeOutputArtifact(config, state, graphTelemetry)),
    )
    .addEdge(START, "ingestRequest")
    .addEdge("ingestRequest", "summarizeInputDocument")
    .addEdge("summarizeInputDocument", "prepareOutputPath")
    .addEdge("prepareOutputPath", "bootstrapRun")
    .addEdge("bootstrapRun", "draftOutline")
    .addEdge("draftOutline", "draftNextSection")
    .addConditionalEdges(
      "draftNextSection",
      (state) => ((state.outline?.sections.length ?? 0) > state.sectionDrafts.length ? "draftNextSection" : "stitchDraft"),
      ["draftNextSection", "stitchDraft"],
    )
    .addEdge("stitchDraft", "runParallelAudits")
    .addEdge("runParallelAudits", "reviewFindingsByDrafter")
    .addConditionalEdges("reviewFindingsByDrafter", (state) => routeAfterDrafterReview(config, state), [
      "runTargetedRebuttals",
      "aggregateConsensus",
    ])
    .addEdge("runTargetedRebuttals", "reviewRebuttalResponses")
    .addConditionalEdges("reviewRebuttalResponses", (state) => routeAfterRebuttalResponses(config, state), [
      "runTargetedRebuttals",
      "aggregateConsensus",
    ])
    .addConditionalEdges("aggregateConsensus", routeAfterAggregate, [
      "finalizeApprovedDraft",
      "reviseDraft",
      "finalizeFailedRun",
    ])
    .addEdge("reviseDraft", "runParallelAudits")
    .addEdge("finalizeApprovedDraft", "summarizeOutputArtifact")
    .addEdge("finalizeFailedRun", "summarizeOutputArtifact")
    .addEdge("summarizeOutputArtifact", END)
    .compile({
      checkpointer: new BunSqliteSaver(config.env.QUORUM_CHECKPOINT_PATH),
      name: "research-quorum",
    })
}
