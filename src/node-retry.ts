import { SystemicDriftError } from "./recovery-drift"

/**
 * Bounded re-execution of a LangGraph node after it throws.
 *
 * Cursor cloud agents fail spuriously (ERROR run status, transport drops).
 * Prompt-level retries in the Cursor provider only cover a single send; this
 * wrapper re-runs the whole node so a later attempt can start a fresh agent
 * call without failing the pipeline.
 *
 * Control-flow throws (LangGraph interrupt) and user abort are never retried.
 */

export interface NodeRetryInput<T> {
  node: string
  /** Extra attempts after the first failure. 0 disables retry. */
  maxRetries: number
  run: () => Promise<T>
  delayMs?: (failedAttempt: number) => number
  onRetry?: (info: {
    node: string
    attempt: number
    maxRetries: number
    error: unknown
  }) => void
}

export function isGraphControlFlowError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const name = "name" in error ? String((error as { name?: unknown }).name ?? "") : ""
  if (name === "GraphInterrupt" || name === "NodeInterrupt" || name === "GraphBubbleUp") {
    return true
  }
  return "interrupts" in error && Array.isArray((error as { interrupts?: unknown }).interrupts)
}

export function isAbortLikeError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === "object" && "name" in error && (error as { name?: unknown }).name === "AbortError") {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /the operation was aborted|this operation was aborted/i.test(message)
}

export function isRetryableNodeError(error: unknown): boolean {
  if (isGraphControlFlowError(error)) return false
  if (isAbortLikeError(error)) return false
  if (error instanceof SystemicDriftError) return false
  return true
}

export function defaultNodeRetryDelayMs(failedAttempt: number): number {
  return Math.min(8_000, 1_000 * 2 ** (failedAttempt - 1))
}

export async function runWithNodeRetry<T>(input: NodeRetryInput<T>): Promise<T> {
  const maxAttempts = Math.max(1, input.maxRetries + 1)
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await input.run()
    } catch (error) {
      const canRetry = attempt < maxAttempts && isRetryableNodeError(error)
      if (!canRetry) throw error
      input.onRetry?.({
        node: input.node,
        attempt,
        maxRetries: input.maxRetries,
        error,
      })
      const delay = input.delayMs?.(attempt) ?? 0
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
  throw new Error("runWithNodeRetry: unreachable (attempt loop exited without return)")
}
