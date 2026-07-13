import { Agent, type Run, type RunResult } from "@cursor/sdk"

export type CursorRunCompletionSource = "wait" | "handle_status" | "get_run"

const WAIT_AFTER_TERMINAL_MS = 15_000
const POLL_INTERVAL_INITIAL_MS = 3_000
const POLL_INTERVAL_MAX_MS = 15_000

export function isTerminalCursorRunStatus(status: string | undefined): boolean {
  return status === "finished"
    || status === "completed"
    || status === "error"
    || status === "cancelled"
}

function buildRunResultFromHandle(run: Run): RunResult {
  const status = run.status
  if (!isTerminalCursorRunStatus(status)) {
    throw new Error(`Cursor run ${run.id} is not terminal (status=${status ?? "unknown"})`)
  }
  return {
    id: run.id,
    requestId: run.requestId,
    status,
    result: run.result,
    model: run.model,
    durationMs: run.durationMs,
    usage: run.usage,
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function resolveTerminalRun(input: {
  run: Run
  source: Exclude<CursorRunCompletionSource, "wait">
  debugLog?: { write: (type: string, data?: Record<string, unknown>) => void }
  meta: Record<string, unknown>
}): Promise<{ result: RunResult; source: Exclude<CursorRunCompletionSource, "wait"> }> {
  input.debugLog?.write("cursor.run.stall_fallback", {
    ...input.meta,
    source: input.source,
  })
  try {
    const result = await withTimeout(
      input.run.wait(),
      WAIT_AFTER_TERMINAL_MS,
      `Cursor run.wait() did not return within ${WAIT_AFTER_TERMINAL_MS}ms after terminal status`,
    )
    return { result, source: input.source }
  } catch {
    return { result: buildRunResultFromHandle(input.run), source: input.source }
  }
}

export async function awaitCursorRunCompletion(input: {
  run: Run
  apiKey: string
  agentId: string
  isCloudAgent: boolean
  debugLog?: { write: (type: string, data?: Record<string, unknown>) => void }
  getRun?: typeof Agent.getRun
  sleep?: (ms: number) => Promise<void>
}): Promise<{ result: RunResult; source: CursorRunCompletionSource }> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  if (isTerminalCursorRunStatus(input.run.status)) {
    const result = await input.run.wait()
    return { result, source: "handle_status" }
  }

  let settled = false

  const waitOutcome = input.run.wait()
    .then((result) => {
      settled = true
      return { source: "wait" as const, result }
    })
    .catch((error) => {
      settled = true
      throw error
    })

  const pollOutcome = (async () => {
    let intervalMs = POLL_INTERVAL_INITIAL_MS
    while (!settled) {
      if (isTerminalCursorRunStatus(input.run.status)) {
        return resolveTerminalRun({
          run: input.run,
          source: "handle_status",
          debugLog: input.debugLog,
          meta: {
            runId: input.run.id,
            agentId: input.agentId,
            observedStatus: input.run.status,
          },
        })
      }

      if (input.isCloudAgent) {
        try {
          const getRun = input.getRun ?? Agent.getRun?.bind(Agent)
          if (typeof getRun !== "function") {
            throw new Error("Agent.getRun is unavailable")
          }
          const remote = await getRun(input.run.id, {
            runtime: "cloud",
            apiKey: input.apiKey,
            agentId: input.agentId,
          })
          if (settled) break
          if (isTerminalCursorRunStatus(remote.status)) {
            return resolveTerminalRun({
              run: remote,
              source: "get_run",
              debugLog: input.debugLog,
              meta: {
                runId: input.run.id,
                agentId: input.agentId,
                observedStatus: remote.status,
                localStatus: input.run.status,
              },
            })
          }
        } catch {
          // Transient getRun failures should not abort a long-running prompt.
        }
      }

      await sleep(intervalMs)
      intervalMs = Math.min(Math.round(intervalMs * 1.5), POLL_INTERVAL_MAX_MS)
    }

    await new Promise<void>(() => {})
  })()

  return Promise.race([waitOutcome, pollOutcome])
}
