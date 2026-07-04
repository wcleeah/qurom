import type { RuntimeConfig } from "./config"
import { loadPromptAssetsFromStore, loadRoleInstructionsFromStore } from "./config-store"
import type { PromptAssetKey } from "./prompt-asset-defs"

export type PromptBundle = {
  source: "sqlite"
  assets: Record<PromptAssetKey, string>
  roleInstructions: Record<string, string>
}

export async function loadPromptBundle(config: RuntimeConfig): Promise<PromptBundle> {
  const assets = await loadPromptAssetsFromStore(config.env)
  const roleInstructions = await loadRoleInstructionsFromStore(config.env)
  return {
    source: "sqlite",
    assets,
    roleInstructions,
  }
}
