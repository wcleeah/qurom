import type { RuntimeConfig } from "./config"
import { loadPromptAssetsFromStore } from "./config-store"
import { SUMMARIZER_ROLE } from "./role-registry"
import { createAgentRuntime, type AgentRuntime } from "./agent-runtime/runtime"
import { markdownSummarySchema, type MarkdownSummary } from "./schema"
import type { TelemetryRun, TraceObservation } from "./telemetry"

export async function summarizeMarkdown(input: {
  config: RuntimeConfig
  title: string
  markdown: string
  mode: "input" | "artifact"
  runtime?: AgentRuntime
  telemetry?: {
    run: TelemetryRun
    parentObservation?: TraceObservation
    trackSessionObservation?: (sessionID: string, observation: TraceObservation | undefined) => void
    trackAgentMetadata?: (input: { agent: string; sessionID: string; model?: string; variant?: string }) => void
    name: string
    metadata?: Record<string, unknown>
  }
}): Promise<MarkdownSummary> {
  const runtime = input.runtime ?? createAgentRuntime(input.config)
  const role = SUMMARIZER_ROLE
  const handle = await runtime.createHandle(role, input.title)
  const assets = await loadPromptAssetsFromStore(input.config.env)
  const template = input.mode === "input"
    ? assets.markdownSummarizerInput
    : assets.markdownSummarizerArtifact
  const prompt = template.replaceAll("{markdown}", input.markdown)
  const response = await runtime.prompt({
    role,
    handle,
    prompt,
    schema: markdownSummarySchema,
    telemetry: input.telemetry
      ? {
          run: input.telemetry.run,
          parentObservation: input.telemetry.parentObservation,
          trackSessionObservation: input.telemetry.trackSessionObservation,
          trackAgentMetadata: input.telemetry.trackAgentMetadata,
          name: input.telemetry.name,
          metadata: {
            agentName: SUMMARIZER_ROLE,
            sessionId: handle.id,
            mode: input.mode,
            ...input.telemetry.metadata,
          },
        }
      : undefined,
  })

  return response.structured ?? markdownSummarySchema.parse({
    title: "Untitled",
    summary: "",
  })
}
