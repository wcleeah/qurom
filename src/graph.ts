import { randomUUID } from "node:crypto"
import { START, StateGraph, interrupt } from "@langchain/langgraph"

import { BunSqliteSaver } from "./checkpointer"
import type { RuntimeConfig } from "./config"
import {
  ensureRunDirPath,
  resolveRunDir,
  writeApprovedArtifacts,
  writeFailedArtifacts,
  writeDesignHtmlArtifact,
  writeRunJsonArtifact,
} from "./output"
import { auditWithRestart } from "./audit-restart"
import { createSession, promptAgent } from "./opencode"
import type { PromptBundle } from "./prompt-assets"
import { summarizeMarkdown } from "./summarizer"
import { designHtml, runDesignAudits, aggregateDesignConsensus, reviseDesignHtml } from "./design-quorum"
import {
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
  readerInterviewTurnSchema,
  type AggregatedFinding,
  type AggregatedFindings,
  type AuditResultRecord,
  type GraphInput,
  type RunDisplaySummary,
  type Rebuttal,
  type RebuttalResponseRecord,
  type ResearchState,
} from "./schema"
import type { TelemetryRun, TraceObservation } from "./telemetry"

import type { DebugLog } from "./debug-log"

export type RunObserver = {
  debugLog?: DebugLog
  onNodeStart?: (node: string, state: ResearchState | GraphInput) => void
  onNodeEnd?: (node: string, state: ResearchState | GraphInput) => void
  onSessionCreated?: (input: { sessionID: string; role: string; requestId: string }) => void
  onDesignPhase?: (phase: "drafting" | "auditing" | "aggregating" | "revising", round: number) => void
}

type GraphTelemetry = {
  run: TelemetryRun
  currentNode?: TraceObservation
  trackSessionObservation?: (sessionID: string, observation: TraceObservation | undefined) => void
  trackAgentMetadata?: (input: { agent: string; sessionID: string; model?: string; variant?: string }) => void
  debugLog?: DebugLog
}

// Cache of reader-interviewer sessionIDs by requestId. LangGraph re-executes
// the discoverReader node from the top on each interrupt resume, so without
// this the node would mint a fresh OpenCode session every turn. Cleared in
// discoverReader when the interview completes or the turn budget is exhausted.
const readerInterviewerSessions = new Map<string, string>()

function observeNode(observer: RunObserver | undefined, node: string, state: ResearchState | GraphInput) {
  observer?.onNodeStart?.(node, state)
  observer?.debugLog?.write("node.start", {
    node,
    round: "round" in state ? state.round : undefined,
    status: "status" in state ? state.status : undefined,
    outputPath: "outputPath" in state ? (state as any).outputPath : undefined,
  })
}

function observeNodeResult<T>(
  observer: RunObserver | undefined,
  node: string,
  state: ResearchState | GraphInput,
  result: T,
) {
  observer?.onNodeEnd?.(node, state)
  observer?.debugLog?.write("node.end", {
    node,
    round: "round" in state ? state.round : undefined,
    status: "status" in state ? state.status : undefined,
  })
  return result
}

function observeSession(
  observer: RunObserver | undefined,
  input: { sessionID: string; role: string; requestId: string },
) {
  observer?.onSessionCreated?.(input)
  observer?.debugLog?.write("session.created", {
    sessionID: input.sessionID,
    role: input.role,
    requestId: input.requestId,
  })
}

function requestLabel(state: ResearchState) {
  if (state.inputMode === "topic") return `topic: ${JSON.stringify(state.topic ?? "")}`
  return `topic: ${state.documentText}`
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

  lines.push(`- Preferred web search provider: ${config.quorumConfig.researchTools.webSearchProvider}. Favor online sources over local files when gathering evidence.`)
  return lines.join("\n")
}

function requestContextBlock(state: ResearchState) {
  if (state.inputMode === "topic") {
    return [`Topic:`, state.topic ?? ""].join("\n")
  } else  {
    return [`Topic:`, state.documentText ?? ""].join("\n")
  }
}

export function readerContextBlock(state: ResearchState): string {
  if (!state.readerProfile || state.readerProfile.length === 0) {
    return state.learningGoal ? `Reader goal: ${state.learningGoal}` : ""
  }
  const familiar = state.readerProfile.filter((c) => c.level === "familiar").map((c) => c.concept)
  const lacks = state.readerProfile.filter((c) => c.level !== "familiar")
  const lines: string[] = []
  if (state.learningGoal) lines.push(`Reader goal: ${state.learningGoal}`)
  if (familiar.length > 0) lines.push(`Reader already knows: ${familiar.join(", ")}`)
  if (lacks.length > 0) {
    lines.push(`Reader does NOT know: ${lacks.map((c) => c.concept).join(", ")}`)
    lines.push(`Include a Prerequisites section covering: ${lacks.map((c) => c.concept).join(", ")}. Explain these before the main topic.`)
  }
  return lines.join("\n")
}

export function fullDraftPrompt(config: RuntimeConfig, promptBundle: PromptBundle, state: ResearchState, outputFile: string) {
  return [
    promptBundle.assets.deepDiveContract,
    researchToolBlock(config),
    requestContextBlock(state),
    readerContextBlock(state),
    promptBundle.assets.draftFullDraft.replace("{outputFile}", outputFile),
  ]
    .filter(Boolean)
    .join("\n\n")
}

export function auditPrompt(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  agent: string,
  state: ResearchState,
  outputFile: string,
  previousUnresolved?: AggregatedFinding[],
) {
  const request = requestLabel(state)
  const deltaContext =
    previousUnresolved && previousUnresolved.length > 0
      ? [
          "This is a revision round. The draft was revised to fix these findings from the previous round:",
          JSON.stringify(
            previousUnresolved.map((f) => ({ severity: f.severity, category: f.category, issue: f.issue })),
            null,
            2,
          ),
          "Focus on whether these specific findings were resolved. Raise new findings only for material new problems introduced by the revision.",
        ].join("\n\n")
      : "This is the first audit of this draft."

  return [
    `You are the ${agent}, user requested a review on the ${request} draft.`,
    promptBundle.assets.audit
      .replace("{deltaContext}", deltaContext)
      .replace("{outputFile}", outputFile)
      .replace("{readerContext}", readerContextBlock(state) || "(no reader profile provided — judge clarity against a competent practitioner default)"),
    researchToolBlock(config),
  ].join("\n\n")
}

