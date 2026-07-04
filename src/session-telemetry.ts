import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { EventBus } from "./runner"
import { addUsage, emptyUsage, usageDelta, type UsageTotals } from "./usage"

export const SESSION_TELEMETRY_FILENAME = "session-telemetry.json"

export type ModelParam = { id: string; value: string }

export type SessionTelemetryCall = {
  cursorRunId?: string
  callIndex?: number
  resolvedModel?: string
  durationMs?: number
  completedAt?: string
  usage?: UsageTotals
  usageSource?: "sdk" | "csv-import"
}

export type SessionTelemetryRecord = {
  sessionId: string
  role: string
  provider: string
  node?: string
  round?: number
  requestedModel?: string
  modelParams?: ModelParam[]
  variant?: string
  providerAgent?: string
  createdAt?: string
  calls: SessionTelemetryCall[]
}

export type SessionTelemetryFile = {
  version: 1
  sessions: SessionTelemetryRecord[]
}

export type SessionTelemetryEvent = {
  kind: "session.telemetry"
  sessionID: string
  role?: string
  provider: string
  phase: "created" | "completed"
  node?: string
  round?: number
  requestedModel?: string
  modelParams?: ModelParam[]
  resolvedModel?: string
  variant?: string
  providerAgent?: string
  cursorRunId?: string
  callIndex?: number
  durationMs?: number
  completedAt?: number
  usage?: UsageTotals
  usageSource?: "sdk" | "csv-import"
}

export function emptySessionTelemetryFile(): SessionTelemetryFile {
  return { version: 1, sessions: [] }
}

export async function readSessionTelemetry(runDir: string): Promise<SessionTelemetryFile> {
  try {
    const raw = await readFile(join(runDir, SESSION_TELEMETRY_FILENAME), "utf8")
    const parsed = JSON.parse(raw) as SessionTelemetryFile
    if (parsed?.version === 1 && Array.isArray(parsed.sessions)) return parsed
  } catch {
    // missing or invalid
  }
  return emptySessionTelemetryFile()
}

export async function writeSessionTelemetry(runDir: string, file: SessionTelemetryFile): Promise<void> {
  await writeFile(join(runDir, SESSION_TELEMETRY_FILENAME), `${JSON.stringify(file, null, 2)}\n`, "utf8")
}

function findSession(file: SessionTelemetryFile, sessionId: string) {
  return file.sessions.find((entry) => entry.sessionId === sessionId)
}

function findCall(record: SessionTelemetryRecord, cursorRunId: string | undefined) {
  if (!cursorRunId) return record.calls.at(-1)
  return record.calls.find((call) => call.cursorRunId === cursorRunId)
}

export function applySessionTelemetryEvent(
  file: SessionTelemetryFile,
  event: SessionTelemetryEvent,
): SessionTelemetryFile {
  const next: SessionTelemetryFile = {
    version: 1,
    sessions: file.sessions.map((session) => ({
      ...session,
      calls: session.calls.map((call) => ({ ...call })),
    })),
  }

  let record = findSession(next, event.sessionID)
  if (!record) {
    record = {
      sessionId: event.sessionID,
      role: event.role ?? event.providerAgent ?? event.sessionID,
      provider: event.provider,
      calls: [],
    }
    next.sessions.push(record)
  }

  if (event.role) record.role = event.role
  if (event.provider) record.provider = event.provider
  if (event.node !== undefined) record.node = event.node
  if (event.round !== undefined) record.round = event.round
  if (event.requestedModel !== undefined) record.requestedModel = event.requestedModel
  if (event.modelParams?.length) record.modelParams = event.modelParams
  if (event.variant !== undefined) record.variant = event.variant
  if (event.providerAgent !== undefined) record.providerAgent = event.providerAgent

  if (event.phase === "created") {
    record.createdAt = new Date(event.completedAt ?? Date.now()).toISOString()
    return next
  }

  const completedAt = event.completedAt ? new Date(event.completedAt).toISOString() : new Date().toISOString()
  let call = findCall(record, event.cursorRunId)
  if (!call) {
    call = {}
    record.calls.push(call)
  }

  if (event.cursorRunId) call.cursorRunId = event.cursorRunId
  if (event.callIndex !== undefined) call.callIndex = event.callIndex
  if (event.resolvedModel !== undefined) call.resolvedModel = event.resolvedModel
  if (event.durationMs !== undefined) call.durationMs = event.durationMs
  call.completedAt = completedAt
  if (event.usage) call.usage = { ...event.usage }
  if (event.usageSource) call.usageSource = event.usageSource

  return next
}

export function sumSessionTelemetryUsage(file: SessionTelemetryFile): UsageTotals & { usageAvailable: boolean } {
  const usage: UsageTotals & { usageAvailable: boolean } = {
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    costAvailable: false,
    usageAvailable: false,
  }

  for (const session of file.sessions) {
    for (const call of session.calls) {
      if (!call.usage) continue
      usage.usageAvailable = true
      usage.tokensIn += call.usage.tokensIn
      usage.tokensOut += call.usage.tokensOut
      if (call.usage.costAvailable) {
        usage.costAvailable = true
        usage.costUsd = (usage.costUsd ?? 0) + (call.usage.costUsd ?? 0)
        if (call.usage.costEstimated) usage.costEstimated = true
      }
    }
  }

  return usage
}

export type AgentUsageTelemetryContext = {
  role?: string
  node?: string
  round?: number
  accumulatedBySession: Map<string, UsageTotals>
  messageUsageTotals: Map<string, UsageTotals>
  cursorRunUsageTotals: Map<string, UsageTotals>
}

