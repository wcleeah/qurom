import { createGraph } from "./graph"
import { createOpencodeEventBridge } from "./opencode-event-bridge"
import { createAgentRuntime } from "./agent-runtime/runtime"
import { createLiveStatusWriter, type NodeHistoryEntry } from "./live-status"
import { createDebugLog, type DebugLog } from "./debug-log"
import { abortSession } from "./opencode"
import { stat, unlink } from "node:fs/promises"
import { removeEmptyRunDir, resolveRunDir, writeFailedArtifacts } from "./output"
import { createTelemetry, type TelemetryRun, type TraceObservation } from "./telemetry"
import { Command, GraphRecursionError } from "@langchain/langgraph"

import type { RuntimeConfig } from "./config"
import { AUDITOR_ROLES, DRAFTER_ROLE } from "./role-registry"
import { researchStateSchema, type GraphInput, type InputRequest, type ResearchState } from "./schema"
import { hasProviderWithEventBridge, providersForRoles } from "./providers/registry"
import type { validateProviderPrerequisites } from "./providers/registry"
import type { PromptBundle } from "./prompt-assets"
import { answeredQuestionsFromTranscript, readerInterviewStateFromRunDir, readerInterviewTurnFromTranscript, resolveReaderInterviewQuestions } from "./reader-transcript"
import { resolveRunForResume } from "./run-resume"
import { join } from "node:path"
import { createSessionTelemetryWriter } from "./session-telemetry"

export type GraphFactory = typeof createGraph

export type RunnerEvent =
  | {
      kind: "lifecycle"
      phase: "starting" | "running" | "complete" | "error"
      requestId: string
      traceId?: string
      outputDir?: string
      error?: unknown
    }
  | { kind: "graph.node"; node: string; phase: "start" | "end"; state: ResearchState | GraphInput }
  | { kind: "session.created"; sessionID: string; role: string }
  | { kind: "session.status"; sessionID: string; status: string }
  | { kind: "session.error"; sessionID: string; name: string; message?: string }
  | { kind: "agent.metadata"; agent: string; sessionID: string; model?: string; variant?: string }
  | {
      kind: "session.telemetry"
      sessionID: string
      role?: string
      provider: string
      phase: "created" | "completed"
      requestedModel?: string
      modelParams?: Array<{ id: string; value: string }>
      resolvedModel?: string
      variant?: string
      providerAgent?: string
      cursorRunId?: string
      callIndex?: number
      durationMs?: number
      completedAt?: number
      node?: string
      round?: number
      usage?: import("./usage").UsageTotals
      usageSource?: "sdk" | "csv-import"
    }
  | { kind: "agent.message.start"; sessionID: string; messageID: string }
  | { kind: "agent.message.text"; sessionID: string; key: string; text: string; done?: boolean }
  | { kind: "agent.reasoning"; sessionID: string; key: string; text: string; done?: boolean }
  | {
      kind: "agent.tool"
      tool: string
      status: "running" | "completed" | "error"
      callID: string
      sessionID: string
      messageID: string
      partID: string
      input?: unknown
      output?: unknown
      metadata?: Record<string, unknown>
      error?: string
    }
  | {
      kind: "agent.permission"
      requestID: string
      permission: string
      patterns: string[]
      always: string[]
      sessionID: string
      messageID?: string
      callID?: string
    }
  | {
      kind: "agent.permission.replied"
      requestID: string
      reply: "once" | "always" | "reject"
      sessionID: string
    }
  | {
      kind: "agent.usage"
      sessionID: string
      tokensIn: number
      tokensOut: number
      source: "opencode" | "cursor"
      messageID?: string
      runID?: string
      cumulative?: boolean
      costUsd?: number
      costAvailable?: boolean
      costEstimated?: boolean
    }
  | { kind: "result"; runResult: unknown }
  | {
      kind: "design.phase"
      phase: "drafting" | "enhancing" | "finalizing"
      round: number
    }

export type RunnerEventListener = (event: RunnerEvent) => void

export type EventBus = {
  emit: (event: RunnerEvent) => void
  on: (listener: RunnerEventListener) => () => void
  off: (listener: RunnerEventListener) => void
}

export function createEventBus(): EventBus {
  const listeners = new Set<RunnerEventListener>()
  return {
    emit(event) {
      for (const listener of listeners) {
        try {
          listener(event)
        } catch {
          // Listener errors are isolated; one bad subscriber must not break others.
        }
      }
    },
    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    off(listener) {
      listeners.delete(listener)
    },
  }
}

export type Bridge = {
  start: () => Promise<void>
  stop: () => Promise<void>
}

