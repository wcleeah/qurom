import type { AggregatedFindings, AuditRecord } from "./types"

export type RebuttalTurnArtifacts = {
  turn: number
  responses?: string
  drafterReview?: string
  perAgentResponses: string[]
}

export type RoundArtifacts = {
  round: number
  draft?: string
  audits?: string
  perAgentAudits: string[]
  review?: string
  rebuttalTurns: RebuttalTurnArtifacts[]
  disputed?: string
  perAgentRebuttalInputs: string[]
  consensus?: string
  unresolved?: string
}

export type RunArtifactIndex = {
  rounds: RoundArtifacts[]
  maxRound: number
  unclassified: string[]
}

const ROUND_FILE_PATTERNS = [
  /^draft-round-(\d+)\.md$/,
  /^audits-round-(\d+)\.json$/,
  /^audit-[\w-]+-round-(\d+)\.json$/,
  /^drafter-finding-review-round-(\d+)\.json$/,
  /^auditor-rebuttal-responses-round-(\d+)-turn-(\d+)\.json$/,
  /^drafter-rebuttal-review-round-(\d+)-turn-(\d+)\.json$/,
  /^auditor-rebuttal-responses-[\w-]+-round-(\d+)\.json$/,
  /^rebuttals-[\w-]+-round-(\d+)\.json$/,
  /^disputed-round-(\d+)\.json$/,
  /^aggregated-findings-round-(\d+)\.json$/,
  /^unresolved-findings-round-(\d+)\.json$/,
] as const

function roundFromFile(filename: string): number | undefined {
  for (const pattern of ROUND_FILE_PATTERNS) {
    const match = filename.match(pattern)
    if (match?.[1] !== undefined) return parseInt(match[1], 10)
  }
  return undefined
}

function ensureRound(map: Map<number, RoundArtifacts>, round: number): RoundArtifacts {
  let entry = map.get(round)
  if (!entry) {
    entry = {
      round,
      perAgentAudits: [],
      rebuttalTurns: [],
      perAgentRebuttalInputs: [],
    }
    map.set(round, entry)
  }
  return entry
}

function ensureRebuttalTurn(round: RoundArtifacts, turn: number): RebuttalTurnArtifacts {
  let entry = round.rebuttalTurns.find((t) => t.turn === turn)
  if (!entry) {
    entry = { turn, perAgentResponses: [] }
    round.rebuttalTurns.push(entry)
  }
  return entry
}

export function indexRunArtifacts(files: string[]): RunArtifactIndex {
  const roundMap = new Map<number, RoundArtifacts>()
  const classified = new Set<string>()

  for (const file of files) {
    const round = roundFromFile(file)
    if (round === undefined) continue

    const entry = ensureRound(roundMap, round)
    classified.add(file)

    if (/^draft-round-\d+\.md$/.test(file)) {
      entry.draft = file
    } else if (/^audits-round-\d+\.json$/.test(file)) {
      entry.audits = file
    } else if (/^audit-[\w-]+-round-\d+\.json$/.test(file)) {
      entry.perAgentAudits.push(file)
    } else if (/^drafter-finding-review-round-\d+\.json$/.test(file)) {
      entry.review = file
    } else if (/^auditor-rebuttal-responses-round-(\d+)-turn-(\d+)\.json$/.test(file)) {
      const turnMatch = file.match(/turn-(\d+)/)
      const turn = turnMatch ? parseInt(turnMatch[1], 10) : 1
      ensureRebuttalTurn(entry, turn).responses = file
    } else if (/^drafter-rebuttal-review-round-(\d+)-turn-(\d+)\.json$/.test(file)) {
      const turnMatch = file.match(/turn-(\d+)/)
      const turn = turnMatch ? parseInt(turnMatch[1], 10) : 1
      ensureRebuttalTurn(entry, turn).drafterReview = file
    } else if (/^auditor-rebuttal-responses-[\w-]+-round-\d+\.json$/.test(file)) {
      ensureRebuttalTurn(entry, 1).perAgentResponses.push(file)
    } else if (/^rebuttals-[\w-]+-round-\d+\.json$/.test(file)) {
      entry.perAgentRebuttalInputs.push(file)
    } else if (/^disputed-round-\d+\.json$/.test(file)) {
      entry.disputed = file
    } else if (/^aggregated-findings-round-\d+\.json$/.test(file)) {
      entry.consensus = file
    } else if (/^unresolved-findings-round-\d+\.json$/.test(file)) {
      entry.unresolved = file
    }
  }

  for (const round of roundMap.values()) {
    round.rebuttalTurns.sort((a, b) => a.turn - b.turn)
    round.perAgentAudits.sort()
    round.perAgentRebuttalInputs.sort()
  }

  const rounds = [...roundMap.values()].sort((a, b) => a.round - b.round)
  const maxRound = rounds.length > 0 ? Math.max(...rounds.map((r) => r.round)) : -1
  const unclassified = files.filter((f) => !classified.has(f))

  return { rounds, maxRound, unclassified }
}

export type AuditRoundSummary = {
  auditorCount: number
  totalFindings: number
  findingsBySeverity: Record<string, number>
  votes: Record<string, string>
}

export function summarizeAuditRoundData(data: unknown): AuditRoundSummary {
  const audits = data as AuditRecord[]
  const summary: AuditRoundSummary = {
    auditorCount: 0,
    totalFindings: 0,
    findingsBySeverity: {},
    votes: {},
  }
  if (!Array.isArray(audits)) return summary

  summary.auditorCount = audits.length
  for (const audit of audits) {
    summary.votes[audit.agent] = audit.vote
    for (const finding of audit.findings ?? []) {
      summary.totalFindings++
      summary.findingsBySeverity[finding.severity] = (summary.findingsBySeverity[finding.severity] ?? 0) + 1
    }
  }
  return summary
}

export type ConsensusSummary = {
  outcome?: string
  unresolvedCount: number
  approvedAgentCount: number
}

export function summarizeConsensusData(data: unknown): ConsensusSummary {
  const d = data as AggregatedFindings
  if (!d || typeof d !== "object") {
    return { unresolvedCount: 0, approvedAgentCount: 0 }
  }
  return {
    outcome: d.outcome,
    unresolvedCount: d.unresolvedFindings?.length ?? 0,
    approvedAgentCount: d.approvedAgents?.length ?? 0,
  }
}

export function outcomeClassForRound(outcome?: string): string {
  if (outcome === "approved" || outcome === "approved_with_caveats") return "badge-approved"
  if (outcome === "failed_non_convergent") return "badge-failed"
  if (outcome === "needs_revision") return "badge-running"
  return "badge-running"
}

export function outcomeLabelForRound(outcome?: string): string {
  if (!outcome) return "in progress"
  if (outcome === "approved") return "approved"
  if (outcome === "approved_with_caveats") return "approved (caveats)"
  if (outcome === "needs_revision") return "needs revision"
  if (outcome === "failed_non_convergent") return "failed"
  return outcome
}

export function roundHasRebuttals(round: RoundArtifacts): boolean {
  return round.rebuttalTurns.length > 0 || round.perAgentRebuttalInputs.length > 0
}

export function roundHasRebuttalActivity(round: RoundArtifacts): boolean {
  return round.perAgentRebuttalInputs.length > 0
    || round.rebuttalTurns.some((t) => t.responses || t.drafterReview)
}

export function maxRebuttalTurn(round: RoundArtifacts): number {
  if (round.rebuttalTurns.length === 0) return 0
  return Math.max(...round.rebuttalTurns.map((t) => t.turn))
}