export function applyAgentUsageEvent(
  file: SessionTelemetryFile,
  event: {
    sessionID: string
    source: "opencode" | "cursor"
    tokensIn: number
    tokensOut: number
    messageID?: string
    runID?: string
    cumulative?: boolean
    costUsd?: number
    costAvailable?: boolean
    costEstimated?: boolean
  },
  context: AgentUsageTelemetryContext,
): SessionTelemetryFile {
  const next: UsageTotals = {
    tokensIn: event.tokensIn,
    tokensOut: event.tokensOut,
    ...(event.costAvailable
      ? {
          costUsd: event.costUsd ?? 0,
          costAvailable: true,
          costEstimated: event.costEstimated,
        }
      : {}),
  }

  let delta = next
  if (event.cumulative) {
    const key = event.runID ?? `${event.sessionID}:cumulative`
    const previous = context.cursorRunUsageTotals.get(key) ?? emptyUsage()
    delta = usageDelta(previous, next)
    context.cursorRunUsageTotals.set(key, next)
  } else if (event.messageID) {
    const previous = context.messageUsageTotals.get(event.messageID) ?? emptyUsage()
    delta = usageDelta(previous, next)
    context.messageUsageTotals.set(event.messageID, next)
  }

  const accumulated = context.accumulatedBySession.get(event.sessionID) ?? emptyUsage()
  addUsage(accumulated, delta)
  context.accumulatedBySession.set(event.sessionID, accumulated)

  return applySessionTelemetryEvent(file, {
    kind: "session.telemetry",
    sessionID: event.sessionID,
    role: context.role,
    provider: event.source,
    phase: "completed",
    node: context.node,
    round: context.round,
    cursorRunId: event.runID,
    usage: { ...accumulated },
    usageSource: "sdk",
    completedAt: Date.now(),
  })
}

/** @deprecated Use applyAgentUsageEvent */
export function applyOpencodeAgentUsageEvent(
  file: SessionTelemetryFile,
  event: {
    sessionID: string
    tokensIn: number
    tokensOut: number
    messageID?: string
    costUsd?: number
    costAvailable?: boolean
    costEstimated?: boolean
  },
  context: Omit<AgentUsageTelemetryContext, "cursorRunUsageTotals">,
): SessionTelemetryFile {
  return applyAgentUsageEvent(file, { ...event, source: "opencode" }, {
    ...context,
    cursorRunUsageTotals: new Map(),
  })
}

const DESIGN_PHASE_NODES: Record<string, string> = {
  drafting: "runDesignHtml",
  enhancing: "interactiveEnhance",
  finalizing: "finalizeDesign",
}

export function createSessionTelemetryWriter(runDir: string | (() => string | undefined), bus: EventBus) {
  const sessionRoles = new Map<string, string>()
  const accumulatedBySession = new Map<string, UsageTotals>()
  const messageUsageTotals = new Map<string, UsageTotals>()
  const cursorRunUsageTotals = new Map<string, UsageTotals>()
  let currentNode: string | undefined
  let currentRound = 0
  let file = emptySessionTelemetryFile()
  let loaded = false
  let eventQueue: Promise<void> = Promise.resolve()
  let writeQueue: Promise<void> = Promise.resolve()

  function resolveDir(): string | undefined {
    return typeof runDir === "function" ? runDir() : runDir
  }

  function graphContext() {
    return { node: currentNode, round: currentRound }
  }

  async function ensureLoaded() {
    if (loaded) return
    const dir = resolveDir()
    if (!dir) return
    file = await readSessionTelemetry(dir)
    loaded = true
  }

  function enqueueEvent(work: () => void | Promise<void>) {
    eventQueue = eventQueue.then(work).catch(() => {})
  }

  function queueWrite() {
    writeQueue = writeQueue.then(async () => {
      const dir = resolveDir()
      if (!dir) return
      await writeSessionTelemetry(dir, file)
    }).catch(() => {})
  }

  const off = bus.on((event) => {
    if (event.kind === "graph.node") {
      if (event.phase === "start") {
        currentNode = event.node
        if (event.state && typeof event.state === "object") {
          const round = (event.state as { round?: unknown }).round
          if (typeof round === "number") currentRound = round
        }
      }
      return
    }

    if (event.kind === "design.phase") {
      currentNode = DESIGN_PHASE_NODES[event.phase] ?? "runDesignHtml"
      currentRound = event.round
      return
    }

    if (event.kind === "session.created") {
      sessionRoles.set(event.sessionID, event.role)
      return
    }

    if (event.kind === "agent.usage") {
      enqueueEvent(async () => {
        await ensureLoaded()
        file = applyAgentUsageEvent(file, event, {
          role: sessionRoles.get(event.sessionID),
          ...graphContext(),
          accumulatedBySession,
          messageUsageTotals,
          cursorRunUsageTotals,
        })
        queueWrite()
      })
      return
    }

    if (event.kind !== "session.telemetry") return

    enqueueEvent(async () => {
      await ensureLoaded()
      const enriched: SessionTelemetryEvent = {
        ...event,
        role: event.role ?? sessionRoles.get(event.sessionID),
        node: event.node ?? graphContext().node,
        round: event.round ?? graphContext().round,
      }
      file = applySessionTelemetryEvent(file, enriched)
      queueWrite()
    })
  })

  return {
    dispose() {
      off()
    },
    async flush() {
      await eventQueue
      await writeQueue
    },
  }
}
