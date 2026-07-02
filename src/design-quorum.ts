import { createAgentRuntime, type AgentRuntime } from "./agent-runtime/runtime"
import type { AgentRunHandle } from "./providers/types"
import type { RuntimeConfig } from "./config"
import type { PromptBundle } from "./prompt-assets"
import type { TelemetryRun, TraceObservation } from "./telemetry"

import type { DebugLog } from "./debug-log"

export type RunObserver = {
  debugLog?: DebugLog
  onSessionCreated?: (input: { sessionID: string; role: string; requestId: string }) => void
  onDesignPhase?: (phase: "drafting" | "enhancing" | "finalizing" | "browser_qa", round: number) => void
}

type DesignTelemetry = {
  run: TelemetryRun
  parentObservation?: TraceObservation
  trackSessionObservation?: (sessionID: string, observation: TraceObservation | undefined) => void
  trackAgentMetadata?: (input: { agent: string; sessionID: string; model?: string; variant?: string }) => void
}

function observeDesignSession(
  observer: RunObserver | undefined,
  input: { sessionID: string; role: string; requestId: string },
) {
  observer?.onSessionCreated?.(input)
}

async function ensureTextArtifact(path: string, text: string | undefined, label: string) {
  const file = Bun.file(path)
  if (await file.exists()) return file.text()
  if (text && text.trim() && text.trim() !== "OK") {
    await Bun.write(path, text)
    return text
  }
  throw new Error(`Missing ${label} artifact at ${path}; provider returned no inline content to persist`)
}

async function createObservedDesignHandle(input: {
  runtime: AgentRuntime
  role: string
  title: string
  observer?: RunObserver
  displayRole?: string
}): Promise<AgentRunHandle> {
  const handle = await input.runtime.createHandle(input.role, input.title)
  observeDesignSession(input.observer, {
    sessionID: handle.id,
    role: input.displayRole ?? input.role,
    requestId: "",
  })
  return handle
}

function designAgentTelemetry(input: {
  telemetry: DesignTelemetry | undefined
  name: string
  agentName: string
  sessionId: string
  type?: "Span" | "Agent" | "Chain" | "Evaluator" | "Generation" | "Tool"
  inputPayload?: unknown
  metadata?: Record<string, unknown>
}) {
  if (!input.telemetry) return undefined

  return {
    run: input.telemetry.run,
    parentObservation: input.telemetry.parentObservation,
    name: input.name,
    type: input.type ?? "Agent",
    input: input.inputPayload ?? {},
    metadata: {
      agentName: input.agentName,
      sessionId: input.sessionId,
      ...input.metadata,
    },
    trackSessionObservation: input.telemetry.trackSessionObservation,
    trackAgentMetadata: input.telemetry.trackAgentMetadata,
  }
}

export async function designHtml(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  markdownFile: string,
  topic: string,
  outputFile: string,
  telemetry?: DesignTelemetry,
  observer?: RunObserver,
  runtime = createAgentRuntime(config),
) {
  const role = config.quorumConfig.designQuorum!.designatedDesigner
  const handle = await createObservedDesignHandle({
    runtime,
    role,
    title: "html-designer",
    observer,
    displayRole: "html-designer",
  })

  const prompt = promptBundle.assets.designHtml
    .replace("{topic}", topic)

  const response = await runtime.prompt({
    role,
    handle,
    prompt,
    outputFile,
    inputFiles: [
      { path: markdownFile, mime: "text/plain", filename: "content.md" },
    ],
    telemetry: designAgentTelemetry({
      telemetry,
      name: "agent.designHtml",
      agentName: role,
      sessionId: handle.id,
      inputPayload: { topic },
    }),
  })

  return ensureTextArtifact(outputFile, response.text, "design HTML")
}
