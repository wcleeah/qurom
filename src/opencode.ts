import { createOpencodeClient } from "@opencode-ai/sdk/v2"

import type { RuntimeConfig } from "./config"

export function createClient(config: RuntimeConfig) {
  return createOpencodeClient({
    baseUrl: config.env.OPENCODE_BASE_URL,
    directory: config.env.OPENCODE_DIRECTORY,
  })
}

export async function verifyRequiredSkill(config: RuntimeConfig) {
  const client = createClient(config)
  const response = await client.app.skills()

  if (response.error) {
    throw new Error(
      `Failed to query OpenCode skills from ${config.env.OPENCODE_BASE_URL}: ${JSON.stringify(response.error)}`,
    )
  }

  if (!response.data) {
    throw new Error(`OpenCode returned no skill payload from ${config.env.OPENCODE_BASE_URL}`)
  }

  const skill = response.data.find((entry) => entry.name === "deep-dive-research")

  if (skill) return skill

  throw new Error(
    `Missing required OpenCode skill \"deep-dive-research\" for drafter ${config.quorumConfig.designatedDrafter}`,
  )
}