export type BridgeFactory = (
  config: RuntimeConfig,
  opts: {
    bus: EventBus
    getRunDir: () => string | undefined
    onStreamError?: (error: unknown) => void
  },
) => Bridge

export function createNoOpBridge(): Bridge {
  return {
    async start() {},
    async stop() {},
  }
}

export function createBridgeForRoles(
  config: RuntimeConfig,
  roles: string[],
  opts: {
    bus: EventBus
    getRunDir: () => string | undefined
    onStreamError?: (error: unknown) => void
  },
): Bridge {
  if (!hasProviderWithEventBridge(config, roles)) {
    return createNoOpBridge()
  }

  for (const provider of providersForRoles(config, roles)) {
    if (provider.createEventBridge) {
      return provider.createEventBridge({
        config,
        bus: opts.bus,
        getRunDir: opts.getRunDir,
        onStreamError: opts.onStreamError,
      })
    }
  }

  return createNoOpBridge()
}

export type RuntimePrerequisites = Awaited<ReturnType<typeof validateProviderPrerequisites>>

export type RuntimePromptBundle = PromptBundle

export type RunResearchPipelineArgs = {
  config: RuntimeConfig
  prerequisites: RuntimePrerequisites
  promptBundle: RuntimePromptBundle
  request?: InputRequest
  requestId?: string
  resume?: { runId: string }
  bus: EventBus
  signal?: AbortSignal
  graphFactory?: GraphFactory
  bridgeFactory?: BridgeFactory
  abortSessionFn?: typeof abortSession
  telemetryFactory?: (
    config: RuntimeConfig,
    input: { requestId: string; inputMode: "topic" | "document"; topic?: string; documentPath?: string },
  ) => Promise<TelemetryRun>
}

export type RunResult = {
  requestId: string
  traceId?: string
  outputPath?: string
  outcome: string
  raw: unknown & {
    inputSummary?: unknown
    artifactSummary?: unknown
    outputPath?: string
    requestId?: string
    status?: string
  }
}

function toolKey(event: { sessionID: string; messageID: string; partID: string }) {
  return `${event.sessionID}:${event.messageID}:${event.partID}`
}

function permissionKey(input: { sessionID: string; messageID?: string; callID?: string }) {
  return `${input.sessionID}:${input.messageID ?? ""}:${input.callID ?? ""}`
}

/**
 * Run a graph that may suspend on `interrupt()` inside the `discoverReader` node.
 * On suspend: write the current newQuestions to live-status.json (awaitingReaderReply),
 * poll for reply-N.json in the run dir (or use it immediately if already present),
 * then resume with `Command({ resume: replyText })`. Loops until the graph completes.
 *
 * This is the repo's first human-in-the-loop: it extends the existing
 * checkpoint-resume pattern with a resume value and a file-mediated reply
 * handshake with the view-server.
 */
