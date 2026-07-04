export type UsageTotals = {
  tokensIn: number
  tokensOut: number
}

export function emptyUsage(): UsageTotals {
  return { tokensIn: 0, tokensOut: 0 }
}

export function addUsage(target: UsageTotals, delta: UsageTotals) {
  target.tokensIn += delta.tokensIn
  target.tokensOut += delta.tokensOut
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
  return {
    tokensIn: Math.max(0, next.tokensIn - previous.tokensIn),
    tokensOut: Math.max(0, next.tokensOut - previous.tokensOut),
  }
}

export function hasUsage(total: UsageTotals): boolean {
  return total.tokensIn > 0 || total.tokensOut > 0
}
