import { join } from "node:path"

import type { RuntimeConfig } from "./config"

const promptAssetFiles = {
  deepDiveContract: "deep-dive-contract.md",
  draftOutline: "draft-outline.md",
  draftSection: "draft-section.md",
  stitchDraft: "stitch-draft.md",
  reviseDraft: "revise-draft.md",
  audit: "audit.md",
  reviewFindings: "review-findings.md",
  rebuttal: "rebuttal.md",
  reviewRebuttalResponses: "review-rebuttal-responses.md",
} as const

export type PromptAssetKey = keyof typeof promptAssetFiles

export type PromptBundle = {
  source: "local"
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

  const dir = join(config.env.OPENCODE_DIRECTORY, config.quorumConfig.promptAssetsDir)
  const assets = {} as Record<PromptAssetKey, string>

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