async function runGraphWithInterviewResume<GraphT extends {
  invoke: (input: unknown, config: unknown) => Promise<Record<string, unknown>>
  getState?: (config: unknown) => Promise<{
    tasks: Array<{ name: string; interrupts: Array<{ value: unknown }> }>
    config: Record<string, unknown> & { configurable?: Record<string, unknown> }
    values: Record<string, unknown>
  }>
}>(
  graph: GraphT,
  initialInput: unknown,
  baseConfig: { configurable: { thread_id: string }; recursionLimit: number; signal: AbortSignal },
  opts: {
    runDir: () => string | undefined
    setAwaitingReaderReply: (value: {
      turn: number
      answeredQuestions: Array<{ question: string; answer: string }>
      newQuestions: string[]
      transcript: Array<{ role: "interviewer" | "reader"; text: string }>
      partialProfile?: Record<string, unknown>
    } | undefined) => void
    debugLog?: { write: (type: string, data?: Record<string, unknown>) => void }
  },
): Promise<Record<string, unknown>> {
  const threadId = String(baseConfig.configurable.thread_id)
  const recursionLimit = baseConfig.recursionLimit
  const signal = baseConfig.signal
  // Always thread_id only — never pin checkpoint_id (latest head / Command resume).
  const threadConfig = { configurable: { thread_id: threadId }, recursionLimit, signal }
  let input: unknown = initialInput
  let currentConfig = threadConfig
  let attempt = 0

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await graph.invoke(input, currentConfig)
    attempt += 1

    // Detect an interrupt: getState().tasks[].interrupts[].value holds the
    // value passed to interrupt(). An empty interrupts list means the graph
    // completed normally. If the graph has no getState (e.g. a test stub),
    // there is no interrupt to resume — return the result.
    if (typeof graph.getState !== "function") {
      return result
    }
    const snapshot = await graph.getState({ configurable: { thread_id: threadId } }).catch(() => undefined)
    const interruptTask = snapshot?.tasks?.find((t) => t.interrupts && t.interrupts.length > 0)
    if (!interruptTask || !interruptTask.interrupts || interruptTask.interrupts.length === 0) {
      return result
    }

    const interruptValue = interruptTask.interrupts[0]!.value
    const pendingQuestions = Array.isArray(snapshot?.values?.pendingNewReaderQuestions)
      ? (snapshot!.values.pendingNewReaderQuestions as string[])
      : undefined
    let transcript: Array<{ role: "interviewer" | "reader"; text: string }> = Array.isArray(snapshot?.values?.interviewTranscript)
      ? (snapshot!.values.interviewTranscript as Array<{ role: "interviewer" | "reader"; text: string }>)
      : []
    let newQuestions = resolveReaderInterviewQuestions({
      interviewTranscript: transcript,
      pendingNewReaderQuestions: pendingQuestions,
      interruptValue,
    })
    let turn = readerInterviewTurnFromTranscript(transcript)
    let partialProfile = snapshot?.values?.readerProfile

    const runDir = opts.runDir()
    if (runDir) {
      const diskState = await readerInterviewStateFromRunDir(runDir)
      if (diskState && diskState.turn >= turn) {
        turn = diskState.turn
        newQuestions = diskState.newQuestions
        if (diskState.transcript.length >= transcript.length) transcript = diskState.transcript
        if (diskState.partialProfile) partialProfile = diskState.partialProfile
      }
    }

    const answeredQuestions = answeredQuestionsFromTranscript(
      transcript.flatMap((entry) =>
        entry.role === "interviewer" || entry.role === "reader"
          ? [{ role: entry.role, text: entry.text }]
          : []
      ),
    )

    opts.debugLog?.write("reader.interview_suspend", { turn, answeredQuestions, newQuestions, attempt })
    opts.setAwaitingReaderReply({
      turn,
      answeredQuestions,
      newQuestions,
      transcript: transcript.flatMap((entry) =>
        entry.role === "interviewer" || entry.role === "reader"
          ? [{ role: entry.role, text: entry.text }]
          : []
      ),
      ...(partialProfile && typeof partialProfile === "object"
        ? { partialProfile: partialProfile as Record<string, unknown> }
        : {}),
    })

    await discardStaleLiveReplyInbox(opts.runDir)

    // Prefer an existing reply-N.json (resume after cancel); otherwise wait for one.
    const replyText = await waitForReaderReply(opts.runDir, signal, turn)
    opts.setAwaitingReaderReply(undefined)
    opts.debugLog?.write("reader.interview_resume", { turn, replyLen: replyText.length })

    // Command resume with thread_id only — never pin checkpoint_id.
    input = new Command({ resume: replyText })
    currentConfig = threadConfig
    // Re-enter the loop; the next invoke continues from the interrupt.
  }
}

async function discardStaleLiveReplyInbox(runDir: () => string | undefined) {
  const dir = runDir()
  if (!dir) return
  // Legacy inbox name from older runs — ignore if present.
  try {
    await unlink(join(dir, "reader-reply.json"))
  } catch {
    // expected when absent
  }
}

