import { createStore, type StoreApi } from "zustand/vanilla"
import type { RuntimeConfig } from "../../config"
import type { RunnerEvent } from "../../runner"
import type { GraphInput, ResearchState } from "../../schema"

export type ScrollbackKind = "reasoning" | "tool" | "permission" | "system"

export type ScrollbackEntry = {
  kind: ScrollbackKind
  text: string
  ts: number
}

export type AgentStatus = "idle" | "running" | "error" | "complete"

export type AgentState = {
  sessionID?: string
  status: AgentStatus
  lastEventAt: number
  scrollback: ScrollbackEntry[]
  tokensIn: number
  tokensOut: number
  activeTool?: { tool: string; callID: string; startedAt: number }
  pendingPermission?: string
}

export type LifecyclePhase = "starting" | "running" | "complete" | "error"

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
  }
  agents: Record<string, AgentState>
  systemLog: ScrollbackEntry[]
  result?: unknown
}

export type RunStore = StoreApi<RunStoreState>

export type CreateRunStoreInput = {
  config: RuntimeConfig
  initial?: Partial<RunStoreState>
}

const INITIAL_PHASE: LifecyclePhase = "starting"

export function resolveRoleKey(rawRole: string, config: RuntimeConfig): string | undefined {
  if (rawRole === "root") return undefined
  if (rawRole === "drafter") return config.quorumConfig.designatedDrafter
  if (rawRole.startsWith("auditor:")) {
    const name = rawRole.slice("auditor:".length)
    if (config.quorumConfig.auditors.includes(name)) return name
  }
  return undefined
}

function emptyAgent(): AgentState {
  return {
    status: "idle",
    lastEventAt: 0,
    scrollback: [],
    tokensIn: 0,
    tokensOut: 0,
  }
}

export function createInitialState(config: RuntimeConfig, initial?: Partial<RunStoreState>): RunStoreState {
  const agents: Record<string, AgentState> = {}
  agents[config.quorumConfig.designatedDrafter] = emptyAgent()
  for (const auditor of config.quorumConfig.auditors) {
    agents[auditor] = emptyAgent()
  }
  return {
    lifecycle: { phase: INITIAL_PHASE },
    graph: {},
    agents,
    systemLog: [],
    ...initial,
  }
}

function deriveStatus(raw: string): AgentStatus {
  if (raw === "error") return "error"
  if (raw === "complete" || raw === "completed") return "complete"
  if (raw === "idle") return "idle"
  return "running"
}

function appendScrollback(agent: AgentState, entry: ScrollbackEntry): AgentState {
  const next = [...agent.scrollback, entry]
  const trimmed = next.length > SCROLLBACK_LIMIT ? next.slice(next.length - SCROLLBACK_LIMIT) : next
  return { ...agent, scrollback: trimmed, lastEventAt: entry.ts }
}

const SCROLLBACK_LIMIT = 500

function withAgent(state: RunStoreState, key: string, mutate: (agent: AgentState) => AgentState): RunStoreState {
  const existing = state.agents[key] ?? emptyAgent()
  return { ...state, agents: { ...state.agents, [key]: mutate(existing) } }
}

function appendSystem(state: RunStoreState, entry: ScrollbackEntry): RunStoreState {
  const next = [...state.systemLog, entry]
  const trimmed = next.length > SCROLLBACK_LIMIT ? next.slice(next.length - SCROLLBACK_LIMIT) : next
  return { ...state, systemLog: trimmed }
}

export function reduce(state: RunStoreState, event: RunnerEvent, config: RuntimeConfig): RunStoreState {
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
    case "graph.node":
      return { ...state, graph: { node: event.node, phase: event.phase, state: event.state } }
    case "session.created": {
      if (event.role === "root") {
        return { ...state, lifecycle: { ...state.lifecycle, rootSessionID: event.sessionID } }
      }
      const key = resolveRoleKey(event.role, config)
      if (!key) return appendSystem(state, { kind: "system", text: `unmapped role: ${event.role}`, ts })
      return withAgent(state, key, (agent) => ({ ...agent, sessionID: event.sessionID, lastEventAt: ts }))
    }
    case "session.status": {
      const entry = Object.entries(state.agents).find(([, agent]) => agent.sessionID === event.sessionID)
      if (!entry) return state
      const [key] = entry
      return withAgent(state, key, (agent) => ({ ...agent, status: deriveStatus(event.status), lastEventAt: ts }))
    }
    case "session.error": {
      const entry = Object.entries(state.agents).find(([, agent]) => agent.sessionID === event.sessionID)
      if (!entry) return state
      const [key] = entry
      return withAgent(state, key, (agent) =>
        appendScrollback(
          { ...agent, status: "error" },
          { kind: "system", text: `error: ${event.name}${event.message ? `: ${event.message}` : ""}`, ts },
        ),
      )
    }
    case "agent.message.start": {
      const entry = Object.entries(state.agents).find(([, agent]) => agent.sessionID === event.sessionID)
      if (!entry) return state
      const [key] = entry
      return withAgent(state, key, (agent) => appendScrollback(agent, { kind: "system", text: "assistant started", ts }))
    }
    case "agent.reasoning": {
      const entry = Object.entries(state.agents).find(([, agent]) => agent.sessionID === event.sessionID)
      if (!entry) return state
      const [key] = entry
      return withAgent(state, key, (agent) => appendScrollback(agent, { kind: "reasoning", text: event.text, ts }))
    }
    case "agent.tool": {
      const entry = Object.entries(state.agents).find(([, agent]) => agent.sessionID === event.sessionID)
      if (!entry) return state
      const [key] = entry
      if (event.status === "running") {
        return withAgent(state, key, (agent) =>
          appendScrollback(
            { ...agent, activeTool: { tool: event.tool, callID: event.callID, startedAt: ts } },
            { kind: "tool", text: `${event.tool} running`, ts },
          ),
        )
      }
      if (event.status === "completed") {
        return withAgent(state, key, (agent) =>
          appendScrollback({ ...agent, activeTool: undefined }, { kind: "tool", text: `${event.tool} completed`, ts }),
        )
      }
      return withAgent(state, key, (agent) =>
        appendScrollback(
          { ...agent, activeTool: undefined },
          { kind: "tool", text: `${event.tool} failed${event.error ? `: ${event.error}` : ""}`, ts },
        ),
      )
    }
    case "agent.permission": {
      const entry = Object.entries(state.agents).find(([, agent]) => agent.sessionID === event.sessionID)
      if (!entry) return state
      const [key] = entry
      return withAgent(state, key, (agent) =>
        appendScrollback({ ...agent, pendingPermission: event.permission }, { kind: "permission", text: event.permission, ts }),
      )
    }
    case "result":
      return { ...state, result: event.runResult }
  }
}

export function createRunStore(input: CreateRunStoreInput): RunStore {
  return createStore<RunStoreState>(() => createInitialState(input.config, input.initial))
}
