import type { RuntimeConfig } from "./config"
import { loadPromptAssetsFromStore } from "./config-store"
import { promptAssetDefs, type PromptAssetKey } from "./prompt-asset-defs"

export type PromptBundle = {
  source: "sqlite"
  assets: Record<PromptAssetKey, string>
}

export async function loadPromptBundle(config: RuntimeConfig): Promise<PromptBundle> {
  const assets = await loadPromptAssetsFromStore(config.env)
  return {
    source: "sqlite",
    assets,
  }
}

/** Test helper: prompt bundle with empty strings for every asset key. */
export function emptyPromptBundle(overrides: Partial<Record<PromptAssetKey, string>> = {}): PromptBundle {
  const assets = {} as Record<PromptAssetKey, string>
  for (const key of Object.keys(promptAssetDefs) as PromptAssetKey[]) {
    assets[key] = overrides[key] ?? ""
  }
  return { source: "sqlite", assets }
}
