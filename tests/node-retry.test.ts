import { describe, expect, test } from "bun:test"

import { SystemicDriftError } from "../src/recovery-drift"
import {
  isAbortLikeError,
  isGraphControlFlowError,
  isRetryableNodeError,
  runWithNodeRetry,
} from "../src/node-retry"

describe("node retry", () => {
  test("retries a throwing node then succeeds", async () => {
    let calls = 0
    const value = await runWithNodeRetry({
      node: "draftFullDraft",
      maxRetries: 2,
      delayMs: () => 0,
      run: async () => {
        calls += 1
        if (calls < 3) throw new Error("Cursor agent prompt failed: status=ERROR")
        return "ok"
      },
    })

    expect(value).toBe("ok")
    expect(calls).toBe(3)
  })

  test("maxRetries 0 does not retry", async () => {
    let calls = 0
    await expect(runWithNodeRetry({
      node: "runParallelAudits",
      maxRetries: 0,
      delayMs: () => 0,
      run: async () => {
        calls += 1
        throw new Error("boom")
      },
    })).rejects.toThrow("boom")
    expect(calls).toBe(1)
  })

  test("exhausts retries and rethrows the last error", async () => {
    let calls = 0
    const retries: number[] = []
    await expect(runWithNodeRetry({
      node: "reviseDraft",
      maxRetries: 1,
      delayMs: () => 0,
      onRetry: ({ attempt }) => retries.push(attempt),
      run: async () => {
        calls += 1
        throw new Error(`fail-${calls}`)
      },
    })).rejects.toThrow("fail-2")
    expect(calls).toBe(2)
    expect(retries).toEqual([1])
  })

  test("does not retry LangGraph interrupts", async () => {
    let calls = 0
    const interrupt = Object.assign(new Error("Interrupted"), {
      name: "GraphInterrupt",
      interrupts: [{ value: ["q1"] }],
    })
    await expect(runWithNodeRetry({
      node: "discoverReaderResume",
      maxRetries: 3,
      delayMs: () => 0,
      run: async () => {
        calls += 1
        throw interrupt
      },
    })).rejects.toBe(interrupt)
    expect(calls).toBe(1)
  })

  test("does not retry abort errors", async () => {
    let calls = 0
    const abort = Object.assign(new Error("The operation was aborted."), { name: "AbortError" })
    await expect(runWithNodeRetry({
      node: "draftFullDraft",
      maxRetries: 3,
      delayMs: () => 0,
      run: async () => {
        calls += 1
        throw abort
      },
    })).rejects.toBe(abort)
    expect(calls).toBe(1)
  })

  test("classifies control-flow and abort errors", () => {
    expect(isGraphControlFlowError({ name: "GraphInterrupt", interrupts: [] })).toBe(true)
    expect(isAbortLikeError(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }))).toBe(true)
    expect(isRetryableNodeError(new Error("Cursor agent prompt failed"))).toBe(true)
    expect(isRetryableNodeError({ name: "GraphInterrupt", interrupts: [] })).toBe(false)
    expect(isRetryableNodeError(new SystemicDriftError({
      agent: "source-auditor",
      requestIds: ["a", "b"],
      secondRunFault: "schema",
    }))).toBe(false)
  })
})
