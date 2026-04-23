import { createSession, promptAgent } from "./opencode"

import type { RuntimeConfig } from "./config"
import { markdownSummarySchema, type MarkdownSummary } from "./schema"
import type { TelemetryRun, TraceObservation } from "./telemetry"

function inputPrompt(markdown: string) {
  return [
    "Summarize this markdown document for run metadata.",
    "Return a short title, a concise 1-2 sentence summary, and a short slug hint suitable for a folder name.",
    "The slug hint should be plain words only, not a filesystem path.",
    "Markdown:",
    markdown,
  ].join("\n\n")
}

function artifactPrompt(markdown: string) {
  return [
    "Summarize this markdown artifact for the run summary screen.",
    "Return a short title and a concise 1-2 sentence summary.",
    "You may include a slug hint, but it is optional.",
    "Markdown:",
    markdown,
  ].join("\n\n")
}

export async function summarizeMarkdown(input: {
  config: RuntimeConfig
  title: string
  markdown: string
  mode: "input" | "artifact"
  telemetry?: {
    run: TelemetryRun
    parentObservation?: TraceObservation
    trackSessionObservation?: (sessionID: string, observation: TraceObservation | undefined) => void
    name: string
    metadata?: Record<string, unknown>
  }
}): Promise<MarkdownSummary> {
  const session = await createSession(input.config, input.title)
  const response = await promptAgent({
    config: input.config,
    sessionID: session.id,
    agent: input.config.quorumConfig.summarizerAgent,
    prompt: input.mode === "input" ? inputPrompt(input.markdown) : artifactPrompt(input.markdown),
    schema: markdownSummarySchema,
    telemetry: input.telemetry
      ? {
          run: input.telemetry.run,
          parentObservation: input.telemetry.parentObservation,
          trackSessionObservation: input.telemetry.trackSessionObservation,
          name: input.telemetry.name,
          metadata: {
            agentName: input.config.quorumConfig.summarizerAgent,
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
