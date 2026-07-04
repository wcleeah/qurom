import pricingTable from "../defaults/cursor-model-pricing.json"

export type CursorRawUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export type CursorModelPricingEntry = {
  name: string
  docSlug: string
  input: number
  output: number
  cache: {
    read: number
    write?: number
  }
  modelIdSource?: string
}

export type CursorModelPricingFile = {
  source: string
  syncedAt: string
  unit: string
  note: string
  auto: {
    input: number
    output: number
    cache: { read: number; write: number }
    note?: string
  }
  models: Record<string, CursorModelPricingEntry>
}

const table = pricingTable as CursorModelPricingFile

export function getCursorModelPricingTable(): CursorModelPricingFile {
  return table
}

export function estimateCursorCostUsd(
  modelId: string | undefined,
  raw: CursorRawUsage,
): { costUsd: number; costAvailable: boolean; costEstimated: boolean } {
  if (!modelId) return { costUsd: 0, costAvailable: false, costEstimated: true }

  const entry = table.models[modelId]
  if (!entry) return { costUsd: 0, costAvailable: false, costEstimated: true }

  const inputTokens = raw.inputTokens ?? 0
  const outputTokens = raw.outputTokens ?? 0
  const cacheReadTokens = raw.cacheReadTokens ?? 0
  const cacheWriteTokens = raw.cacheWriteTokens ?? 0
  const cacheWriteRate = entry.cache.write ?? entry.input

  const costUsd =
    (inputTokens * entry.input) / 1_000_000
    + (outputTokens * entry.output) / 1_000_000
    + (cacheReadTokens * entry.cache.read) / 1_000_000
    + (cacheWriteTokens * cacheWriteRate) / 1_000_000

  return { costUsd, costAvailable: true, costEstimated: true }
}
