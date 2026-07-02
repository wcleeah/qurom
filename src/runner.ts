import { createGraph } from "./graph"
import { createOpencodeEventBridge } from "./opencode-event-bridge"
import { createAgentRuntime } from "./agent-runtime/runtime"
import { createLiveStatusWriter } from "./live-status"
import { createDebugLog, type DebugLog } from "./debug-log"
import { abortSession } from "./opencode"
import { removeEmptyRunDir, writeFailedArtifacts } from "./output"
import { createTelemetry, type TelemetryRun, type TraceObservation } from "./telemetry"
import { Command, GraphRecursionError } from "@langchain/langgraph"

import type { RuntimeConfig } from "./config"
import { researchStateSchema, type GraphInput, type InputRequest, type ResearchState } from "./schema"
import type { validateProviderPrerequisites } from "./providers/registry"
import type { PromptBundle } from "./prompt-assets"
import { answeredQuestionsFromTranscript } from "./reader-transcript"
import { resolveRunForResume } from "./run-resume"

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
  | { kind: "result"; runResult: unknown }
  | {
      kind: "design.phase"
      phase: "drafting" | "enhancing" | "finalizing" | "browser_qa"
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

export type RuntimePrerequisites = Awaited<ReturnType<typeof validateProviderPrerequisites>>

export type RuntimePromptBundle = PromptBundle

export type RunResearchPipelineArgs = {
  config: RuntimeConfig
  prerequisites: RuntimePrerequisites
  promptBundle: RuntimePromptBundle
  request?: InputRequest
  resume?: { runId: string; node?: string; checkpointId?: string }
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
 * poll for a reader-reply.json file in the run dir, then resume with
 * `Command({ resume: replyText })`. Loops until the graph completes.
 *
 * This is the repo's first human-in-the-loop: it extends the existing
 * checkpoint-resume pattern (used by design-resume at the bottom of this file)
 * with a resume value and a file-mediated reply handshake with the view-server.
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
      transcript: { role: string; text: string }[]
    } | undefined) => void
    debugLog?: { write: (type: string, data?: Record<string, unknown>) => void }
  },
): Promise<Record<string, unknown>> {
  const { configurable, recursionLimit, signal } = baseConfig
  let input: unknown = initialInput
  let currentConfig: { configurable: Record<string, unknown>; recursionLimit: number; signal: AbortSignal } = {
    configurable,
    recursionLimit,
    signal,
  }
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
    const snapshot = await graph.getState({ configurable }).catch(() => undefined)
    const interruptTask = snapshot?.tasks?.find((t) => t.interrupts && t.interrupts.length > 0)
    if (!interruptTask || !interruptTask.interrupts || interruptTask.interrupts.length === 0) {
      return result
    }

    const interruptValue = interruptTask.interrupts[0]!.value
    const pendingQuestions = Array.isArray(snapshot?.values?.pendingNewReaderQuestions)
      ? (snapshot!.values.pendingNewReaderQuestions as string[])
      : undefined
    const newQuestions = pendingQuestions && pendingQuestions.length > 0
      ? pendingQuestions
      : Array.isArray(interruptValue) ? (interruptValue as string[]) : [String(interruptValue)]
    const transcript = Array.isArray(snapshot?.values?.interviewTranscript)
      ? (snapshot!.values.interviewTranscript as { role: string; text: string }[])
      : []
    const turn = Math.ceil(transcript.length / 2)

    const answeredQuestions = answeredQuestionsFromTranscript(
      transcript.flatMap((entry) =>
        entry.role === "interviewer" || entry.role === "reader"
          ? [{ role: entry.role, text: entry.text }]
          : []
      ),
    )

    opts.debugLog?.write("reader.interview_suspend", { turn, answeredQuestions, newQuestions, attempt })
    opts.setAwaitingReaderReply({ turn, answeredQuestions, newQuestions, transcript })

    // Wait for the view-server to write reader-reply.json (the user submitted
    // the chat form). Poll the run dir; honor the abort signal.
    const replyText = await waitForReaderReply(opts.runDir, signal, turn)
    opts.setAwaitingReaderReply(undefined)
    opts.debugLog?.write("reader.interview_resume", { turn, replyLen: replyText.length })

    // Resume the graph from its checkpoint with the reply as the resume value.
    // The checkpoint_id in the snapshot config pins the resume to the suspend point.
    const checkpointId = snapshot?.config?.configurable?.checkpoint_id as string | undefined
    const resumeConfig: { configurable: Record<string, unknown>; recursionLimit: number; signal: AbortSignal } = {
      configurable: checkpointId ? { ...configurable, checkpoint_id: checkpointId } : configurable,
      recursionLimit,
      signal,
    }
    input = new Command({ resume: replyText })
    currentConfig = resumeConfig
    // Re-enter the loop; the next invoke continues from the interrupt.
  }
}