export function drafterReviewPrompt(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  state: ResearchState,
  outputFile: string,
) {
  const request = requestLabel(state)
  return [
    `You are the drafter-agent reviewing auditor findings for this ${request}.`,
    promptBundle.assets.reviewFindings.replace("{outputFile}", outputFile),
    researchToolBlock(config),
    readerContextBlock(state),
  ].join("\n\n")
}

export function rebuttalPrompt(config: RuntimeConfig, promptBundle: PromptBundle, state: ResearchState, outputFile: string) {
  const request = requestLabel(state)
  return [
    promptBundle.assets.rebuttal.replace("{outputFile}", outputFile),
    researchToolBlock(config),
    `Respond to the disputed findings for this ${request}.`,
    readerContextBlock(state),
    "Return only JSON that matches the requested schema.",
    "Answer only for the findings in the rebuttal list.",
    "Use uphold, soften, or withdraw for each response.",
  ].join("\n\n")
}

export function rebuttalReviewPrompt(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  state: ResearchState,
  outputFile: string,
  maxRebuttalTurns: number,
) {
  const request = requestLabel(state)
  return [
    promptBundle.assets.reviewRebuttalResponses.replace("{outputFile}", outputFile),
    researchToolBlock(config),
    `Review the auditor rebuttal responses for this ${request}.`,
    readerContextBlock(state),
    "Return only JSON that matches the requested schema.",
    "For each disputed finding, either accept the auditor response or issue one narrower rebuttal with stronger evidence.",
    `Do not rebut a finding that has already hit the rebuttal cap of ${maxRebuttalTurns}.`,
  ].join("\n\n")
}

function revisionPrompt(config: RuntimeConfig, promptBundle: PromptBundle, state: ResearchState, outputFile: string) {
  return [
    promptBundle.assets.deepDiveContract,
    promptBundle.assets.reviseDraft.replace("{outputFile}", outputFile),
    researchToolBlock(config),
    requestLabel(state),
  ].join("\n\n")
}

async function persistRequestArtifact(state: ResearchState) {
  if (!state.outputPath) return

  await writeRunJsonArtifact(state.outputPath, "request.json", {
    requestId: state.requestId,
    inputMode: state.inputMode,
    topic: state.topic,
    documentPath: state.documentPath,
    inputSummary: state.inputSummary,
  })
}

async function persistAuditsArtifact(state: ResearchState) {
  if (!state.outputPath) return
  await writeRunJsonArtifact(state.outputPath, `audits-round-${state.round}.json`, state.audits)
}

async function persistDrafterFindingReviewArtifact(
  state: ResearchState,
  review: { acceptedFindingIds: string[]; rebuttals: Rebuttal[] },
) {
  if (!state.outputPath) return
  await writeRunJsonArtifact(state.outputPath, `drafter-finding-review-round-${state.round}.json`, review)
}

async function persistAuditorRebuttalResponsesArtifact(state: ResearchState) {
  if (!state.outputPath) return

  const turn = Math.max(
    1,
    ...Object.values(state.currentRebuttalResponsesByFinding).map((response) => response.turn),
  )
  await writeRunJsonArtifact(
    state.outputPath,
    `auditor-rebuttal-responses-round-${state.round}-turn-${turn}.json`,
    state.currentRebuttalResponsesByFinding,
  )
}

async function persistDrafterRebuttalReviewArtifact(
  state: ResearchState,
  review: { acceptedFindingIds: string[]; rebuttals: Rebuttal[] },
) {
  if (!state.outputPath) return

  const turn = Math.max(
    1,
    ...Object.values(state.activeRebuttals).map((rebuttal) => state.rebuttalTurnCounts[rebuttal.findingId] ?? 1),
  )
  await writeRunJsonArtifact(
    state.outputPath,
    `drafter-rebuttal-review-round-${state.round}-turn-${turn}.json`,
    review,
  )
}

