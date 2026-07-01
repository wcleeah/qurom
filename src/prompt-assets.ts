import { join } from "node:path"

import type { RuntimeConfig } from "./config"
import { loadPromptAssetsFromStore } from "./config-store"
import { promptAssetFiles, type PromptAssetKey } from "./prompt-asset-defs"

export type PromptBundle = {
  source: "sqlite" | "local"
  label: string
  dir: string
  assets: Record<PromptAssetKey, string>
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

export async function loadPromptBundle(config: RuntimeConfig): Promise<PromptBundle> {
  if (config.quorumConfig.promptManagement.source !== "local") {
    throw new Error(
      `Unsupported prompt management source ${JSON.stringify(config.quorumConfig.promptManagement.source)}. Only \"local\" is implemented.`,
    )
  }

  const dir = join(config.env.QUORUM_WORKSPACE_DIRECTORY, config.quorumConfig.promptAssetsDir)
  let assets: Record<PromptAssetKey, string>
  try {
    assets = await loadPromptAssetsFromStore(config.env)
  } catch (error) {
    console.warn(`[config] Falling back to file prompt assets: ${error instanceof Error ? error.message : String(error)}`)
    assets = {} as Record<PromptAssetKey, string>
    for (const [key, filename] of Object.entries(promptAssetFiles)) {
      assets[key as PromptAssetKey] = await readPromptAsset(join(dir, filename), filename)
    }
    return {
      source: "local",
      label: config.quorumConfig.promptManagement.label,
      dir,
      assets,
    }
  }

  return {
    source: "sqlite",
    label: config.quorumConfig.promptManagement.label,
    dir,
    assets,
  }
}