async function waitForReaderReply(runDir: () => string | undefined, signal: AbortSignal, turn: number): Promise<string> {
  const { exists, readFile, rename } = await import("node:fs/promises")
  const { join } = await import("node:path")
  const pollIntervalMs = 400
  while (!signal.aborted) {
    const dir = runDir()
    if (dir) {
      const replyPath = join(dir, "reader-reply.json")
      if (await exists(replyPath)) {
        try {
          const raw = await readFile(replyPath, "utf8")
          // Preserve the reply for triage: rename reader-reply.json →
          // reader-reply-turn-N.json instead of deleting it. The run dir
          // keeps the full reply trail alongside reader-profile-N.json.
          try { await rename(replyPath, join(dir, `reader-reply-turn-${turn}.json`)) } catch { /* best effort */ }
          // The view-server writes the reply body as JSON { reply: string } or raw text.
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

function parseResumeTarget(resume: NonNullable<RunResearchPipelineArgs["resume"]>) {
  const hashIndex = resume.runId.indexOf("#")
  if (hashIndex < 0) return resume
  return {
    ...resume,
    runId: resume.runId.slice(0, hashIndex),
    node: resume.node ?? resume.runId.slice(hashIndex + 1),
  }
}

async function resolveGraphResumeConfig(
  graph: {
    getState?: (config: unknown) => Promise<{
      config: Record<string, unknown> & { configurable?: Record<string, unknown> }
    }>
    getStateHistory?: (config: unknown) => AsyncIterable<{
      next?: string[]
      config: Record<string, unknown> & { configurable?: Record<string, unknown> }
      metadata?: Record<string, unknown>
    }>
  },
  requestId: string,
  resume: NonNullable<RunResearchPipelineArgs["resume"]>,
) {
  const baseConfig = { configurable: { thread_id: requestId } }

  if (resume.checkpointId) {
    return { configurable: { thread_id: requestId, checkpoint_id: resume.checkpointId } }
  }

  if (resume.node) {
    if (typeof graph.getStateHistory !== "function") {
      throw new Error("Graph does not support checkpoint history for node retry")
    }
    for await (const snapshot of graph.getStateHistory(baseConfig)) {
      if (snapshot.next?.includes(resume.node)) {
        const configurable = snapshot.config.configurable
        const checkpointId = configurable?.checkpoint_id
        if (typeof checkpointId !== "string") {
          throw new Error(`Checkpoint before node ${resume.node} is missing checkpoint_id`)
        }
        return { configurable: { ...configurable, thread_id: requestId, checkpoint_id: checkpointId } }
      }
    }
    throw new Error(`No checkpoint found before node "${resume.node}" for thread ${requestId}`)
  }

  const state = typeof graph.getState === "function"
    ? await graph.getState(baseConfig)
    : undefined
  const checkpointId = state?.config?.configurable?.checkpoint_id
  if (typeof checkpointId !== "string") throw new Error(`No checkpoint_id in state for thread ${requestId}`)
  return { configurable: { thread_id: requestId, checkpoint_id: checkpointId } }
}

function isDesignRelatedArtifact(filename: string) {
  return filename.startsWith("design-")
    || filename === "final.html"
    || filename.startsWith("final.html.")
    || /^cursor-(html-designer|interactive-enhancer|browser-qa-enhancer)-/.test(filename)
}

async function archiveDesignArtifacts(runDir: string) {
  const { mkdir, readdir, rename } = await import("node:fs/promises")
  const { join } = await import("node:path")
  const entries = await readdir(runDir, { withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile() && isDesignRelatedArtifact(entry.name))
  if (files.length === 0) return undefined

  const archiveDir = join(runDir, "design-archive", new Date().toISOString().replace(/[:.]/g, "-"))
  await mkdir(archiveDir, { recursive: true })
  for (const file of files) {
    await rename(join(runDir, file.name), join(archiveDir, file.name))
  }
  return { archiveDir, files: files.map((file) => file.name) }
}

export async function runResearchPipeline(args: RunResearchPipelineArgs): Promise<RunResult> {
  const { config, prerequisites, promptBundle, bus, signal } = args
  void prerequisites
  const graphFactory = args.graphFactory ?? createGraph
  const bridgeFactory = args.bridgeFactory ?? createOpencodeEventBridge
  const abortSessionFn = args.abortSessionFn ?? abortSession
  const telemetryFactory = args.telemetryFactory ?? createTelemetry

  const parsedResume = args.resume ? parseResumeTarget(args.resume) : undefined
  const resolvedResume = parsedResume ? await resolveRunForResume(parsedResume.runId, config.quorumConfig.artifactDir) : undefined
  const request = resolvedResume?.request ?? args.request
  if (!request) {
    throw new Error("runResearchPipeline requires either request or resume")
  }
  const requestId = resolvedResume?.requestId ?? crypto.randomUUID()
  let runDir: string | undefined = resolvedResume?.runDir
  let interviewRunDir: string | undefined = resolvedResume?.runDir

  const telemetry = await telemetryFactory(config, {
    requestId,
    inputMode: request.inputMode,
    topic: request.inputMode === "topic" ? request.topic : undefined,
    documentPath: request.inputMode === "document" ? request.documentPath : undefined,
  })

  const bridgeAbort = new AbortController()
  let bridgeStreamError: unknown
  let liveStatusWriter: ReturnType<typeof createLiveStatusWriter> | undefined
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
  })

  try {
    await bridge.start()

    const runResult = await telemetry.runWithRootObservation(async () => {
      bus.emit({ kind: "lifecycle", phase: "running", requestId, traceId: telemetry.traceId })

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
                liveStatusWriter = createLiveStatusWriter(bus, op, {
                  maxRounds: config.quorumConfig.maxRounds,
                }, debugLog)
                debugLog = createDebugLog(op)
                debugLogRef.current = debugLog
                debugLog.write("pipeline.start", {
                  requestId,
                  inputMode: request.inputMode,
                  topic: request.inputMode === "topic" ? request.topic : undefined,
                  documentPath: request.inputMode === "document" ? request.documentPath : undefined,
                  recursionLimit: config.quorumConfig.recursionLimit,
                  maxRounds: config.quorumConfig.maxRounds,
                  designatedDrafter: config.quorumConfig.designatedDrafter,
                  auditors: config.quorumConfig.auditors,
                  designQuorum: config.quorumConfig.designQuorum?.enabled ?? false,
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

      if (resolvedResume && parsedResume) {
        const resumeConfig = await resolveGraphResumeConfig(
          graph as unknown as Parameters<typeof resolveGraphResumeConfig>[0],
          requestId,
          parsedResume,
        )
        const checkpointId = resumeConfig.configurable.checkpoint_id
        debugLogRef.current?.write("pipeline.resume", {
          requestId,
          runDir: resolvedResume.runDir,
          checkpointId,
          node: parsedResume.node,
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
    case "result":
      return "result"
    case "design.phase":
      return `design.phase:${event.phase}:${event.round}`
    default:
      return assertNever(event)
  }
}

// ---------------------------------------------------------------------------
// Design-only pipeline (resumed from checkpoint)
// ---------------------------------------------------------------------------

export async function runDesignPipeline(args: {
  config: RuntimeConfig
  promptBundle: RuntimePromptBundle
  runId: string
  bus: EventBus
  signal?: AbortSignal
  graphFactory?: GraphFactory
  bridgeFactory?: BridgeFactory
  telemetryFactory?: (
    config: RuntimeConfig,
    input: { requestId: string; inputMode: "topic" | "document"; topic?: string; documentPath?: string },
  ) => Promise<TelemetryRun>
}) {
  const { config, promptBundle, runId, bus, signal } = args

  const resolvedRun = await resolveRunForResume(runId, config.quorumConfig.artifactDir)
  const runDir = resolvedRun.runDir
  const requestId = resolvedRun.requestId

  const graphFactory = args.graphFactory ?? createGraph
  const bridgeFactory = args.bridgeFactory ?? createOpencodeEventBridge
  const telemetryFactory = args.telemetryFactory ?? createTelemetry
  const telemetry = await telemetryFactory(config, { requestId, inputMode: "topic" })
  const actualAgentVariants = new Map<string, string>()
  const trackAgentMetadata = (input: { agent: string; sessionID: string; model?: string; variant?: string }) => {
    if (input.variant) actualAgentVariants.set(input.agent, input.variant)
    bus.emit({ kind: "agent.metadata", ...input })
  }

  const debugLog = createDebugLog(runDir)
  const liveStatusWriter = createLiveStatusWriter(bus, () => runDir, {
    maxRounds: config.quorumConfig.maxRounds,
  })
  const bridge = bridgeFactory(config, { bus, getRunDir: () => runDir })
  const bridgeAbort = new AbortController()

  if (signal) {
    if (signal.aborted) bridgeAbort.abort(signal.reason)
    else signal.addEventListener("abort", () => bridgeAbort.abort(signal.reason), { once: true })
  }

  bus.emit({ kind: "lifecycle", phase: "starting", requestId, traceId: telemetry.traceId })

  try {
    await bridge.start()
    bus.emit({ kind: "lifecycle", phase: "running", requestId, traceId: telemetry.traceId })

    const graph = graphFactory(config, promptBundle, {
      observer: {
        debugLog,
        onNodeStart(node, state) {
          bus.emit({ kind: "graph.node", node, phase: "start", state: structuredClone(state) })
        },
        onNodeEnd(node, state) {
          bus.emit({ kind: "graph.node", node, phase: "end", state: structuredClone(state) })
          if (node === "prepareOutputPath" && !debugLog) {
            // debugLog already created above
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
        trackAgentMetadata,
      },
    })

    const resumeConfig = await resolveGraphResumeConfig(
      graph as unknown as Parameters<typeof resolveGraphResumeConfig>[0],
      requestId,
      { runId, node: "runDesignHtml" },
    )
    const checkpointId = resumeConfig.configurable.checkpoint_id
    const archived = await archiveDesignArtifacts(runDir)

    debugLog.write("pipeline.design_resume", {
      requestId,
      checkpointId,
      mode: "rerun_from_html_designer",
      archiveDir: archived?.archiveDir,
      archivedFiles: archived?.files,
    })

    const result = await graph.invoke(null, {
      configurable: resumeConfig.configurable,
      recursionLimit: config.quorumConfig.recursionLimit,
      signal: bridgeAbort.signal,
    })

    bus.emit({ kind: "result", runResult: result })
    bus.emit({
      kind: "lifecycle",
      phase: "complete",
      requestId,
      traceId: telemetry.traceId,
      outputDir: (result as any).outputPath,
    })

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    debugLog.write("pipeline.error", { error: message, stack: error instanceof Error ? error.stack : undefined })
    bus.emit({ kind: "lifecycle", phase: "error", requestId, traceId: telemetry.traceId, error })
    throw error
  } finally {
    try { liveStatusWriter.dispose() } catch {}
    try { await debugLog.close() } catch {}
    try { await bridge.stop() } catch {}
    try { await telemetry.shutdown() } catch {}
  }
}
