export type UsageTotals = {
  tokensIn: number
  tokensOut: number
  costUsd?: number
  costAvailable?: boolean
  costEstimated?: boolean
}

export function emptyUsage(): UsageTotals {
  return { tokensIn: 0, tokensOut: 0, costUsd: 0, costAvailable: false }
}

export function addUsage(target: UsageTotals, delta: UsageTotals) {
  target.tokensIn += delta.tokensIn
  target.tokensOut += delta.tokensOut
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
    tokensIn: (tokens.input ?? 0) + (cache.read ?? 0) + (cache.write ?? 0),
    tokensOut: tokens.output ?? 0,
  }
}

export function foldCursorUsage(usage: {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}): UsageTotals {
  return {
    tokensIn: (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
    tokensOut: usage.outputTokens ?? 0,
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

export function usageDelta(previous: UsageTotals, next: UsageTotals): UsageTotals {
  const delta: UsageTotals = {
    tokensIn: Math.max(0, next.tokensIn - previous.tokensIn),
    tokensOut: Math.max(0, next.tokensOut - previous.tokensOut),
  }
  if (next.costAvailable || previous.costAvailable) {
    delta.costAvailable = next.costAvailable ?? previous.costAvailable
    delta.costUsd = Math.max(0, (next.costUsd ?? 0) - (previous.costUsd ?? 0))
    if (next.costEstimated || previous.costEstimated) delta.costEstimated = true
  }
  return delta
}

export function hasUsage(total: UsageTotals): boolean {
  return total.tokensIn > 0 || total.tokensOut > 0
}

export function hasCost(total: UsageTotals): boolean {
  return total.costAvailable === true
}
