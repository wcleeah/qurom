import { basename } from "node:path"

import { createAgentRuntime, type AgentRuntime } from "./agent-runtime/runtime"
import type { RuntimeConfig } from "./config"
import { createArticleTagsResultSchema, type ArticleTagEntry, type ArticleTagsResult } from "./schema"
import { TAGGER_ROLE } from "./role-registry"
import { replaceAgentArticleTags, syncPredefinedTags, writeArticleTagsArtifact } from "./tags-store"
import type { TelemetryRun, TraceObservation } from "./telemetry"

function tagArticlePrompt(input: {
  markdown: string
  topic?: string
  predefinedTags: string[]
  maxArticleTags: number
}) {
  const predefinedBlock = input.predefinedTags.length > 0
    ? [
        "Predefined tag slugs (exact match only when matchedPredefined is true):",
        JSON.stringify(input.predefinedTags),
        "",
        "Rules for predefined tags:",
        "- Include a predefined slug only when the article clearly fits that tag.",
        "- When you include a predefined slug, set matchedPredefined to true and use the slug string exactly.",
        "- Do not paraphrase or alter predefined slugs.",
        "- If a predefined slug does not fit, omit it.",
        "- You may add generated tags (matchedPredefined: false) for important themes not covered by predefined tags.",
      ].join("\n")
    : [
        "No predefined tags were configured.",
        "Generate topic tags from the article (matchedPredefined must be false for every tag).",
      ].join("\n")

  return [
    "Analyze this approved research article and assign topic tags.",
    `Return at most ${input.maxArticleTags} tags.`,
    "",
    predefinedBlock,
    "",
    "Generated tag rules:",
    "- slug must be lowercase hyphenated ASCII: /^[a-z0-9]+(?:-[a-z0-9]+)*$/",
    "- label is a short human-readable name",
    "- matchedPredefined false means the tag is newly generated",
    "- No duplicate slugs",
    "",
    input.topic ? `Article topic: ${input.topic}` : "",
    "",
    "Markdown article:",
    input.markdown,
  ].filter(Boolean).join("\n")
}

export async function tagArticle(input: {
  config: RuntimeConfig
  runName: string
  outputPath: string
  markdown: string
  topic?: string
  runtime?: AgentRuntime
  telemetry?: {
    run: TelemetryRun
    parentObservation?: TraceObservation
    trackSessionObservation?: (sessionID: string, observation: TraceObservation | undefined) => void
    trackAgentMetadata?: (input: { agent: string; sessionID: string; model?: string; variant?: string }) => void
    name?: string
    metadata?: Record<string, unknown>
  }
}): Promise<ArticleTagsResult> {
  const tagging = input.config.quorumConfig.tagging ?? {
    enabled: true,
    maxArticleTags: 8,
    maxNoteTags: 8,
    predefinedTags: [],
  }
  const predefinedTags = tagging.predefinedTags ?? []
  await syncPredefinedTags(predefinedTags)

  const runtime = input.runtime ?? createAgentRuntime(input.config)
  const role = TAGGER_ROLE
  const handle = await runtime.createHandle(role, `tag-article:${input.runName}`)
  const schema = createArticleTagsResultSchema({
    predefinedTags,
    maxArticleTags: tagging.maxArticleTags ?? 8,
  })

  const response = await runtime.prompt({
    role,
    handle,
    prompt: tagArticlePrompt({
      markdown: input.markdown,
      topic: input.topic,
      predefinedTags,
      maxArticleTags: tagging.maxArticleTags ?? 8,
    }),
    schema,
    telemetry: input.telemetry
      ? {
          run: input.telemetry.run,
          parentObservation: input.telemetry.parentObservation,
          trackSessionObservation: input.telemetry.trackSessionObservation,
          trackAgentMetadata: input.telemetry.trackAgentMetadata,
          name: input.telemetry.name ?? "agent.tagOutputArtifact",
          metadata: {
            agentName: TAGGER_ROLE,
            sessionId: handle.id,
            runName: input.runName,
            ...input.telemetry.metadata,
          },
        }
      : undefined,
  })

  const result = response.structured ?? schema.parse({ tags: [] })
  await persistArticleTags({
    runName: input.runName,
    outputPath: input.outputPath,
    tags: result.tags,
  })
  return result
}

export async function persistArticleTags(input: {
  runName: string
  outputPath: string
  tags: ArticleTagEntry[]
}): Promise<void> {
  await replaceAgentArticleTags(input.runName, input.tags)
  await writeArticleTagsArtifact(input.outputPath, input.runName, input.tags)
}

export async function tagOutputArtifact(
  config: RuntimeConfig,
  state: {
    status: string
    outputPath?: string
    requestId: string
    topic?: string
    inputMode?: string
    documentText?: string
  },
  telemetry?: {
    run: TelemetryRun
    parentObservation?: TraceObservation
    trackSessionObservation?: (sessionID: string, observation: TraceObservation | undefined) => void
    trackAgentMetadata?: (input: { agent: string; sessionID: string; model?: string; variant?: string }) => void
    debugLog?: { write: (event: string, payload: Record<string, unknown>) => void }
  },
  runtime = createAgentRuntime(config),
): Promise<void> {
  const tagging = config.quorumConfig.tagging
  if (!tagging?.enabled) return
  if (state.status !== "approved" || !state.outputPath) return

  const artifactPath = `${state.outputPath}/final.md`
  const artifactFile = Bun.file(artifactPath)
  if (!(await artifactFile.exists())) return

  const topic = state.inputMode === "topic"
    ? state.topic
    : state.documentText ?? state.topic

  const runName = basename(state.outputPath)

  try {
    const result = await tagArticle({
      config,
      runName,
      outputPath: state.outputPath,
      markdown: await artifactFile.text(),
      topic,
      runtime,
      telemetry: telemetry
        ? {
            run: telemetry.run,
            parentObservation: telemetry.parentObservation,
            trackSessionObservation: telemetry.trackSessionObservation,
            trackAgentMetadata: telemetry.trackAgentMetadata,
            name: "agent.tagOutputArtifact",
            metadata: { requestId: state.requestId },
          }
        : undefined,
    })
    telemetry?.debugLog?.write("article.tagged", {
      requestId: state.requestId,
      tagCount: result.tags.length,
      slugs: result.tags.map((tag) => tag.slug),
    })
  } catch (error) {
    telemetry?.debugLog?.write("article.tag_failed", {
      requestId: state.requestId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
