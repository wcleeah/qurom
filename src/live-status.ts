import { writeFile, unlink } from "node:fs/promises"
import { join } from "node:path"
import type { EventBus } from "./runner"
import type { DebugLog } from "./debug-log"
import { addUsage, emptyUsage, type UsageTotals, usageDelta } from "./usage"

export type { UsageTotals }

export interface ToolCallEntry {
  tool: string
  status: "running" | "completed" | "error"
  callID: string
  startedAt: number
  completedAt?: number
  inputSummary?: string
  outputSummary?: string
  error?: string
}

export interface LiveAgentStatus {
  status: "idle" | "running" | "complete" | "error"
  tool?: string
  tokensIn: number
  tokensOut: number
  usageAvailable: boolean
  toolCalls: ToolCallEntry[]
  reasoning: string
}

export interface AgentUsageSnapshot extends UsageTotals {
  usageAvailable: boolean
}

export interface NodeHistoryEntry {
  node: string
  startedAt: number
  completedAt: number
  status: "completed" | "error"
  error?: string
  round: number
  rebuttalTurn?: number
  researchPhase?: string
  summary?: Record<string, unknown>
  artifacts?: string[]
  durationMs?: number
  usage?: UsageTotals
  usageAvailable?: boolean
  usageByAgent?: Record<string, AgentUsageSnapshot>
}

export interface LiveStatus {
  phase: "running" | "complete" | "error"
  node?: string
  nodeStartedAt?: number
  runStartedAt?: number
  round: number
  maxRounds: number
  researchPhase?: string
  rebuttalTurn?: number
  activeRebuttalCount?: number
  unresolvedFindingCount?: number
  usage: UsageTotals
  usageAvailable: boolean
  nodeUsage: UsageTotals
  nodeUsageAvailable: boolean
  nodeUsageByAgent: Record<string, AgentUsageSnapshot>
  agents: Record<string, LiveAgentStatus>
  nodeHistory: NodeHistoryEntry[]
  error?: string
  awaitingReaderReply?: {
    turn: number
    answeredQuestions: Array<{ question: string; answer: string }>
    newQuestions: string[]
    transcript: { role: string; text: string }[]
    partialProfile?: Record<string, unknown>
  }
}

const WRITE_INTERVAL_MS = 3000
const MAX_TOOL_CALLS_PER_AGENT = 20
const MAX_REASONING_LENGTH = 800

function sumHistoryUsage(history: NodeHistoryEntry[]): { usage: UsageTotals; usageAvailable: boolean } {
  const usage = emptyUsage()
  let usageAvailable = false
  for (const entry of history) {
    if (!entry.usageAvailable || !entry.usage) continue
    usageAvailable = true
    addUsage(usage, entry.usage)
  }
  return { usage, usageAvailable }
}

function earliestHistoryStart(history: NodeHistoryEntry[]): number | undefined {
  if (history.length === 0) return undefined
  return history.reduce((min, entry) => Math.min(min, entry.startedAt), history[0]!.startedAt)
}

