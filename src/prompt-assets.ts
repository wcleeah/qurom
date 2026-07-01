import { join } from "node:path"
import { readdir } from "node:fs/promises"

import type { RuntimeConfig } from "./config"
import { promptAssetFiles, type PromptAssetKey } from "./prompt-asset-defs"

export type PromptBundle = {
  source: "sqlite" | "local"
  label: string
  dir: string
  assets: Record<PromptAssetKey, string>
  roleInstructions?: Record<string, string>
}

async function readPromptAsset(filePath: string, label: string) {
  const file = Bun.file(filePath)

  if (!(await file.exists())) {
    throw new Error(`Missing required prompt asset ${JSON.stringify(label)} at ${filePath}`)
  }

  const content = (await file.text()).trim()

  if (!content) {
    throw new Error(`Prompt asset ${JSON.stringify(label)} is empty at ${filePath}`)
  }

  return content
}

async function loadRoleInstructions(config: RuntimeConfig) {
  const rolesDir = join(config.env.QUORUM_WORKSPACE_DIRECTORY, "assets", "roles")
  const roles: Record<string, string> = {}
  try {
    const entries = await readdir(rolesDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue
      const role = entry.name.replace(/\.md$/, "")
      roles[role] = await readPromptAsset(join(rolesDir, entry.name), entry.name)
    }
  } catch (error) {
    console.warn(`[config] No provider-neutral role instructions loaded: ${error instanceof Error ? error.message : String(error)}`)
  }
  return roles
}

export async function loadPromptBundle(config: RuntimeConfig): Promise<PromptBundle> {
  if (config.quorumConfig.promptManagement.source !== "local") {
    throw new Error(
      `Unsupported prompt management source ${JSON.stringify(config.quorumConfig.promptManagement.source)}. Only \"local\" is implemented.`,
    )
  }

  const dir = join(config.env.QUORUM_WORKSPACE_DIRECTORY, config.quorumConfig.promptAssetsDir)
  const roleInstructions = await loadRoleInstructions(config)
  const assets = {} as Record<PromptAssetKey, string>
  for (const [key, filename] of Object.entries(promptAssetFiles)) {
    assets[key as PromptAssetKey] = await readPromptAsset(join(dir, filename), filename)
  }

  return {
    source: "local",
    label: config.quorumConfig.promptManagement.label,
    dir,
    assets,
    roleInstructions,
  }
}
