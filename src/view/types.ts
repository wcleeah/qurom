export type RunStatus = "approved" | "failed" | "running"

export interface RunMeta {
  name: string
  topic: string
  status: RunStatus
  mtime: number
  roundCount: number
  hasFinalHtml: boolean
  hasFinalMd: boolean
  hasLatestDraft: boolean
  fileCount: number
  designStatus: RunStatus | null
  designRoundCount: number
}

export interface RunStats {
  total: number
  approved: number
  failed: number
  running: number
}

export interface RequestJson {
  requestId?: string
  inputMode?: string
  topic?: string
  inputSummary?: { title?: string; summary?: string }
}

export interface LiveAgentStatus {
  status: "idle" | "running" | "complete" | "error"
  tool?: string
  tokensIn: number
  tokensOut: number
  toolCalls: Array<{
    tool: string
    status: "running" | "completed" | "error"
    callID: string
    startedAt: number
    completedAt?: number
    inputSummary?: string
    outputSummary?: string
    error?: string
  }>
  reasoning: string
}

export interface LiveStatus {
  phase: "running" | "complete" | "error"
  node?: string
  nodeStartedAt?: number
  round: number
  maxRounds: number
  agents: Record<string, LiveAgentStatus>
  nodeHistory: Array<{
    node: string
    startedAt: number
    completedAt: number
    status: "completed" | "error"
    error?: string
    round: number
    summary?: Record<string, unknown>
  }>
  error?: string
  awaitingReaderReply?: {
    turn: number
    answeredQuestions: Array<{ question: string; answer: string }>
    newQuestions: string[]
    transcript: { role: string; text: string }[]
  }
}

export interface AuditFinding {
  severity: string
  category: string
  issue: string
  evidence: string[]
  required_fix: string
  findingId: string
  agent?: string
}

export interface AuditRecord {
  agent: string
  vote: string
  summary: string
  findings: AuditFinding[]
}

export interface AggregatedFindings {
  outcome: string
  approvedAgents: string[]
  unresolvedFindings: AuditFinding[]
  failureReason?: string
}

export interface RebuttalEntry {
  findingId: string
  position: string
  argument: string
  evidence: string[]
  requestedResolution: string
}

export interface RebuttalResponseEntry {
  findingId: string
  decision: string
  argument: string
  agent: string
  turn: number
  updatedFinding?: Partial<AuditFinding>
}

export type FileClass = { group: string; subGroup: string; label: string; description: string }

export interface DesignConsensusSummary {
  outcome: string
  round: number
  unresolvedCount: number
  severityBreakdown: Record<string, number>
  hasFinalHtml: boolean
  hasDesignFiles: boolean
  hasFailure: boolean
}
