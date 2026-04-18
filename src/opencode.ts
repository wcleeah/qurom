import { toJsonSchema } from "@langchain/core/utils/json_schema"
import { createOpencodeClient, type Part, type Session, type TextPartInput } from "@opencode-ai/sdk/v2"
import { z } from "zod"

import type { RuntimeConfig } from "./config"

const assistantInfoSchema = z.object({
  role: z.literal("assistant"),
  structured: z.unknown().optional(),
  error: z.unknown().optional(),
})

function extractText(parts: Part[]) {
  return parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text" && !part.ignored)
    .map((part) => part.text)
    .join("\n")
    .trim()
}

export async function promptAgent<T>(input: {
  config: RuntimeConfig
  sessionID: string
  agent: string
  prompt: string
  schema?: z.ZodType<T>
  variant?: string
}) {
  const response = await createOpencodeClient({
    baseUrl: input.config.env.OPENCODE_BASE_URL,
    directory: input.config.env.OPENCODE_DIRECTORY,
  }).session.prompt({
    sessionID: input.sessionID,
    agent: input.agent,
    variant: input.variant,
    parts: [{ type: "text", text: input.prompt } satisfies TextPartInput],
    format: input.schema
      ? {
          type: "json_schema",
          schema: toJsonSchema(input.schema),
          retryCount: 1,
        }
      : undefined,
  })

  if (response.error) {
    throw new Error(
      `Failed to prompt agent ${input.agent} in session ${input.sessionID}: ${JSON.stringify(response.error)}`,
    )
  }

  if (!response.data) {
    throw new Error(`OpenCode returned no response data for agent ${input.agent} in session ${input.sessionID}`)
  }

  const info = assistantInfoSchema.parse(response.data.info)

  if (info.error) {
    throw new Error(`OpenCode assistant call failed in session ${input.sessionID}: ${JSON.stringify(info.error)}`)
  }

  return {
    text: input.schema ? undefined : extractText(response.data.parts),
    structured: input.schema ? input.schema.parse(info.structured) : undefined,
  }
}

export async function createSession(config: RuntimeConfig, title: string, parentID?: string) {
  const response = await createOpencodeClient({
    baseUrl: config.env.OPENCODE_BASE_URL,
    directory: config.env.OPENCODE_DIRECTORY,
  }).session.create({
    title,
    parentID,
  })

  if (response.error) {
    throw new Error(`Failed to create OpenCode session "${title}": ${JSON.stringify(response.error)}`)
  }

  if (!response.data) {
    throw new Error(`OpenCode returned no session payload for "${title}"`)
  }

  return response.data satisfies Session
}

export async function listAgents(config: RuntimeConfig) {
  const response = await createOpencodeClient({
    baseUrl: config.env.OPENCODE_BASE_URL,
    directory: config.env.OPENCODE_DIRECTORY,
  }).app.agents()

  if (response.error) {
    throw new Error(`Failed to query OpenCode agents from ${config.env.OPENCODE_BASE_URL}: ${JSON.stringify(response.error)}`)
  }

  if (!response.data) {
    throw new Error(`OpenCode returned no agent payload from ${config.env.OPENCODE_BASE_URL}`)
  }

  return response.data
}

export async function loadRequiredSkill(config: RuntimeConfig) {
  const response = await createOpencodeClient({
    baseUrl: config.env.OPENCODE_BASE_URL,
    directory: config.env.OPENCODE_DIRECTORY,
  }).app.skills()

  if (response.error) {
    throw new Error(`Failed to query OpenCode skills from ${config.env.OPENCODE_BASE_URL}: ${JSON.stringify(response.error)}`)
  }

  if (!response.data) {
    throw new Error(`OpenCode returned no skill payload from ${config.env.OPENCODE_BASE_URL}`)
  }

  const skill = response.data.find((entry) => entry.name === "deep-dive-research")

  if (skill) return skill

  throw new Error(
    `Missing required OpenCode skill "deep-dive-research" for drafter ${config.quorumConfig.designatedDrafter}`,
  )
}

export async function validateRuntimePrerequisites(config: RuntimeConfig) {
  const [agents, skill] = await Promise.all([listAgents(config), loadRequiredSkill(config)])
  const required = [config.quorumConfig.designatedDrafter, ...config.quorumConfig.auditors]
  const names = new Set(agents.map((entry) => entry.name))
  const missing = required.filter((name) => !names.has(name))

  if (missing.length > 0) {
    throw new Error(`Missing required OpenCode agents: ${missing.join(", ")}`)
  }

  return {
    agents,
    skill,
  }
}