async function waitForReaderReply(runDir: () => string | undefined, signal: AbortSignal, turn: number): Promise<string> {
  const { exists, readFile } = await import("node:fs/promises")
  const { join } = await import("node:path")
  const pollIntervalMs = 400
  const replyPathFor = (dir: string) => join(dir, `reply-${turn}.json`)

  while (!signal.aborted) {
    const dir = runDir()
    if (dir) {
      const replyPath = replyPathFor(dir)
      if (await exists(replyPath)) {
        try {
          const raw = await readFile(replyPath, "utf8")
          try {
            const parsed = JSON.parse(raw) as { reply?: string }
            if (typeof parsed.reply === "string") return parsed.reply
          } catch { /* not JSON — treat as raw text */ }
          return raw.trim()
        } catch { /* read failed — keep polling */ }
      }
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }
  throw new Error("Reader reply wait aborted")
}

function normalizeFailure(error: unknown, bridgeStreamError: unknown) {
  const surfaced = bridgeStreamError ?? error

  if (bridgeStreamError) {
    return {
      surfaced,
      failureReason: "stream_error" as const,
      message: surfaced instanceof Error ? surfaced.message : String(surfaced),
    }
  }

  if (error instanceof GraphRecursionError) {
    return {
      surfaced,
      failureReason: "recursion_limit_exhausted" as const,
      message: error.message,
    }
  }

  return {
    surfaced,
    failureReason: "runtime_error" as const,
    message: surfaced instanceof Error ? surfaced.message : String(surfaced),
  }
}

function isUserCancellation(signal: AbortSignal | undefined, bridgeStreamError: unknown): boolean {
  return Boolean(signal?.aborted && !bridgeStreamError)
}

function salvageStateOutput(state: ResearchState) {
  return {
    requestId: state.requestId,
    outcome: state.status,
    round: state.round,
    approvedAgents: state.approvedAgents,
    unresolvedFindings: state.unresolvedFindings.length,
    failureReason: state.failureReason,
    outputPath: state.outputPath,
    inputSummary: state.inputSummary,
    artifactSummary: state.artifactSummary,
  }
}

// Subscribes to bus.agent.tool / bus.agent.permission and owns Langfuse Tool span lifecycle.
// Maintains its own sessionID -> role map (built from session.created) so it can attach role
// metadata to spans even though bridge events no longer carry role.
// Per-key promise chain preserves the natural ordering the bridge stream provides while
// still letting other tool keys progress in parallel.
// Exported for direct testing; runQuorum is the only production caller.
export function attachTelemetryListener(bus: EventBus, telemetry: TelemetryRun) {
  const sessionObservations = new Map<string, TraceObservation>()
  const sessionRoles = new Map<string, string>()
  const toolObservations = new Map<string, TraceObservation>()
  const toolPermissions = new Map<string, string[]>()
  const pending = new Map<string, Promise<void>>()

  const off = bus.on((event) => {
    if (event.kind === "session.created") {
      sessionRoles.set(event.sessionID, event.role)
      return
    }

    if (event.kind === "agent.permission") {
      if (!event.messageID || !event.callID) return
      // Filter events for sessions this run did not spawn (bridge no longer filters).
      if (!sessionRoles.has(event.sessionID)) return
      const key = permissionKey(event)
      const list = toolPermissions.get(key) ?? []
      list.push(event.permission)
      toolPermissions.set(key, list)
      return
    }

    if (event.kind !== "agent.tool") return
    if (!sessionRoles.has(event.sessionID)) return

    const key = toolKey(event)
    const permKey = permissionKey({
      sessionID: event.sessionID,
      messageID: event.messageID,
      callID: event.callID,
    })
    const role = sessionRoles.get(event.sessionID) ?? "unknown"
    const snapshot = { ...event, role, permKey }

    const previous = pending.get(key) ?? Promise.resolve()
    const next = previous.then(() => handle(snapshot)).catch(() => {})
    pending.set(
      key,
      next.finally(() => {
        if (pending.get(key) === next) pending.delete(key)
      }),
    )
  })

  async function handle(snapshot: {
    role: string
    tool: string
    status: "running" | "completed" | "error"
    callID: string
    sessionID: string
    messageID: string
    partID: string
    input?: unknown
    output?: unknown
    metadata?: Record<string, unknown>
    error?: string
    permKey: string
  }) {
    const key = toolKey(snapshot)
    const existing = toolObservations.get(key)

    if (!existing) {
      const parent = sessionObservations.get(snapshot.sessionID)
      if (!parent) return // No parent span available yet; skip silently.

      const observation = await telemetry.startObservation({
        traceId: parent.traceId,
        parentObservationId: parent.id,
        name: `tool.${snapshot.tool}`,
        type: "Tool",
        input: {
          tool: snapshot.tool,
          callId: snapshot.callID,
          args: snapshot.input,
        },
        metadata: {
          role: snapshot.role,
          sessionId: snapshot.sessionID,
          messageId: snapshot.messageID,
          partId: snapshot.partID,
          callId: snapshot.callID,
          permissions: toolPermissions.get(snapshot.permKey),
          ...(snapshot.metadata ? { toolMetadata: snapshot.metadata } : {}),
        },
      })
      if (observation) toolObservations.set(key, observation)
    }

    if (snapshot.status === "completed" || snapshot.status === "error") {
      const observation = toolObservations.get(key)
      await telemetry.endObservation(observation, {
        output: {
          tool: snapshot.tool,
          status: snapshot.status,
          result: snapshot.status === "completed" ? snapshot.output : undefined,
          error: snapshot.status === "error" ? snapshot.error : undefined,
        },
        metadata: {
          role: snapshot.role,
          sessionId: snapshot.sessionID,
          callId: snapshot.callID,
          permissions: toolPermissions.get(snapshot.permKey),
          ...(snapshot.metadata ? { toolMetadata: snapshot.metadata } : {}),
        },
        level: snapshot.status === "error" ? "ERROR" : undefined,
      })
      toolObservations.delete(key)
      toolPermissions.delete(snapshot.permKey)
    }
  }

  function trackSessionObservation(sessionID: string, observation: TraceObservation | undefined) {
    if (!observation) return
    sessionObservations.set(sessionID, observation)
  }

  async function dispose() {
    off()
    await Promise.allSettled([...pending.values()])
  }

  return { trackSessionObservation, dispose }
}

/** Continue from the latest checkpoint for this thread (thread_id only — no historical pin). */
async function resolveGraphResumeConfig(
  graph: {
    getState?: (config: unknown) => Promise<{
      config: Record<string, unknown> & { configurable?: Record<string, unknown> }
    }>
  },
  requestId: string,
) {
  const baseConfig = { configurable: { thread_id: requestId } }
  const state = typeof graph.getState === "function"
    ? await graph.getState(baseConfig)
    : undefined
  const checkpointId = state?.config?.configurable?.checkpoint_id
  if (typeof checkpointId !== "string") throw new Error(`No checkpoint found for thread ${requestId}`)
  return { configurable: { thread_id: requestId } }
}

async function readNodeHistoryFromDisk(runDir: string): Promise<NodeHistoryEntry[]> {
  try {
    const raw = await Bun.file(join(runDir, "node-history.json")).json()
    return Array.isArray(raw) ? raw as NodeHistoryEntry[] : []
  } catch {
    return []
  }
}

function attachResearchRunObservers(
  runDir: string,
  request: InputRequest,
  requestId: string,
  config: RuntimeConfig,
  bus: EventBus,
  opts?: { initialNodeHistory?: NodeHistoryEntry[]; logStart?: boolean },
): { liveStatusWriter: ReturnType<typeof createLiveStatusWriter>; debugLog: DebugLog; sessionTelemetryWriter: ReturnType<typeof createSessionTelemetryWriter> } {
  const debugLog = createDebugLog(runDir)
  const liveStatusWriter = createLiveStatusWriter(bus, runDir, {
    maxRounds: config.quorumConfig.maxRounds,
    initialNodeHistory: opts?.initialNodeHistory,
  }, debugLog)
  const sessionTelemetryWriter = createSessionTelemetryWriter(runDir, bus)
  if (opts?.logStart !== false) {
    debugLog.write("pipeline.start", {
      requestId,
      inputMode: request.inputMode,
      topic: request.inputMode === "topic" ? request.topic : undefined,
      documentPath: request.inputMode === "document" ? request.documentPath : undefined,
      recursionLimit: config.quorumConfig.recursionLimit,
      maxRounds: config.quorumConfig.maxRounds,
      designatedDrafter: DRAFTER_ROLE,
      auditors: [...AUDITOR_ROLES],
      designQuorum: config.quorumConfig.designQuorum?.enabled ?? false,
    })
  }
  return { liveStatusWriter, debugLog, sessionTelemetryWriter }
}

export async function runResearchPipeline(args: RunResearchPipelineArgs): Promise<RunResult> {
  const { config, prerequisites, promptBundle, bus, signal } = args
  void prerequisites
  const graphFactory = args.graphFactory ?? createGraph
  const bridgeFactory = args.bridgeFactory ?? createOpencodeEventBridge
  const abortSessionFn = args.abortSessionFn ?? abortSession
  const telemetryFactory = args.telemetryFactory ?? createTelemetry

  const resolvedResume = args.resume ? await resolveRunForResume(args.resume.runId, config.env.QUORUM_RUNS_DIR) : undefined
  const request = resolvedResume?.request ?? args.request
  if (!request) {
    throw new Error("runResearchPipeline requires either request or resume")
  }
  const requestId = args.requestId ?? resolvedResume?.requestId ?? crypto.randomUUID()
  let runDir: string | undefined = resolvedResume?.runDir
  let interviewRunDir: string | undefined = resolvedResume?.runDir

  if (!runDir && args.requestId && !resolvedResume) {
    const candidateDir = resolveRunDir(config.env.QUORUM_RUNS_DIR, {
      requestId,
      inputMode: request.inputMode,
      topic: request.inputMode === "topic" ? request.topic : undefined,
      documentPath: request.inputMode === "document" ? request.documentPath : undefined,
      documentText: request.inputMode === "document" ? request.documentText : undefined,
    })
    try {
      if ((await stat(candidateDir)).isDirectory()) {
        runDir = candidateDir
        interviewRunDir = candidateDir
      }
    } catch {
      // prepareOutputPath will create the directory later
    }
  }

  const telemetry = await telemetryFactory(config, {
    requestId,
    inputMode: request.inputMode,
    topic: request.inputMode === "topic" ? request.topic : undefined,
    documentPath: request.inputMode === "document" ? request.documentPath : undefined,
  })

  const bridgeAbort = new AbortController()
  let bridgeStreamError: unknown
  let liveStatusWriter: ReturnType<typeof createLiveStatusWriter> | undefined
  let sessionTelemetryWriter: ReturnType<typeof createSessionTelemetryWriter> | undefined
  let debugLog: DebugLog | undefined
  const debugLogRef: { current: DebugLog | undefined } = { current: undefined }
  if (signal) {
    if (signal.aborted) {
        bridgeAbort.abort(signal.reason)
    } else {
        signal.addEventListener("abort", () => bridgeAbort.abort(signal.reason), { once: true })
    }
  }

  const bridge = bridgeFactory(config, {
    bus,
    getRunDir: () => runDir,
    onStreamError: (error) => {
      bridgeStreamError = error
      bridgeAbort.abort(error)
    },
  })
  const telemetryListener = attachTelemetryListener(bus, telemetry)
  const actualAgentVariants = new Map<string, string>()
  const trackAgentMetadata = (input: { agent: string; sessionID: string; model?: string; variant?: string }) => {
    if (input.variant) actualAgentVariants.set(input.agent, input.variant)
    bus.emit({ kind: "agent.metadata", ...input })
    debugLogRef.current?.write("agent.metadata", input)
    bus.emit({
      kind: "session.telemetry",
      sessionID: input.sessionID,
      provider: "opencode",
      phase: "completed",
      providerAgent: input.agent,
      resolvedModel: input.model,
      variant: input.variant,
      completedAt: Date.now(),
    })
  }
  const sessionIDs = new Set<string>()
  const offSessionCreated = bus.on((event) => {
    if (event.kind !== "session.created") return
    sessionIDs.add(event.sessionID)
  })

  bus.emit({
    kind: "lifecycle",
    phase: "starting",
    requestId,
    traceId: telemetry.traceId,
    ...(runDir ? { outputDir: runDir } : {}),
  })

  try {
    await bridge.start()

    if (runDir) {
      const initialNodeHistory = resolvedResume?.runDir
        ? await readNodeHistoryFromDisk(resolvedResume.runDir)
        : []
      const attached = attachResearchRunObservers(
        runDir,
        request,
        requestId,
        config,
        bus,
        { initialNodeHistory, logStart: !resolvedResume?.runDir },
      )
      liveStatusWriter = attached.liveStatusWriter
      sessionTelemetryWriter = attached.sessionTelemetryWriter
      debugLog = attached.debugLog
      debugLogRef.current = debugLog
    }

    const runResult = await telemetry.runWithRootObservation(async () => {
      bus.emit({
        kind: "lifecycle",
        phase: "running",
        requestId,
        traceId: telemetry.traceId,
        ...(runDir ? { outputDir: runDir } : {}),
      })

      const graph = graphFactory(config, promptBundle, {
        runtime: createAgentRuntime(config, bus, { roleInstructions: promptBundle.roleInstructions }),
        observer: {
          debugLog: { write(type, data) { debugLogRef.current?.write(type, data) } } as DebugLog,
          onNodeStart(node, state) {
            bus.emit({ kind: "graph.node", node, phase: "start", state: structuredClone(state) })
          },
          onNodeEnd(node, state) {
            bus.emit({ kind: "graph.node", node, phase: "end", state: structuredClone(state) })
            // Capture outputPath as soon as prepareOutputPath completes
            if (node === "prepareOutputPath" && !liveStatusWriter) {
              const op = (state as { outputPath?: string }).outputPath
              if (op) {
                interviewRunDir = op
                runDir = op
                const attached = attachResearchRunObservers(op, request, requestId, config, bus)
                sessionTelemetryWriter?.dispose()
                liveStatusWriter = attached.liveStatusWriter
                sessionTelemetryWriter = attached.sessionTelemetryWriter
                debugLog = attached.debugLog
                debugLogRef.current = debugLog
                bus.emit({
                  kind: "lifecycle",
                  phase: "running",
                  requestId,
                  traceId: telemetry.traceId,
                  outputDir: op,
                })
              }
            }
          },
          onSessionCreated({ sessionID, role }) {
            bus.emit({ kind: "session.created", sessionID, role })
          },
          onDesignPhase(phase, round) {
            bus.emit({ kind: "design.phase", phase, round })
          },
        },
        telemetry: {
          run: telemetry,
          trackSessionObservation: telemetryListener.trackSessionObservation,
          trackAgentMetadata,
          debugLog: { write(type, data) { debugLogRef.current?.write(type, data) } } as DebugLog,
        },
      })

      let initialInput: Record<string, unknown> | null = { ...request, requestId }
      let initialConfig: { configurable: { thread_id: string; checkpoint_id?: string }; recursionLimit: number; signal: AbortSignal } = {
        configurable: { thread_id: requestId },
        recursionLimit: config.quorumConfig.recursionLimit,
        signal: bridgeAbort.signal,
      }

      if (resolvedResume) {
        const resumeConfig = await resolveGraphResumeConfig(
          graph as unknown as Parameters<typeof resolveGraphResumeConfig>[0],
          requestId,
        )
        debugLogRef.current?.write("pipeline.resume", {
          requestId,
          runDir: resolvedResume.runDir,
        })
        initialInput = null
        initialConfig = {
          configurable: resumeConfig.configurable,
          recursionLimit: config.quorumConfig.recursionLimit,
          signal: bridgeAbort.signal,
        }
      }

      const invocation = await runGraphWithInterviewResume(
        graph as unknown as Parameters<typeof runGraphWithInterviewResume>[0],
        initialInput,
        initialConfig,
        {
          runDir: () => interviewRunDir ?? runDir,
          setAwaitingReaderReply: (value) => liveStatusWriter?.setAwaitingReaderReply(value),
          debugLog: { write(type, data) { debugLogRef.current?.write(type, data) } } as { write: (type: string, data?: Record<string, unknown>) => void },
        },
      ) as ResearchState

      runDir = invocation.outputPath

      const traceMetadata = {
        requestId: invocation.requestId,
        status: invocation.status,
        round: invocation.round,
        approvedAgents: invocation.approvedAgents,
        unresolvedFindings: invocation.unresolvedFindings.length,
        failureReason: invocation.failureReason,
        outputPath: invocation.outputPath,
        inputSummaryTitle: invocation.inputSummary?.title,
        artifactSummaryTitle: invocation.artifactSummary?.title,
        agentVariants: Object.fromEntries(actualAgentVariants),
        designStatus: invocation.designStatus,
        hasDesignHtml: Boolean(invocation.designHtml),
        traced: telemetry.enabled,
      }

      await telemetry.updateTrace({
        output: {
          requestId: invocation.requestId,
          outcome: invocation.status,
          round: invocation.round,
          approvedAgents: invocation.approvedAgents,
          unresolvedFindings: invocation.unresolvedFindings.length,
          failureReason: invocation.failureReason,
          outputPath: invocation.outputPath,
          inputSummary: invocation.inputSummary,
          artifactSummary: invocation.artifactSummary,
          designHtml: invocation.designHtml,
          designStatus: invocation.designStatus,
        },
        metadata: traceMetadata,
      })

      return invocation
    })

    debugLogRef.current?.write("pipeline.complete", {
      status: runResult.status,
      round: runResult.round,
      outputPath: runResult.outputPath,
      approvedAgents: runResult.approvedAgents?.length,
      unresolvedFindings: runResult.unresolvedFindings?.length,
    })

    bus.emit({ kind: "result", runResult })
    bus.emit({
      kind: "lifecycle",
      phase: "complete",
      requestId,
      traceId: telemetry.traceId,
      outputDir: runResult.outputPath,
    })

    return {
      requestId,
      traceId: telemetry.traceId,
      outputPath: runResult.outputPath,
      outcome: runResult.status,
      raw: runResult,
    }
  } catch (error) {
    if (isUserCancellation(signal, bridgeStreamError)) {
      debugLogRef.current?.write("pipeline.cancelled", { requestId, outputPath: runDir })
      liveStatusWriter?.setAwaitingReaderReply(undefined)
      bus.emit({
        kind: "lifecycle",
        phase: "complete",
        requestId,
        traceId: telemetry.traceId,
        ...(runDir ? { outputDir: runDir } : {}),
      })
      return {
        requestId,
        traceId: telemetry.traceId,
        outputPath: runDir,
        outcome: "cancelled",
        raw: {
          requestId,
          status: "cancelled",
          outputPath: runDir,
        },
      }
    }

    debugLogRef.current?.write("pipeline.error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      bridgeStreamError: bridgeStreamError instanceof Error ? bridgeStreamError.message : String(bridgeStreamError ?? ""),
    })
    const graph = graphFactory(config, promptBundle)
    const failure = normalizeFailure(error, bridgeStreamError)
    const checkpoint =
      typeof graph.getState === "function"
        ? await graph.getState({ configurable: { thread_id: requestId } }).catch(() => undefined)
        : undefined
    const recovered =
      checkpoint && researchStateSchema.safeParse(checkpoint.values).success
        ? researchStateSchema.parse(checkpoint.values)
        : undefined

    if (recovered) {
      if (recovered.outputPath) {
        runDir = recovered.outputPath
        // Create live-status writer for the recovery path too,
        // so the view-server can show the failure state briefly.
        liveStatusWriter = createLiveStatusWriter(bus, () => runDir, {
          maxRounds: config.quorumConfig.maxRounds,
        })
      }

      const salvagedState = researchStateSchema.parse({
        ...recovered,
        failureReason: failure.failureReason,
        status: "failed",
      })

      if (salvagedState.outputPath) {
        await writeFailedArtifacts(salvagedState.outputPath, {
          draft: salvagedState.draft,
          summary: {
            requestId: salvagedState.requestId,
            outcome: "failed_non_convergent",
            round: salvagedState.round,
            approvedAgents: salvagedState.approvedAgents,
            unresolvedFindings: salvagedState.unresolvedFindings,
            rebuttalTurnCounts: salvagedState.rebuttalTurnCounts,
            rebuttalHistory: salvagedState.rebuttalHistory,
            rebuttalResponseHistory: salvagedState.rebuttalResponseHistory,
            failureReason: salvagedState.failureReason,
            recoveredFromCheckpoint: true,
            error: failure.message,
          },
        })
      }

      bus.emit({ kind: "result", runResult: salvagedState })
      await telemetry.updateTrace({
        output: salvageStateOutput(salvagedState),
        metadata: {
          requestId: salvagedState.requestId,
          status: salvagedState.status,
          round: salvagedState.round,
          approvedAgents: salvagedState.approvedAgents,
          unresolvedFindings: salvagedState.unresolvedFindings.length,
          failureReason: salvagedState.failureReason,
          outputPath: salvagedState.outputPath,
          agentVariants: Object.fromEntries(actualAgentVariants),
          recoveredFromCheckpoint: true,
          traced: telemetry.enabled,
        },
      })
    }

    bus.emit({
      kind: "lifecycle",
      phase: "error",
      requestId,
      traceId: telemetry.traceId,
      error: failure.surfaced,
    })
    throw failure.surfaced
  } finally {
      offSessionCreated()
      if (debugLog) {
        try { debugLog.write("pipeline.finalize", {}); await debugLog.close() } catch { /* ignore */ }
      }
      if (liveStatusWriter) {
        try {
          liveStatusWriter.dispose()
        } catch {
          // Live-status disposal errors must not mask the original failure.
        }
      }
      if (sessionTelemetryWriter) {
        try {
          await sessionTelemetryWriter.flush()
          sessionTelemetryWriter.dispose()
        } catch {
          // Session telemetry disposal errors must not mask the original failure.
        }
      }
      if (bridgeAbort.signal.aborted && sessionIDs.size > 0) {
        await Promise.allSettled([...sessionIDs].map((sessionID) => abortSessionFn(config, sessionID)))
     }
     try {
       await telemetryListener.dispose()
     } catch {
      // Telemetry listener disposal errors must not mask the original failure.
    }
    try {
      await telemetry.shutdown()
    } catch {
      // Telemetry shutdown errors must not mask the original failure.
    }
    try {
      await bridge.stop()
    } catch {
       // Bridge shutdown errors must not mask the original failure.
     }
      try {
        if (runDir) await removeEmptyRunDir(runDir)
      } catch {
        // Empty-run cleanup errors must not mask the original failure.
      }
  }
}

