import { writeFile, unlink } from "node:fs/promises"
import { join } from "node:path"
import type { EventBus } from "./runner"
import type { DebugLog } from "./debug-log"

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
  toolCalls: ToolCallEntry[]
  reasoning: string
}

export interface NodeHistoryEntry {
  node: string
  startedAt: number
  completedAt: number
  status: "completed" | "error"
  error?: string
  round: number
  summary?: Record<string, unknown>
}

export interface LiveStatus {
  phase: "running" | "complete" | "error"
  node?: string
  nodeStartedAt?: number
  round: number
  maxRounds: number
  agents: Record<string, LiveAgentStatus>
  nodeHistory: NodeHistoryEntry[]
  error?: string
  awaitingReaderReply?: {
    turn: number
    answeredQuestions: Array<{ question: string; answer: string }>
    newQuestions: string[]
    transcript: { role: string; text: string }[]
  }
}

const WRITE_INTERVAL_MS = 3000
const MAX_TOOL_CALLS_PER_AGENT = 20
const MAX_REASONING_LENGTH = 800

export function createLiveStatusWriter(
  bus: EventBus,
  runDir: string | (() => string | undefined),
  config: { maxRounds: number },
  _debugLog?: DebugLog,
): { dispose: () => void; setAwaitingReaderReply: (value: LiveStatus["awaitingReaderReply"]) => void } {
  const status: LiveStatus = {
    phase: "running",
    round: 0,
    maxRounds: config.maxRounds,
    agents: {},
    nodeHistory: [],
  }

  // Map sessionID → agent reference for O(1) lookup on status/tool events
  const sessionAgent = new Map<string, LiveAgentStatus>()
  // Track tool calls by callID for completion updates
  const toolCallMap = new Map<string, ToolCallEntry>()

  // Start write interval immediately — the writer is created while the run
  // is already active (after graph invoke begins). Don't wait for a
  // lifecycle:running event that already fired before we subscribed.
  const interval = setInterval(writeStatus, WRITE_INTERVAL_MS)
  let disposed = false

  function resolveDir(): string | undefined {
    return typeof runDir === "function" ? runDir() : runDir
  }

  function setAwaitingReaderReply(value: LiveStatus["awaitingReaderReply"]) {
    status.awaitingReaderReply = value
    void writeStatus()
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
        } else if (event.phase === "complete") {
          status.phase = "complete"
          clearInterval(interval)
          void deleteStatus()
        } else if (event.phase === "error") {
          status.phase = "error"
          status.error = event.error instanceof Error ? event.error.message : String(event.error ?? "")
          clearInterval(interval)
          void deleteStatus()
        }
        break
      }
      case "graph.node": {
        if (event.phase === "start") {
          status.node = event.node
          status.nodeStartedAt = Date.now()
          // Clear agents for new node
          status.agents = {}
          sessionAgent.clear()
          if (event.state && "round" in event.state && typeof event.state.round === "number") {
            status.round = event.state.round
          }
        } else if (event.phase === "end") {
          // Record node completion in history
          const entry: NodeHistoryEntry = {
            node: event.node,
            startedAt: status.nodeStartedAt ?? Date.now(),
            completedAt: Date.now(),
            status: (event.state as any)?.status === "failed" || (event.state as any)?.failureReason ? "error" : "completed",
            round: status.round,
            summary: summarizeNodeState(event.node, event.state),
          }
          status.nodeHistory.push(entry)
          // Persist node history to disk immediately
          void writeNodeHistory()
        }
        break
      }
      case "design.phase": {
        const phaseStr =
          event.phase === "drafting" ? "design: drafting"
          : event.phase === "browser_qa" ? "design: browser QA"
          : `design: ${event.phase} round ${event.round}`
        status.node = phaseStr
        status.nodeStartedAt = Date.now()
        // Clear agents for new design phase
        status.agents = {}
        sessionAgent.clear()
        break
      }
      case "session.created": {
        if (event.role === "root") break
        const agent: LiveAgentStatus = {
          status: "idle",
          tokensIn: 0,
          tokensOut: 0,
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
        // Keep the latest chunk; truncate older text
        agent.reasoning = event.text.slice(-MAX_REASONING_LENGTH)
        break
      }
      case "agent.metadata": {
        // No live-status surface for metadata yet — sessionAgent lookup confirms agent exists
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
    // Pick the most informative field based on tool
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
    const profile = Array.isArray(s.readerProfile) ? s.readerProfile : undefined
    return {
      concepts: profile?.length ?? 0,
      goal: typeof s.learningGoal === "string" ? s.learningGoal : undefined,
      transcriptTurns: Array.isArray(s.interviewTranscript) ? Math.ceil(s.interviewTranscript.length / 2) : 0,
    }
  }
  if (node === "draftFullDraft") {
    return { round: s.round, draftLen: typeof s.draft === "string" ? (s.draft as string).length : 0 }
  }
  if (node === "aggregateConsensus" || node === "computeConfidence") {
    return { status: s.status, round: s.round, approvedAgents: (s as any).approvedAgents?.length }
  }
  return undefined
}
