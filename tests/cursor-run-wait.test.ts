import { describe, expect, test } from "bun:test"

import {
  awaitCursorRunCompletion,
  isTerminalCursorRunStatus,
} from "../src/providers/cursor-run-wait"

describe("isTerminalCursorRunStatus", () => {
  test("recognizes terminal statuses", () => {
    expect(isTerminalCursorRunStatus("finished")).toBe(true)
    expect(isTerminalCursorRunStatus("completed")).toBe(true)
    expect(isTerminalCursorRunStatus("error")).toBe(true)
    expect(isTerminalCursorRunStatus("cancelled")).toBe(true)
    expect(isTerminalCursorRunStatus("running")).toBe(false)
    expect(isTerminalCursorRunStatus(undefined)).toBe(false)
  })
})

describe("awaitCursorRunCompletion", () => {
  test("returns immediately when handle status is already terminal", async () => {
    const run = {
      id: "run-1",
      agentId: "bc-agent-1",
      status: "finished" as const,
      result: "OK",
      async wait() {
        return {
          id: "run-1",
          status: "finished" as const,
          result: "OK",
        }
      },
    }

    const outcome = await awaitCursorRunCompletion({
      run: run as never,
      apiKey: "key",
      agentId: "bc-agent-1",
      isCloudAgent: true,
    })

    expect(outcome.source).toBe("handle_status")
    expect(outcome.result.status).toBe("finished")
  })

  test("uses wait() when it resolves normally", async () => {
    const run = {
      id: "run-1",
      agentId: "bc-agent-1",
      status: "running" as const,
      async wait() {
        return {
          id: "run-1",
          status: "finished" as const,
          result: "done",
        }
      },
    }

    const outcome = await awaitCursorRunCompletion({
      run: run as never,
      apiKey: "key",
      agentId: "bc-agent-1",
      isCloudAgent: true,
      sleep: async () => {},
    })

    expect(outcome.source).toBe("wait")
    expect(outcome.result.result).toBe("done")
  })

  test("falls back to getRun when wait() hangs but cloud run is terminal", async () => {
    let waitCalls = 0
    const run = {
      id: "run-1",
      agentId: "bc-agent-1",
      status: "running" as const,
      async wait() {
        waitCalls += 1
        await new Promise<void>(() => {})
        throw new Error("unreachable")
      },
    }

    const debugEvents: Array<{ type: string; data?: Record<string, unknown> }> = []
    const outcome = await awaitCursorRunCompletion({
      run: run as never,
      apiKey: "key",
      agentId: "bc-agent-1",
      isCloudAgent: true,
      sleep: async () => {},
      getRun: async () => ({
        id: "run-1",
        agentId: "bc-agent-1",
        status: "finished" as const,
        result: "from-cloud",
        async wait() {
          return {
            id: "run-1",
            status: "finished" as const,
            result: "from-cloud",
          }
        },
      }) as never,
      debugLog: {
        write(type, data) {
          debugEvents.push({ type, data })
        },
      },
    })

    expect(outcome.source).toBe("get_run")
    expect(outcome.result.result).toBe("from-cloud")
    expect(waitCalls).toBeGreaterThan(0)
    expect(debugEvents.some((event) => event.type === "cursor.run.stall_fallback")).toBe(true)
  })
})