// Compile-time exhaustiveness check: missing a RunnerEvent kind here fails `tsc`.
function assertNever(value: never): never {
  throw new Error(`unexpected RunnerEvent kind: ${JSON.stringify(value)}`)
}

export function describeRunnerEvent(event: RunnerEvent): string {
  switch (event.kind) {
    case "lifecycle":
      return `lifecycle:${event.phase}`
    case "graph.node":
      return `graph.node:${event.node}:${event.phase}`
    case "session.created":
      return `session.created:${event.role}`
    case "session.status":
      return `session.status:${event.sessionID}:${event.status}`
    case "session.error":
      return `session.error:${event.sessionID}:${event.name}`
    case "agent.metadata":
      return `agent.metadata:${event.sessionID}:${event.agent}`
    case "session.telemetry":
      return `session.telemetry:${event.sessionID}:${event.phase}`
    case "agent.message.start":
      return `agent.message.start:${event.sessionID}`
    case "agent.message.text":
      return `agent.message.text:${event.sessionID}`
    case "agent.reasoning":
      return `agent.reasoning:${event.sessionID}`
    case "agent.tool":
      return `agent.tool:${event.sessionID}:${event.tool}:${event.status}`
    case "agent.permission":
      return `agent.permission:${event.sessionID}:${event.requestID}:${event.permission}`
    case "agent.permission.replied":
      return `agent.permission.replied:${event.sessionID}:${event.requestID}:${event.reply}`
    case "agent.usage":
      return `agent.usage:${event.sessionID}:${event.source}`
    case "result":
      return "result"
    case "design.phase":
      return `design.phase:${event.phase}:${event.round}`
    default:
      return assertNever(event)
  }
}
