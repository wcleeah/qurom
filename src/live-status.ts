import { writeFile, unlink } from "node:fs/promises"
import { join } from "node:path"
import type { EventBus } from "./runner"

export interface LiveAgentStatus {
  status: "idle" | "running" | "complete" | "error"
  tool?: string
  tokensIn: number
  tokensOut: number
}

export interface LiveStatus {
  phase: "running" | "complete" | "error"
  node?: string
  nodeStartedAt?: number
  round: number
  maxRounds: number
  depthTier?: string
  agents: Record<string, LiveAgentStatus>
  error?: string
}

const WRITE_INTERVAL_MS = 3000

export function createLiveStatusWriter(
  bus: EventBus,
  runDir: string | (() => string | undefined),
  config: { maxRounds: number },
): { dispose: () => void } {
  const status: LiveStatus = {
    phase: "running",
    round: 0,
    maxRounds: config.maxRounds,
    agents: {},
  }

  // Map sessionID → agent reference for O(1) lookup on status/tool events
  const sessionAgent = new Map<string, LiveAgentStatus>()

  // Start write interval immediately — the writer is created while the run
  // is already active (after graph invoke begins). Don't wait for a
  // lifecycle:running event that already fired before we subscribed.
  const interval = setInterval(writeStatus, WRITE_INTERVAL_MS)
  let disposed = false

  function resolveDir(): string | undefined {
    return typeof runDir === "function" ? runDir() : runDir
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
          if (event.state && "depthTier" in event.state && typeof event.state.depthTier === "string") {
            status.depthTier = event.state.depthTier
          }
        }
        break
      }
      case "design.phase": {
        const phaseStr =
          event.phase === "drafting" ? "design: drafting"
          : event.phase === "aggregating" ? `design: consensus round ${event.round}`
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
        } else {
          agent.tool = undefined
        }
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

  return { dispose }
}
