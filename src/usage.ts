export type UsageTotals = {
  /** Uncached input tokens. Older session-telemetry files folded cache into this field. */
  tokensIn: number
  tokensOut: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  costUsd?: number
  costAvailable?: boolean
  costEstimated?: boolean
}

export function emptyUsage(): UsageTotals {
  return { tokensIn: 0, tokensOut: 0, costUsd: 0, costAvailable: false }
}

export function hasCacheBreakdown(usage: UsageTotals): boolean {
  return usage.cacheReadTokens != null || usage.cacheWriteTokens != null
}

function addOptionalCount(
  target: UsageTotals,
  delta: UsageTotals,
  field: "cacheReadTokens" | "cacheWriteTokens",
) {
  if (delta[field] == null && target[field] == null) return
  target[field] = (target[field] ?? 0) + (delta[field] ?? 0)
}

export function addUsage(target: UsageTotals, delta: UsageTotals) {
  target.tokensIn += delta.tokensIn
  target.tokensOut += delta.tokensOut
  addOptionalCount(target, delta, "cacheReadTokens")
  addOptionalCount(target, delta, "cacheWriteTokens")
  if (delta.costAvailable) {
    target.costAvailable = true
    target.costUsd = (target.costUsd ?? 0) + (delta.costUsd ?? 0)
    if (delta.costEstimated) target.costEstimated = true
  }
}

export function foldOpencodeTokens(tokens: {
  input?: number
  output?: number
  cache?: { read?: number; write?: number }
}): UsageTotals {
  const cache = tokens.cache ?? {}
  return {
    tokensIn: tokens.input ?? 0,
    tokensOut: tokens.output ?? 0,
    cacheReadTokens: cache.read ?? 0,
    cacheWriteTokens: cache.write ?? 0,
  }
}

export function foldCursorUsage(usage: {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}): UsageTotals {
  return {
    tokensIn: usage.inputTokens ?? 0,
    tokensOut: usage.outputTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  }
}

export function sumUsage(entries: Array<UsageTotals | undefined>): UsageTotals {
  const total = emptyUsage()
  for (const entry of entries) {
    if (!entry) continue
    addUsage(total, entry)
  }
  return total
}

function deltaOptionalCount(
  previous: UsageTotals,
  next: UsageTotals,
  field: "cacheReadTokens" | "cacheWriteTokens",
): number | undefined {
  if (next[field] == null && previous[field] == null) return undefined
  return Math.max(0, (next[field] ?? 0) - (previous[field] ?? 0))
}

export function usageDelta(previous: UsageTotals, next: UsageTotals): UsageTotals {
  const delta: UsageTotals = {
    tokensIn: Math.max(0, next.tokensIn - previous.tokensIn),
    tokensOut: Math.max(0, next.tokensOut - previous.tokensOut),
  }
  const cacheReadTokens = deltaOptionalCount(previous, next, "cacheReadTokens")
  const cacheWriteTokens = deltaOptionalCount(previous, next, "cacheWriteTokens")
  if (cacheReadTokens != null) delta.cacheReadTokens = cacheReadTokens
  if (cacheWriteTokens != null) delta.cacheWriteTokens = cacheWriteTokens
  if (next.costAvailable || previous.costAvailable) {
    delta.costAvailable = next.costAvailable ?? previous.costAvailable
    delta.costUsd = Math.max(0, (next.costUsd ?? 0) - (previous.costUsd ?? 0))
    if (next.costEstimated || previous.costEstimated) delta.costEstimated = true
  }
  return delta
}

export function hasUsage(total: UsageTotals): boolean {
  return total.tokensIn > 0
    || total.tokensOut > 0
    || (total.cacheReadTokens ?? 0) > 0
    || (total.cacheWriteTokens ?? 0) > 0
}

export function hasCost(total: UsageTotals): boolean {
  return total.costAvailable === true
}

/** Rough English-token estimate used for prompt accounting, not billing. */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4)
}