async function persistAggregatedFindingsArtifact(state: ResearchState, input: AggregatedFindings) {
  if (!state.outputPath) return
  await writeRunJsonArtifact(state.outputPath, `aggregated-findings-round-${state.round}.json`, input)
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

  const nextState = researchStateSchema.parse({
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

  await persistRequestArtifact(nextState)
  return nextState
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
  const maxTurns = config.quorumConfig.maxRebuttalTurnsPerFinding

  for (const [key, turns] of Object.entries(state.rebuttalTurnCounts)) {
    if (turns >= maxTurns) {
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
  const minorOnlyAgents = new Set<string>()

  for (const finding of unresolved) {
    unresolvedAgents.add(finding.agent)
    if (finding.severity !== "blocker" && finding.severity !== "major") {
      minorOnlyAgents.add(finding.agent)
    }
  }

  const approvedAgents: string[] = []

  for (const audit of state.audits) {
    if (audit.vote === "approve" || !unresolvedAgents.has(audit.agent)) {
      approvedAgents.push(audit.agent)
    }
  }

  return { approvedAgents, unresolvedAgents, minorOnlyAgents }
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
    draft: "",
    audits: [],
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

async function discoverReaderPrompt(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  state: ResearchState,
  telemetry?: GraphTelemetry,
  observer?: RunObserver,
): Promise<ResearchState> {
  // Kill-switch: short-circuit to a default (empty) profile, run proceeds as today.
  if (!config.quorumConfig.readerDiscovery?.enabled) {
    return researchStateSchema.parse({ ...state })
  }
  if (!state.outputPath) throw new Error("Missing outputPath during discoverReaderPrompt")

  const transcript = [...(state.interviewTranscript ?? [])]

  // Safety net: if the last transcript entry is already an interviewer question,
  // we've already prompted for this turn — pass through to the resume node.
  // (Normal operation: the resume node appends a reader reply, so the last entry
  // is a reader reply when this node runs for the next turn.)
  const lastEntry = transcript[transcript.length - 1]
  if (lastEntry && lastEntry.role === "interviewer") {
    return researchStateSchema.parse({ ...state })
  }

  const maxTurns = config.quorumConfig.readerDiscovery.maxTurns
  const turn = Math.floor(transcript.length / 2) + 1

  // Turn budget exhausted: no profile, drafter falls back to default.
  if (turn > maxTurns) {
    readerInterviewerSessions.delete(state.requestId)
    return researchStateSchema.parse({
      ...state,
      readerProfile: undefined,
      learningGoal: undefined,
    })
  }

  const outputFile = `${state.outputPath}/reader-profile.json`
  // Reuse one OpenCode session across all interview turns.
  let sessionID = readerInterviewerSessions.get(state.requestId)
  if (!sessionID) {
    const session = await createSession(config, `reader-interviewer:${state.requestId}`)
    sessionID = session.id
    readerInterviewerSessions.set(state.requestId, sessionID)
    observeSession(observer, { sessionID, role: "reader-interviewer", requestId: state.requestId })
  }

  const transcriptText = transcript.length === 0
    ? "(none yet — this is the first question)"
    : transcript.map((t) => `${t.role === "interviewer" ? "🤖" : "👤"} ${t.text}`).join("\n")
  const prompt = promptBundle.assets.readerInterview
    .replace("{requestContext}", requestContextBlock(state))
    .replace("{transcript}", transcriptText)
    .replace("{maxTurns}", String(maxTurns))
    .replace("{turn}", String(turn))
    .replace("{outputFile}", outputFile)

  const response = await promptAgent({
    config,
    sessionID,
    agent: "reader-interviewer",
    prompt,
    schema: readerInterviewTurnSchema,
    outputFile,
    telemetry: graphAgentTelemetry({
      telemetry,
      state,
      name: "agent.discoverReader",
      agentName: "reader-interviewer",
      sessionId: sessionID,
      input: { turn, transcriptLen: transcript.length },
    }),
  })

  const turnResult = response.structured
  if (!turnResult || turnResult.done) {
    // Interview complete (or the agent returned nothing recoverable after the router).
    const profile = turnResult?.profile
    readerInterviewerSessions.delete(state.requestId)
    return researchStateSchema.parse({
      ...state,
      readerProfile: profile?.concepts,
      learningGoal: profile?.learningGoal,
    })
  }

  // Not done: append the question to the transcript and route to the resume node.
  transcript.push({ role: "interviewer", text: turnResult.questions.join("\n") })
  return researchStateSchema.parse({
    ...state,
    interviewTranscript: transcript,
  })
}

/**
 * Resume node: calls interrupt() to pause for the reader's reply, then appends
 * the reply to the transcript. On re-execution (LangGraph resumes after the
 * interrupt), interrupt() returns the resume value instead of throwing, so the
 * node completes and routes back to discoverReaderPrompt for the next turn.
 */
async function discoverReaderResume(
  _config: RuntimeConfig,
  state: ResearchState,
): Promise<ResearchState> {
  const transcript = [...(state.interviewTranscript ?? [])]
  const lastEntry = transcript[transcript.length - 1]
  const questions = lastEntry && lastEntry.role === "interviewer"
    ? lastEntry.text.split("\n")
    : []

  // interrupt() suspends the graph on the first pass; on resume it returns
  // the value passed to Command({ resume }). The node then appends the reply
  // to the transcript and returns — routing back to discoverReaderPrompt.
  const reply = interrupt<string[], string>(questions)
  transcript.push({ role: "reader", text: reply })
  return researchStateSchema.parse({
    ...state,
    interviewTranscript: transcript,
  })
}

/**
 * Conditional router after discoverReaderPrompt:
 * - readerProfile set → interview complete → draftFullDraft
 * - last transcript entry is an interviewer question → need a reply → discoverReaderResume
 * - otherwise (kill-switch, budget exhausted, no pending question) → draftFullDraft
 */
function routeAfterReaderPrompt(state: ResearchState): string {
  if (state.readerProfile !== undefined) return "draftFullDraft"
  const transcript = state.interviewTranscript ?? []
  const lastEntry = transcript[transcript.length - 1]
  if (lastEntry && lastEntry.role === "interviewer") return "discoverReaderResume"
  return "draftFullDraft"
}

async function draftFullDraft(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  state: ResearchState,
  telemetry?: GraphTelemetry,
  observer?: RunObserver,
) {
  assertStatus(state, "drafting", "draftFullDraft")

  const outputFile = `${state.outputPath}/draft-round-${state.round}.md`
  const session = await createSession(config, `research-drafter:${state.requestId}:draft:${state.round}`)
  observeSession(observer, { sessionID: session.id, role: "drafter", requestId: state.requestId })

  const prompt = fullDraftPrompt(config, promptBundle, state, outputFile)
  const response = await promptAgent({
    config,
    sessionID: session.id,
    agent: config.quorumConfig.designatedDrafter,
    prompt,
    outputFile,
    telemetry: graphAgentTelemetry({
      telemetry,
      state,
      name: "agent.draftFullDraft",
      agentName: config.quorumConfig.designatedDrafter,
      sessionId: session.id,
      input: {
        requestId: state.requestId,
        round: state.round,
        inputMode: state.inputMode,
      },
    }),
  })

  return researchStateSchema.parse({
    ...state,
    draft: response.text || state.draft,
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
    debugLog: input.telemetry.debugLog,
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
    trackAgentMetadata: input.telemetry.trackAgentMetadata,
  }
}

async function runParallelAudits(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  state: ResearchState,
  telemetry?: GraphTelemetry,
  observer?: RunObserver,
) {
  assertStatus(state, "auditing", "runParallelAudits")
  const auditPromises: Promise<AuditResultRecord>[] = []

  // Always run all configured auditors — tier only controls round/rebuttal limits
  const auditors = config.quorumConfig.auditors
  const draftFile = `${state.outputPath}/draft-round-${state.round}.md`
  for (const agent of auditors) {
    auditPromises.push(
      (async () => {
        const session = await createSession(config, `audit:${state.requestId}:${agent}:round:${state.round}`)
        observeSession(observer, { sessionID: session.id, role: `auditor:${agent}`, requestId: state.requestId })
        const outputFile = `${state.outputPath}/audit-${agent}-round-${state.round}.json`
        const auditRun = (sessionID: string) => promptAgent({
          config,
          sessionID,
          agent,
          prompt: auditPrompt(config, promptBundle, agent, state, outputFile, state.round > 0 ? state.unresolvedFindings : undefined),
          schema: auditResultSchema,
          outputFile,
          inputFiles: [
            { path: draftFile, mime: "text/plain", filename: "draft.md" },
          ],
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
        })
        const response = await auditWithRestart({
          maxRestarts: config.quorumConfig.auditRestart.maxRestarts,
          agent,
          round: state.round,
          requestId: state.requestId,
          titleBase: `audit:${state.requestId}:${agent}:round:${state.round}`,
          firstSessionID: session.id,
          createSession: (title) => createSession(config, title),
          onSessionCreated: (id) => observeSession(observer, { sessionID: id, role: `auditor:${agent}`, requestId: state.requestId }),
          runAttempt: auditRun,
          debugLog: telemetry?.debugLog ?? observer?.debugLog,
        })

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
      })(),
    )
  }

  const audits = await Promise.all(auditPromises)
  const approvedAgents: string[] = []

  for (const audit of audits) {
    if (audit.vote === "approve") {
      approvedAgents.push(audit.agent)
    }
  }

  const nextState = researchStateSchema.parse({
    ...state,
    audits,
    activeRebuttals: {},
    currentRebuttalResponsesByFinding: {},
    approvedAgents,
    status: "reviewing_findings",
    failureReason: undefined,
  })

  await persistAuditsArtifact(nextState)
  return nextState
}

async function reviewFindingsByDrafter(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  state: ResearchState,
  telemetry?: GraphTelemetry,
  observer?: RunObserver,
) {
  assertStatus(state, "reviewing_findings", "reviewFindingsByDrafter")

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

  const session = await createSession(config, `research-drafter:${state.requestId}:review-findings:${state.round}`)
  observeSession(observer, { sessionID: session.id, role: "drafter", requestId: state.requestId })

  // Audits file was already written by persistAuditsArtifact in runParallelAudits
  const auditsFile = `${state.outputPath}/audits-round-${state.round}.json`
  const draftFile = `${state.outputPath}/draft-round-${state.round}.md`
  const outputFile = `${state.outputPath}/drafter-finding-review-round-${state.round}.json`

  const response = await promptAgent({
    config,
    sessionID: session.id,
    agent: config.quorumConfig.designatedDrafter,
    prompt: drafterReviewPrompt(config, promptBundle, state, outputFile),
    schema: drafterFindingReviewSchema,
    outputFile,
    inputFiles: [
      { path: draftFile, mime: "text/plain", filename: "draft.md" },
      { path: auditsFile, mime: "text/plain", filename: "audits.json" },
    ],
    telemetry: graphAgentTelemetry({
      telemetry,
      state,
      name: "agent.reviewFindingsByDrafter",
      agentName: config.quorumConfig.designatedDrafter,
      sessionId: session.id,
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

  await persistDrafterFindingReviewArtifact(state, response.structured)

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
  observer?: RunObserver,
) {
  assertStatus(state, "awaiting_auditor_rebuttal", "runTargetedRebuttals")
  if (!state.outputPath) throw new Error("Missing outputPath during runTargetedRebuttals")
  if (!hasEligibleRebuttalTurn(config, state)) {
    throw new Error("No eligible rebuttal turns remain for runTargetedRebuttals")
  }

  const outputPath = state.outputPath
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
  ): Promise<Array<[string, RebuttalResponseRecord]>> {
    const session = await createSession(config, `audit:${state.requestId}:${agent}:rebuttal:${state.round}`)
    observeSession(observer, { sessionID: session.id, role: `auditor:${agent}`, requestId: state.requestId })

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
        sessionId: session.id,
      },
    })

    try {
      // Write rebuttals to a temp JSON file so the agent can read it as an attachment
      const rebuttalsFile = `${outputPath}/rebuttals-${agent}-round-${state.round}.json`
      await writeRunJsonArtifact(outputPath, `rebuttals-${agent}-round-${state.round}.json`, rebuttals)
      const draftFile = `${outputPath}/draft-round-${state.round}.md`
      const outputFile = `${outputPath}/auditor-rebuttal-responses-${agent}-round-${state.round}.json`

      const response = await promptAgent({
        config,
        sessionID: session.id,
        agent,
        prompt: rebuttalPrompt(config, promptBundle, state, outputFile),
        schema: rebuttalBatchResponseSchema,
        outputFile,
        inputFiles: [
          { path: draftFile, mime: "text/plain", filename: "draft.md" },
          { path: rebuttalsFile, mime: "text/plain", filename: "rebuttals.json" },
        ],
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
                sessionId: session.id,
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
    responsePromises.push(runAgentRebuttal(agent, rebuttals))
  }

  const responseEntries = await Promise.all(responsePromises)
  const currentRebuttalResponsesByFinding: Record<string, RebuttalResponseRecord> = {}

  for (const entries of responseEntries) {
    for (const [findingKey, response] of entries) {
      currentRebuttalResponsesByFinding[findingKey] = response
    }
  }

  const nextState = researchStateSchema.parse({
    ...state,
    currentRebuttalResponsesByFinding,
    rebuttalResponseHistory: appendRebuttalResponseHistory(state, currentRebuttalResponsesByFinding),
    status: "reviewing_rebuttal_responses",
  })

  await persistAuditorRebuttalResponsesArtifact(nextState)
  return nextState
}

async function reviewRebuttalResponses(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  state: ResearchState,
  telemetry?: GraphTelemetry,
  observer?: RunObserver,
) {
  assertStatus(state, "reviewing_rebuttal_responses", "reviewRebuttalResponses")
  if (!state.outputPath) throw new Error("Missing outputPath during reviewRebuttalResponses")

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

  const session = await createSession(config, `research-drafter:${state.requestId}:review-rebuttal:${state.round}`)
  observeSession(observer, { sessionID: session.id, role: "drafter", requestId: state.requestId })

  const maxRebuttalTurns = config.quorumConfig.maxRebuttalTurnsPerFinding

  // Write disputed findings + rebuttal turn counts to a temp JSON file for attachment
  const disputedFile = `${state.outputPath}/disputed-round-${state.round}.json`
  await writeRunJsonArtifact(state.outputPath, `disputed-round-${state.round}.json`, {
    disputed,
    rebuttalTurnCounts: state.rebuttalTurnCounts,
  })
  const draftFile = `${state.outputPath}/draft-round-${state.round}.md`
  const outputFile = `${state.outputPath}/drafter-rebuttal-review-round-${state.round}.json`

  const response = await promptAgent({
    config,
    sessionID: session.id,
    agent: config.quorumConfig.designatedDrafter,
    prompt: rebuttalReviewPrompt(
      config,
      promptBundle,
      state,
      outputFile,
      maxRebuttalTurns,
    ),
    schema: drafterFindingReviewSchema,
    outputFile,
    inputFiles: [
      { path: draftFile, mime: "text/plain", filename: "draft.md" },
      { path: disputedFile, mime: "text/plain", filename: "disputed.json" },
    ],
    telemetry: graphAgentTelemetry({
      telemetry,
      state,
      name: "agent.reviewRebuttalResponses",
      agentName: config.quorumConfig.designatedDrafter,
      sessionId: session.id,
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

  await persistDrafterRebuttalReviewArtifact(state, response.structured)

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
  const { approvedAgents, minorOnlyAgents } = approvedAgentsForOutcome(state, unresolved)
  const hasBlockersOrMajors = unresolved.some((f) => f.severity === "blocker" || f.severity === "major")

  // Auditors and unanimity are global config; maxRounds is the global cap.
  const effectiveAuditors = config.quorumConfig.auditors
  const effectiveRequireUnanimous = config.quorumConfig.requireUnanimousApproval
  const effectiveMaxRounds = config.quorumConfig.maxRounds

  const auditorsWithOnlyMinors = effectiveAuditors.filter(
    (a) => minorOnlyAgents.has(a) && !hasBlockersOrMajors,
  )
  const allAuditorsOk = approvedAgents.length + auditorsWithOnlyMinors.length >= effectiveAuditors.length
  const isApproved = effectiveRequireUnanimous
    ? allAuditorsOk && !hasBlockersOrMajors
    : unresolved.length === 0
  const stagnated = unresolved.length > 0 && state.lastUnresolvedSignature === signature
  const maxRoundsExhausted = unresolved.length > 0 && state.round >= effectiveMaxRounds
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

  // If outcome is "approved" but there are unresolved minor findings, set to "approved_with_caveats"
  if (outcome === "approved" && unresolved.length > 0) {
    const allMinor = unresolved.every((f) => f.severity === "minor")
    if (allMinor) {
      outcome = "approved_with_caveats"
      nextStatus = "approved"
    }
  }

  aggregatedFindingsSchema.parse({
    outcome,
    approvedAgents,
    unresolvedFindings: unresolved,
    failureReason,
  })

  await persistAggregatedFindingsArtifact(state, {
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

// ── Confidence scoring helpers ──

function extractSections(draft: string): Array<{ heading: string; content: string; startIndex: number }> {
  const sections: Array<{ heading: string; content: string; startIndex: number }> = []
  const headingRegex = /^## (.+)$/gm
  let match: RegExpExecArray | null

  while ((match = headingRegex.exec(draft)) !== null) {
    const heading = match[1].trim()
    const startIndex = match.index
    sections.push({ heading, content: "", startIndex })
  }

  if (sections.length === 0) {
    // No ## headings found — treat entire draft as one section
    sections.push({ heading: "Document", content: draft, startIndex: 0 })
    return sections
  }

  for (let i = 0; i < sections.length; i++) {
    const start = sections[i].startIndex
    const end = i + 1 < sections.length ? sections[i + 1].startIndex : draft.length
    sections[i].content = draft.slice(start, end)
  }

  return sections
}

function getRebuttalMultiplier(
  findingId: string,
  rebuttalResponseHistory: ResearchState["rebuttalResponseHistory"],
): number {
  const responses = rebuttalResponseHistory
    .filter((e) => e.findingKey === findingId)
    .sort((a, b) => b.turn - a.turn)

  if (responses.length === 0) return 1.0

  const latest = responses[0].response
  if (latest.decision === "withdraw") return 0.0
  if (latest.decision === "soften") return 0.5
  return 1.0
}

function mapFindingsToSections(
  sections: Array<{ heading: string; content: string }>,
  findings: AggregatedFinding[],
): Map<string, AggregatedFinding[]> {
  const map = new Map<string, AggregatedFinding[]>()

  for (const finding of findings) {
    let bestSection: string | undefined
    let bestScore = 0

    for (const section of sections) {
      let score = 0
      if (finding.issue.toLowerCase().includes(section.heading.toLowerCase())) score += 3
      for (const evidence of finding.evidence) {
        if (evidence.toLowerCase().includes(section.heading.toLowerCase())) score += 1
        if (section.content.includes(evidence.slice(0, 50))) score += 2
      }
      if (score > bestScore) {
        bestScore = score
        bestSection = section.heading
      }
    }

    const section = bestScore > 0 ? bestSection! : sections[0]?.heading ?? "Untitled"
    if (!map.has(section)) map.set(section, [])
    map.get(section)!.push(finding)
  }

  return map
}

async function computeConfidenceNode(
  _config: RuntimeConfig,
  state: ResearchState,
): Promise<ResearchState> {
  // Only compute for final states (approved, approved_with_caveats, failed)
  if (state.status !== "approved" && state.status !== "failed") {
    return researchStateSchema.parse(state)
  }

  const sections = extractSections(state.draft)
  const sectionFindings = mapFindingsToSections(sections, state.unresolvedFindings)

  const sectionResults = sections.map((section) => {
    const findings = sectionFindings.get(section.heading) ?? []
    let confidence = 0.95

    for (const f of findings) {
      const severityWeight: Record<string, number> = { blocker: 0.30, major: 0.15, minor: 0.05 }
      const weight = severityWeight[f.severity] ?? 0.05
      const multiplier = getRebuttalMultiplier(f.findingId, state.rebuttalResponseHistory)
      confidence -= weight * multiplier
    }

    confidence = Math.max(0.0, Math.min(0.95, confidence))

    // If all findings were minor and withdrawn, restore to near-clean
    if (findings.length > 0 && findings.every((f) =>
      f.severity === "minor" && getRebuttalMultiplier(f.findingId, state.rebuttalResponseHistory) === 0,
    )) {
      confidence = 0.95
    }

    const caveat = confidence < 0.70
      ? findings.map((f) => f.issue).join("; ").slice(0, 200)
      : undefined

    return {
      heading: section.heading,
      confidence: Math.round(confidence * 100) / 100,
      findings: findings.length,
      caveat,
    }
  })

  const overall = sectionResults.reduce((sum, s) => sum + s.confidence, 0) / Math.max(1, sectionResults.length)

  const confidence = {
    overall: Math.round(overall * 100) / 100,
    sections: sectionResults,
  }

  if (state.outputPath) {
    await writeRunJsonArtifact(state.outputPath, "confidence.json", confidence)
  }

  return researchStateSchema.parse({ ...state, confidence })
}

// ── End confidence scoring ──

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

async function reviseDraft(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  state: ResearchState,
  telemetry?: GraphTelemetry,
  observer?: RunObserver,
) {
  assertStatus(state, "revising", "reviseDraft")
  if (!state.outputPath) throw new Error("Missing outputPath during reviseDraft")

  await ensureRunDirPath(state.outputPath)

  const session = await createSession(config, `research-drafter:${state.requestId}:revise:${state.round}`)
  observeSession(observer, { sessionID: session.id, role: "drafter", requestId: state.requestId })

  // Write unresolved findings to a temp JSON file for attachment
  const findingsFile = `${state.outputPath}/unresolved-findings-round-${state.round}.json`
  await writeRunJsonArtifact(state.outputPath, `unresolved-findings-round-${state.round}.json`, state.unresolvedFindings)
  const draftFile = `${state.outputPath}/draft-round-${state.round}.md`
  const nextRound = state.round + 1
  const outputFile = `${state.outputPath}/draft-round-${nextRound}.md`

  const response = await promptAgent({
    config,
    sessionID: session.id,
    agent: config.quorumConfig.designatedDrafter,
    prompt: revisionPrompt(config, promptBundle, state, outputFile),
    outputFile,
    inputFiles: [
      { path: draftFile, mime: "text/plain", filename: "draft.md" },
      { path: findingsFile, mime: "text/plain", filename: "findings.json" },
    ],
    telemetry: graphAgentTelemetry({
      telemetry,
      state,
      name: "agent.reviseDraft",
      agentName: config.quorumConfig.designatedDrafter,
      sessionId: session.id,
      input: {
        requestId: state.requestId,
        round: state.round,
        unresolvedFindings: state.unresolvedFindings.length,
      },
    }),
  })

  const nextState = researchStateSchema.parse({
    ...state,
    draft: response.text ?? state.draft,
    audits: [],
    activeRebuttals: {},
    currentRebuttalResponsesByFinding: {},
    approvedAgents: [],
    round: nextRound,
    status: "auditing",
    failureReason: undefined,
  })

  return nextState
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

// ---------------------------------------------------------------------------
// Design quorum nodes (flattened into the main graph)
// ---------------------------------------------------------------------------

async function designHtmlNode(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  state: ResearchState,
  telemetry?: GraphTelemetry,
  observer?: RunObserver,
) {
  if (!state.outputPath) throw new Error("Missing outputPath during designHtml")
  if (!config.quorumConfig.designQuorum?.enabled) return researchStateSchema.parse(state)

  const draftPath = `${state.outputPath}/latest-draft.md`
  if (!(await Bun.file(draftPath).exists())) {
    // Fall back to final.md if latest-draft doesn't exist
    const finalPath = `${state.outputPath}/final.md`
    if (await Bun.file(finalPath).exists()) {
      await Bun.write(draftPath, await Bun.file(finalPath).text())
    } else {
      await Bun.write(draftPath, state.draft)
    }
  }

  const topic = state.inputMode === "topic"
    ? state.topic ?? ""
    : state.documentText ?? state.documentPath ?? ""

  const htmlFile = `${state.outputPath}/design-html-round-${state.designRound ?? 0}.html`

  const html = await designHtml(config, promptBundle, draftPath, topic, htmlFile,
    telemetry ? { run: telemetry.run, parentObservation: telemetry.currentNode, trackSessionObservation: telemetry.trackSessionObservation, trackAgentMetadata: telemetry.trackAgentMetadata } : undefined,
    observer,
  )

  return researchStateSchema.parse({
    ...state,
    designHtml: html,
    designStatus: "running" as const,
    designRound: 0,
  })
}

async function interactiveEnhanceNode(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  state: ResearchState,
  telemetry?: GraphTelemetry,
  observer?: RunObserver,
) {
  if (!state.outputPath) throw new Error("Missing outputPath during interactiveEnhance")
  if (!config.quorumConfig.designQuorum?.enabled) return researchStateSchema.parse(state)

  const round = state.designRound ?? 0
  const htmlFile = `${state.outputPath}/design-html-round-${round}.html`

  const session = await createSession(config, `interactive-enhancer:${state.requestId}:round:${round}`)
  observeSession(observer, { sessionID: session.id, role: "interactive-enhancer", requestId: state.requestId })

  // Prompt the enhancer to edit the HTML file directly
  await promptAgent({
    config,
    sessionID: session.id,
    agent: "interactive-enhancer",
    prompt: (promptBundle.assets.enhanceDesign as string).replace("{outputFile}", htmlFile),
    outputFile: htmlFile,
    inputFiles: [
      { path: htmlFile, mime: "text/plain", filename: "document.html" },
    ],
    telemetry: graphAgentTelemetry({
      telemetry,
      state,
      name: "agent.interactiveEnhance",
      agentName: "interactive-enhancer",
      sessionId: "",
    }),
  })

  return researchStateSchema.parse({ ...state })
}

async function runDesignAuditsNode(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  state: ResearchState,
  telemetry?: GraphTelemetry,
  observer?: RunObserver,
) {
  if (!state.outputPath) throw new Error("Missing outputPath during runDesignAudits")
  if (!config.quorumConfig.designQuorum?.enabled) return researchStateSchema.parse(state)

  const round = state.designRound ?? 0
  const htmlFile = `${state.outputPath}/design-html-round-${round}.html`

  const audits = await runDesignAudits(config, promptBundle, htmlFile, state.outputPath, round,
    telemetry ? { run: telemetry.run, parentObservation: telemetry.currentNode, trackSessionObservation: telemetry.trackSessionObservation, trackAgentMetadata: telemetry.trackAgentMetadata } : undefined,
    observer,
  )

  // Persist audits
  await writeRunJsonArtifact(state.outputPath, `design-audits-round-${round}.json`, audits)

  return researchStateSchema.parse({ ...state })
}

async function aggregateDesignFindingsNode(
  config: RuntimeConfig,
  _promptBundle: PromptBundle,
  state: ResearchState,
  _telemetry?: GraphTelemetry,
  _observer?: RunObserver,
) {
  if (!state.outputPath) throw new Error("Missing outputPath during aggregateDesignFindings")
  if (!config.quorumConfig.designQuorum?.enabled) return researchStateSchema.parse(state)

  const round = state.designRound ?? 0

  // Read audits from disk
  const auditsFile = Bun.file(`${state.outputPath}/design-audits-round-${round}.json`)
  const audits = (await auditsFile.exists()) ? await auditsFile.json() as any[] : []

  const consensus = aggregateDesignConsensus(config, audits, undefined, round)

  // Persist consensus
  await writeRunJsonArtifact(state.outputPath, `design-consensus-round-${round}.json`, {
    outcome: consensus.outcome,
    approvedAgents: consensus.approvedAgents,
    unresolvedFindings: consensus.unresolved,
    failureReason: consensus.failureReason,
  })

  return researchStateSchema.parse({
    ...state,
    designStatus: consensus.outcome === "approved" ? "approved" as const
      : consensus.outcome === "failed_non_convergent" ? "failed" as const
      : "running" as const,
  })
}

async function finalizeDesignNode(
  _config: RuntimeConfig,
  _promptBundle: PromptBundle,
  state: ResearchState,
  _telemetry?: GraphTelemetry,
  _observer?: RunObserver,
) {
  if (!state.outputPath) throw new Error("Missing outputPath during finalizeDesign")
  if (!_config.quorumConfig.designQuorum?.enabled) return researchStateSchema.parse(state)

  // Write the approved (or best-effort) design HTML as final.html.
  // state.designHtml holds the latest HTML the auditors reviewed; fall back to
  // the on-disk round file if it's empty for any reason.
  let html = state.designHtml ?? ""
  if (!html) {
    const round = state.designRound ?? 0
    const fallback = Bun.file(`${state.outputPath}/design-html-round-${round}.html`)
    if (await fallback.exists()) {
      html = await fallback.text()
    }
  }

  if (html) {
    await writeDesignHtmlArtifact(state.outputPath, html)
  }

  return researchStateSchema.parse(state)
}

async function reviseDesignHtmlNode(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  state: ResearchState,
  telemetry?: GraphTelemetry,
  observer?: RunObserver,
) {
  if (!state.outputPath) throw new Error("Missing outputPath during reviseDesignHtml")
  if (!config.quorumConfig.designQuorum?.enabled) return researchStateSchema.parse(state)

  const round = state.designRound ?? 0
  const nextRound = round + 1
  const htmlFile = `${state.outputPath}/design-html-round-${round}.html`
  const nextHtmlFile = `${state.outputPath}/design-html-round-${nextRound}.html`

  // Read unresolved findings from the consensus file
  const consensusFile = Bun.file(`${state.outputPath}/design-consensus-round-${round}.json`)
  const consensus = (await consensusFile.exists()) ? await consensusFile.json() as any : { unresolvedFindings: [] }
  const findings = consensus.unresolvedFindings ?? []

  const html = await reviseDesignHtml(config, promptBundle, htmlFile, findings, nextHtmlFile, state.outputPath, round,
    telemetry ? { run: telemetry.run, parentObservation: telemetry.currentNode, trackSessionObservation: telemetry.trackSessionObservation, trackAgentMetadata: telemetry.trackAgentMetadata } : undefined,
    observer,
  )

  return researchStateSchema.parse({
    ...state,
    designHtml: html,
    designRound: nextRound,
  })
}

export function routeAfterDesignAggregate(config: RuntimeConfig, state: ResearchState): string {
  const designQuorum = config.quorumConfig.designQuorum
  if (!designQuorum?.enabled) return "__end__"

  // Approved, failed, or rounds exhausted → finalize the design (write final.html)
  // before ending. Otherwise loop back to revise.
  if (state.designStatus === "approved") return "finalizeDesign"
  if (state.designStatus === "failed") return "finalizeDesign"
  if ((state.designRound ?? 0) >= designQuorum.maxRounds) return "finalizeDesign"

  return "reviseDesignHtml"
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

export function routeAfterSummarize(config: RuntimeConfig, state: ResearchState) {
  if (state.status === "approved" && config.quorumConfig.designQuorum?.enabled) {
    return "runDesignHtml"
  }
  return "__end__"
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
      // Pass result state to onNodeEnd if it's a valid state; otherwise pass input
      const endState = researchStateSchema.safeParse(result).success
        ? (result as ResearchState)
        : state
      return observeNodeResult(observer, node, endState, result)
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
    .addNode("discoverReaderPrompt", async (state) =>
      withNodeTelemetry("discoverReaderPrompt", state, () =>
        discoverReaderPrompt(config, promptBundle, state, graphTelemetry, observer),
      ),
    )
    .addNode("discoverReaderResume", async (state) =>
      withNodeTelemetry("discoverReaderResume", state, () =>
        discoverReaderResume(config, state),
      ),
    )
    .addNode("draftFullDraft", async (state) =>
      withNodeTelemetry("draftFullDraft", state, () =>
        draftFullDraft(config, promptBundle, state, graphTelemetry, observer),
      ),
    )
    .addNode("runParallelAudits", async (state) =>
      withNodeTelemetry("runParallelAudits", state, () =>
        runParallelAudits(config, promptBundle, state, graphTelemetry, observer),
      ),
    )
    .addNode("reviewFindingsByDrafter", async (state) =>
      withNodeTelemetry("reviewFindingsByDrafter", state, () =>
        reviewFindingsByDrafter(config, promptBundle, state, graphTelemetry, observer),
      ),
    )
    .addNode("runTargetedRebuttals", async (state) =>
      withNodeTelemetry("runTargetedRebuttals", state, () =>
        runTargetedRebuttals(config, promptBundle, state, graphTelemetry, observer),
      ),
    )
    .addNode("reviewRebuttalResponses", async (state) =>
      withNodeTelemetry("reviewRebuttalResponses", state, () =>
        reviewRebuttalResponses(config, promptBundle, state, graphTelemetry, observer),
      ),
    )
    .addNode("aggregateConsensus", async (state) =>
      withNodeTelemetry("aggregateConsensus", state, () => aggregateConsensus(config, state)),
    )
    .addNode("computeConfidence", async (state) =>
      withNodeTelemetry("computeConfidence", state, () => computeConfidenceNode(config, state)),
    )
    .addNode("reviseDraft", async (state) =>
      withNodeTelemetry("reviseDraft", state, () => reviseDraft(config, promptBundle, state, graphTelemetry, observer)),
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
    .addNode("runDesignHtml", async (state) =>
      withNodeTelemetry("runDesignHtml", state, () =>
        designHtmlNode(config, promptBundle, state, graphTelemetry, observer),
      ),
    )
    .addNode("interactiveEnhance", async (state) =>
      withNodeTelemetry("interactiveEnhance", state, () =>
        interactiveEnhanceNode(config, promptBundle, state, graphTelemetry, observer),
      ),
    )
    .addNode("runDesignAudits", async (state) =>
      withNodeTelemetry("runDesignAudits", state, () =>
        runDesignAuditsNode(config, promptBundle, state, graphTelemetry, observer),
      ),
    )
    .addNode("aggregateDesignFindings", async (state) =>
      withNodeTelemetry("aggregateDesignFindings", state, () =>
        aggregateDesignFindingsNode(config, promptBundle, state, graphTelemetry, observer),
      ),
    )
    .addNode("reviseDesignHtml", async (state) =>
      withNodeTelemetry("reviseDesignHtml", state, () =>
        reviseDesignHtmlNode(config, promptBundle, state, graphTelemetry, observer),
      ),
    )
    .addNode("finalizeDesign", async (state) =>
      withNodeTelemetry("finalizeDesign", state, () =>
        finalizeDesignNode(config, promptBundle, state, graphTelemetry, observer),
      ),
    )
    .addEdge(START, "ingestRequest")
    .addEdge("ingestRequest", "summarizeInputDocument")
    .addEdge("summarizeInputDocument", "prepareOutputPath")
    .addEdge("prepareOutputPath", "discoverReaderPrompt")
    .addConditionalEdges("discoverReaderPrompt", (state) => routeAfterReaderPrompt(state), [
      "discoverReaderResume",
      "draftFullDraft",
    ])
    .addEdge("discoverReaderResume", "discoverReaderPrompt")
    .addEdge("draftFullDraft", "runParallelAudits")
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
    .addEdge("aggregateConsensus", "computeConfidence")
    .addConditionalEdges("computeConfidence", routeAfterAggregate, [
      "finalizeApprovedDraft",
      "reviseDraft",
      "finalizeFailedRun",
    ])
    .addEdge("reviseDraft", "runParallelAudits")
    .addEdge("finalizeApprovedDraft", "summarizeOutputArtifact")
    .addEdge("finalizeFailedRun", "summarizeOutputArtifact")
    .addConditionalEdges("summarizeOutputArtifact", (state) => routeAfterSummarize(config, state), [
      "runDesignHtml",
      "__end__",
    ])
    .addEdge("runDesignHtml", "interactiveEnhance")
    .addEdge("interactiveEnhance", "runDesignAudits")
    .addEdge("runDesignAudits", "aggregateDesignFindings")
    .addConditionalEdges("aggregateDesignFindings", (state) => routeAfterDesignAggregate(config, state), [
      "reviseDesignHtml",
      "finalizeDesign",
    ])
    .addEdge("reviseDesignHtml", "runDesignAudits")
    .addEdge("finalizeDesign", "__end__")
    .compile({
      checkpointer: new BunSqliteSaver(config.env.QUORUM_CHECKPOINT_PATH),
      name: "research-quorum",
    })
}
