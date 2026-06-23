import { createStore, type StoreApi } from "zustand/vanilla"
import type { RunnerEvent } from "../../runner"
import type { GraphInput, ResearchState } from "../../schema"

export type AgentStatus = "idle" | "running" | "error" | "complete"

export type AgentState = {
  sessionID?: string
  status: AgentStatus
  lastEventAt: number
  model?: string
  variant?: string
  tool?: string
  tokensIn: number
  tokensOut: number
}

export type LifecyclePhase = "starting" | "running" | "complete" | "error"

export type NodeHistoryEntry = {
  node: string
  startedAt: number
  completedAt: number
  status: "completed" | "error"
  error?: string
}

export type RunStoreState = {
  lifecycle: {
    phase: LifecyclePhase
    requestId?: string
    traceId?: string
    outputDir?: string
    rootSessionID?: string
    error?: unknown
  }
  graph: {
    node?: string
    phase?: "start" | "end"
    state?: ResearchState | GraphInput
    nodeStartedAt?: number
  }
  agents: Record<string, AgentState>
  nodeHistory: NodeHistoryEntry[]
  systemLog: Array<{ text: string; ts: number }>
  result?: unknown
}

export type RunStore = StoreApi<RunStoreState>

function emptyAgent(): AgentState {
  return {
    status: "idle",
    lastEventAt: 0,
    model: undefined,
    tokensIn: 0,
    tokensOut: 0,
  }
}

function deriveStatus(raw: string): AgentStatus {
  if (raw === "error") return "error"
  if (raw === "complete" || raw === "completed") return "complete"
  if (raw === "idle") return "idle"
  return "running"
}

const SYSTEM_LOG_LIMIT = 100

export function reduce(state: RunStoreState, event: RunnerEvent): RunStoreState {
  const ts = Date.now()
  switch (event.kind) {
    case "lifecycle":
      return {
        ...state,
        lifecycle: {
          ...state.lifecycle,
          phase: event.phase,
          requestId: event.requestId,
          traceId: event.traceId,
          outputDir: event.outputDir ?? state.lifecycle.outputDir,
          error: event.error ?? state.lifecycle.error,
        },
      }
    case "graph.node": {
      let nodeHistory = state.nodeHistory
      // When a node ends, record it
      if (event.phase === "end" && state.graph.node) {
        nodeHistory = [
          ...nodeHistory,
          {
            node: state.graph.node,
            startedAt: state.graph.nodeStartedAt ?? ts,
            completedAt: ts,
            status: "completed" as const,
          },
        ]
      }
      return {
        ...state,
        graph: { node: event.node, phase: event.phase, state: event.state, nodeStartedAt: event.phase === "start" ? ts : state.graph.nodeStartedAt },
        nodeHistory,
      }
    }
    case "session.created": {
      if (event.role === "root") {
        return { ...state, lifecycle: { ...state.lifecycle, rootSessionID: event.sessionID } }
      }
      const key = event.role
      const existing = state.agents[key] ?? emptyAgent()
      return {
        ...state,
        agents: {
          ...state.agents,
          [key]: { ...existing, sessionID: event.sessionID, lastEventAt: ts },
        },
      }
    }
    case "session.status": {
      const entry = Object.entries(state.agents).find(([, a]) => a.sessionID === event.sessionID)
      if (!entry) return state
      const [key] = entry
      return {
        ...state,
        agents: {
          ...state.agents,
          [key]: { ...state.agents[key], status: deriveStatus(event.status), lastEventAt: ts },
        },
      }
    }
    case "session.error": {
      const entry = Object.entries(state.agents).find(([, a]) => a.sessionID === event.sessionID)
      if (!entry) return state
      const [key] = entry
      const nextLog = [...state.systemLog, { text: `error: ${event.name}${event.message ? `: ${event.message}` : ""}`, ts }]
      return {
        ...state,
        agents: {
          ...state.agents,
          [key]: { ...state.agents[key], status: "error", lastEventAt: ts },
        },
        systemLog: nextLog.length > SYSTEM_LOG_LIMIT ? nextLog.slice(nextLog.length - SYSTEM_LOG_LIMIT) : nextLog,
      }
    }
    case "agent.metadata": {
      const entry = Object.entries(state.agents).find(([, a]) => a.sessionID === event.sessionID)
      if (!entry) return state
      const [key] = entry
      return {
        ...state,
        agents: {
          ...state.agents,
          [key]: {
            ...state.agents[key],
            model: event.model ?? state.agents[key].model,
            variant: event.variant ?? state.agents[key].variant,
            lastEventAt: ts,
          },
        },
      }
    }
    case "agent.tool": {
      const entry = Object.entries(state.agents).find(([, a]) => a.sessionID === event.sessionID)
      if (!entry) return state
      const [key] = entry
      return {
        ...state,
        agents: {
          ...state.agents,
          [key]: {
            ...state.agents[key],
            tool: event.status === "running" ? event.tool : undefined,
            lastEventAt: ts,
          },
        },
      }
    }
    case "agent.message.start":
    case "agent.reasoning":
    case "agent.message.text":
    case "agent.permission":
    case "agent.permission.replied": {
      // Update lastEventAt for the agent — no scrollback needed
      const entry = Object.entries(state.agents).find(([, a]) => a.sessionID === event.sessionID)
      if (!entry) return state
      const [key] = entry
      return {
        ...state,
        agents: {
          ...state.agents,
          [key]: { ...state.agents[key], lastEventAt: ts },
        },
      }
    }
    case "design.phase":
      // Design phase transitions are recorded in nodeHistory
      return state
    case "result":
      return { ...state, result: event.runResult }
  }
}

export function createRunStore(): RunStore {
  return createStore<RunStoreState>(() => ({
    lifecycle: { phase: "starting" },
    graph: {},
    agents: {},
    nodeHistory: [],
    systemLog: [],
  }))
}