export function createLiveStatusWriter(
  bus: EventBus,
  runDir: string | (() => string | undefined),
  config: { maxRounds: number; initialNodeHistory?: NodeHistoryEntry[] },
  _debugLog?: DebugLog,
): { dispose: () => void; setAwaitingReaderReply: (value: LiveStatus["awaitingReaderReply"]) => void } {
  const initialHistory = config.initialNodeHistory ?? []
  const initialRunUsage = sumHistoryUsage(initialHistory)
  const status: LiveStatus = {
    phase: "running",
    round: 0,
    maxRounds: config.maxRounds,
    runStartedAt: earliestHistoryStart(initialHistory) ?? Date.now(),
    usage: initialRunUsage.usage,
    usageAvailable: initialRunUsage.usageAvailable,
    nodeUsage: emptyUsage(),
    nodeUsageAvailable: false,
    nodeUsageByAgent: {},
    agents: {},
    nodeHistory: initialHistory,
  }

  const sessionAgent = new Map<string, LiveAgentStatus>()
  const sessionRoles = new Map<string, string>()
  const toolCallMap = new Map<string, ToolCallEntry>()
  const messageUsageTotals = new Map<string, UsageTotals>()
  const cursorRunUsageTotals = new Map<string, UsageTotals>()

  const interval = setInterval(writeStatus, WRITE_INTERVAL_MS)
  let disposed = false
  let writeQueue: Promise<void> = Promise.resolve()

  function scheduleWriteStatus() {
    writeQueue = writeQueue.then(() => writeStatus()).catch(() => {})
  }

  function resolveDir(): string | undefined {
    return typeof runDir === "function" ? runDir() : runDir
  }

  function setAwaitingReaderReply(value: LiveStatus["awaitingReaderReply"]) {
    status.awaitingReaderReply = value
    scheduleWriteStatus()
  }

  function resetNodeUsageTracking() {
    status.nodeUsage = emptyUsage()
    status.nodeUsageAvailable = false
    status.nodeUsageByAgent = {}
    messageUsageTotals.clear()
    cursorRunUsageTotals.clear()
  }

  function ensureNodeAgentUsage(role: string): AgentUsageSnapshot {
    const existing = status.nodeUsageByAgent[role]
    if (existing) return existing
    const created: AgentUsageSnapshot = { ...emptyUsage(), usageAvailable: false }
    status.nodeUsageByAgent[role] = created
    return created
  }

  function applyUsageDelta(delta: UsageTotals, sessionID: string) {
    if (delta.tokensIn === 0 && delta.tokensOut === 0) return

    status.usageAvailable = true
    status.nodeUsageAvailable = true
    addUsage(status.usage, delta)
    addUsage(status.nodeUsage, delta)

    const agent = sessionAgent.get(sessionID)
    if (agent) {
      addUsage(agent, delta)
      agent.usageAvailable = true
    }

    const role = sessionRoles.get(sessionID)
    if (role) {
      const nodeAgent = ensureNodeAgentUsage(role)
      addUsage(nodeAgent, delta)
      nodeAgent.usageAvailable = true
    }
  }

  async function writeStatus() {
    if (disposed) return
    const dir = resolveDir()
    if (!dir) return
    try {
      await writeFile(join(dir, "live-status.json"), JSON.stringify(status))
    } catch {
      // Silently ignore write failures
    }
  }

  async function writeRunStatusSnapshot() {
    if (disposed) return
    const dir = resolveDir()
    if (!dir) return
    try {
      const snapshot = { ...status, phase: status.phase, agents: {} }
      await writeFile(join(dir, "run-status.json"), JSON.stringify(snapshot))
    } catch {
      // Silently ignore write failures
    }
  }

  async function deleteStatus() {
    if (disposed || !resolveDir()) return
    try {
      await unlink(join(resolveDir()!, "live-status.json"))
    } catch {
      // File may not exist — that's fine
    }
  }

  async function writeNodeHistory() {
    if (disposed) return
    const dir = resolveDir()
    if (!dir) return
    try {
      await writeFile(join(dir, "node-history.json"), JSON.stringify(status.nodeHistory))
    } catch {
      // Silently ignore write failures
    }
  }

  const off = bus.on((event) => {
    switch (event.kind) {
      case "lifecycle": {
        if (event.phase === "running") {
          status.phase = "running"
          status.maxRounds = config.maxRounds
          if (!status.runStartedAt) status.runStartedAt = Date.now()
        } else if (event.phase === "complete") {
          status.phase = "complete"
          clearInterval(interval)
          void writeRunStatusSnapshot()
          void deleteStatus()
        } else if (event.phase === "error") {
          status.phase = "error"
          status.error = event.error instanceof Error ? event.error.message : String(event.error ?? "")
          clearInterval(interval)
          void writeRunStatusSnapshot()
          void deleteStatus()
        }
        break
      }
      case "graph.node": {
        if (event.phase === "start") {
          status.node = event.node
          status.nodeStartedAt = Date.now()
          status.agents = {}
          sessionAgent.clear()
          resetNodeUsageTracking()
          if (event.state && typeof event.state === "object") {
            const s = event.state as Record<string, unknown>
            if (typeof s.round === "number") status.round = s.round
            if (typeof s.status === "string") status.researchPhase = s.status
            if (s.rebuttalTurnCounts && typeof s.rebuttalTurnCounts === "object") {
              const counts = s.rebuttalTurnCounts as Record<string, number>
              const turns = Object.values(counts)
              status.rebuttalTurn = turns.length > 0 ? Math.max(...turns) : undefined
            }
            if (s.activeRebuttals && typeof s.activeRebuttals === "object") {
              status.activeRebuttalCount = Object.keys(s.activeRebuttals as object).length
            }
            if (Array.isArray(s.unresolvedFindings)) {
              status.unresolvedFindingCount = s.unresolvedFindings.length
            }
          }
        } else if (event.phase === "end") {
          const s = event.state as Record<string, unknown> | undefined
          const startedAt = status.nodeStartedAt ?? Date.now()
          const completedAt = Date.now()
          const entry: NodeHistoryEntry = {
            node: event.node,
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            status: s?.status === "failed" || s?.failureReason ? "error" : "completed",
            round: status.round,
            researchPhase: typeof s?.status === "string" ? s.status : status.researchPhase,
            rebuttalTurn: status.rebuttalTurn,
            summary: summarizeNodeState(event.node, event.state),
            usage: { ...status.nodeUsage },
            usageAvailable: status.nodeUsageAvailable,
            usageByAgent: Object.fromEntries(
              Object.entries(status.nodeUsageByAgent).map(([role, usage]) => [role, { ...usage }]),
            ),
          }
          status.nodeHistory.push(entry)
          void writeNodeHistory()
          scheduleWriteStatus()
        }
        break
      }
      case "design.phase": {
        const nodeMap: Record<string, string> = {
          drafting: "runDesignHtml",
          enhancing: "interactiveEnhance",
          finalizing: "finalizeDesign",
        }
        status.node = nodeMap[event.phase] ?? `runDesignHtml`
        status.nodeStartedAt = Date.now()
        status.agents = {}
        sessionAgent.clear()
        resetNodeUsageTracking()
        status.round = event.round
        break
      }
      case "session.created": {
        if (event.role === "root") break
        sessionRoles.set(event.sessionID, event.role)
        const agent: LiveAgentStatus = {
          status: "idle",
          tokensIn: 0,
          tokensOut: 0,
          usageAvailable: false,
          toolCalls: [],
          reasoning: "",
        }
        status.agents[event.role] = agent
        sessionAgent.set(event.sessionID, agent)
        break
      }
      case "session.status": {
        const agent = sessionAgent.get(event.sessionID)
        if (!agent) break
        const mapped = event.status === "completed" ? "complete"
          : event.status === "idle" ? "idle"
          : event.status === "error" ? "error"
          : "running"
        agent.status = mapped
        break
      }
      case "agent.usage": {
        const next = { tokensIn: event.tokensIn, tokensOut: event.tokensOut }
        let delta = next
        if (event.cumulative) {
          const key = event.runID ?? `${event.sessionID}:cumulative`
          const previous = cursorRunUsageTotals.get(key) ?? emptyUsage()
          delta = usageDelta(previous, next)
          cursorRunUsageTotals.set(key, next)
        } else if (event.messageID) {
          const previous = messageUsageTotals.get(event.messageID) ?? emptyUsage()
          delta = usageDelta(previous, next)
          messageUsageTotals.set(event.messageID, next)
        }
        applyUsageDelta(delta, event.sessionID)
        scheduleWriteStatus()
        break
      }
      case "agent.tool": {
        const agent = sessionAgent.get(event.sessionID)
        if (!agent) break
        if (event.status === "running") {
          agent.tool = event.tool
          const entry: ToolCallEntry = {
            tool: event.tool,
            status: "running",
            callID: event.callID,
            startedAt: Date.now(),
            inputSummary: summarizeToolInput(event.tool, event.input),
          }
          agent.toolCalls.push(entry)
          if (agent.toolCalls.length > MAX_TOOL_CALLS_PER_AGENT) {
            agent.toolCalls = agent.toolCalls.slice(-MAX_TOOL_CALLS_PER_AGENT)
          }
          toolCallMap.set(event.callID, entry)
        } else {
          agent.tool = undefined
          const entry = toolCallMap.get(event.callID)
          if (entry) {
            entry.status = event.status === "completed" ? "completed" : "error"
            entry.completedAt = Date.now()
            if (event.status === "completed") {
              entry.outputSummary = summarizeToolOutput(event.tool, event.output)
            } else if (event.error) {
              entry.error = event.error
            }
            toolCallMap.delete(event.callID)
          }
        }
        break
      }
      case "agent.reasoning": {
        const agent = sessionAgent.get(event.sessionID)
        if (!agent) break
        agent.reasoning = event.text.slice(-MAX_REASONING_LENGTH)
        break
      }
      case "agent.metadata": {
        break
      }
    }
  })

  function dispose() {
    disposed = true
    off()
    clearInterval(interval)
    void deleteStatus()
  }

  scheduleWriteStatus()

  return { dispose, setAwaitingReaderReply }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeToolInput(_tool: string, input: unknown): string {
  if (!input) return ""
  if (typeof input === "string") return input.slice(0, 100)
  if (typeof input === "object") {
    const obj = input as Record<string, unknown>
    if ("pattern" in obj) return String(obj.pattern).slice(0, 100)
    if ("url" in obj) return `url: ${String(obj.url).slice(0, 100)}`
    if ("file" in obj) return `file: ${String(obj.file).slice(0, 100)}`
    if ("query" in obj) return `query: ${String(obj.query).slice(0, 100)}`
    if ("search" in obj) return `search: ${String(obj.search).slice(0, 100)}`
    if ("command" in obj) return `cmd: ${String(obj.command).slice(0, 100)}`
    const keys = Object.keys(obj).slice(0, 3).join(", ")
    return `{${keys}}`
  }
  return String(input).slice(0, 100)
}

function summarizeToolOutput(_tool: string, output: unknown): string {
  if (!output) return ""
  if (typeof output === "string") return output.slice(0, 200)
  if (Array.isArray(output)) return `${output.length} items`
  if (typeof output === "object") {
    const obj = output as Record<string, unknown>
    if ("length" in obj) return `${obj.length} bytes`
    if ("count" in obj) return `${obj.count} results`
    return `${Object.keys(obj).length} keys`
  }
  return String(output).slice(0, 200)
}

function summarizeNodeState(node: string, state: unknown): Record<string, unknown> | undefined {
  if (!state || typeof state !== "object") return undefined
  const s = state as Record<string, unknown>
  if (node === "discoverReaderPrompt" || node === "discoverReaderResume") {
    const profile = s.readerProfile && typeof s.readerProfile === "object" ? s.readerProfile as Record<string, unknown> : undefined
    const intent = profile?.intent as { goal?: string; depth?: string } | undefined
    return {
      interviewComplete: s.readerInterviewComplete === true,
      goal: typeof intent?.goal === "string" ? intent.goal : undefined,
      depth: typeof intent?.depth === "string" ? intent.depth : undefined,
      gapCount: Array.isArray((profile as { inferredGaps?: unknown[] } | undefined)?.inferredGaps)
        ? ((profile as { inferredGaps: unknown[] }).inferredGaps.length)
        : 0,
      transcriptTurns: Array.isArray(s.interviewTranscript) ? Math.ceil(s.interviewTranscript.length / 2) : 0,
    }
  }
  if (node === "draftFullDraft" || node === "reviseDraft") {
    return {
      round: s.round,
      draftLen: typeof s.draft === "string" ? (s.draft as string).length : 0,
      unresolved: Array.isArray(s.unresolvedFindings) ? s.unresolvedFindings.length : undefined,
    }
  }
  if (node === "runParallelAudits") {
    const audits = Array.isArray(s.audits) ? s.audits as Array<{ findings?: unknown[] }> : []
    const findings = audits.reduce((n, a) => n + (a.findings?.length ?? 0), 0)
    return { round: s.round, auditorCount: audits.length, findingCount: findings }
  }
  if (node === "reviewFindingsByDrafter") {
    const active = s.activeRebuttals && typeof s.activeRebuttals === "object"
      ? Object.keys(s.activeRebuttals as object).length
      : 0
    return { round: s.round, activeRebuttals: active, status: s.status }
  }
  if (node === "runTargetedRebuttals" || node === "reviewRebuttalResponses") {
    const counts = s.rebuttalTurnCounts && typeof s.rebuttalTurnCounts === "object"
      ? Object.values(s.rebuttalTurnCounts as Record<string, number>)
      : []
    return {
      round: s.round,
      rebuttalTurn: counts.length > 0 ? Math.max(...counts) : undefined,
      status: s.status,
    }
  }
  if (node === "aggregateConsensus" || node === "computeConfidence") {
    return {
      status: s.status,
      round: s.round,
      approvedAgents: Array.isArray(s.approvedAgents) ? s.approvedAgents.length : undefined,
      unresolved: Array.isArray(s.unresolvedFindings) ? s.unresolvedFindings.length : undefined,
    }
  }
  return undefined
}
