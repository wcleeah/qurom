import { describe, expect, test } from "bun:test"
import { createEventBus, type RunnerEvent } from "../src/runner"
import { createRunStore } from "../src/tui/state/runStore"
import { bindBusToStore } from "../src/tui/state/eventBindings"

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

describe("bindBusToStore", () => {
  test("100 events in one tick coalesce into a single store.setState with all updates applied", async () => {
    const bus = createEventBus()
    const store = createRunStore()
    let setCount = 0
    const realSet = store.setState.bind(store)
    store.setState = ((next: Parameters<typeof store.setState>[0]) => {
      setCount += 1
      realSet(next)
    }) as typeof store.setState
    const binding = bindBusToStore({ bus, store, flushIntervalMs: 25 })

    bus.emit({ kind: "session.created", sessionID: "d-s", role: "research-drafter" })
    for (let i = 0; i < 100; i += 1) {
      bus.emit({
        kind: "agent.tool",
        tool: `tool-${i}`,
        status: "running",
        callID: `c-${i}`,
        sessionID: "d-s",
        messageID: "m-1",
        partID: `p-${i}`,
      })
    }

    expect(setCount).toBe(0)
    await delay(50)
    expect(setCount).toBe(1)
    expect(store.getState().agents["research-drafter"]?.tool).toBe("tool-99")

    binding.unbind()
  })

  test("unbind stops further dispatch", async () => {
    const bus = createEventBus()
    const store = createRunStore()
    let setCount = 0
    const realSet = store.setState.bind(store)
    store.setState = ((next: Parameters<typeof store.setState>[0]) => {
      setCount += 1
      realSet(next)
    }) as typeof store.setState
    const binding = bindBusToStore({ bus, store, flushIntervalMs: 10 })
    bus.emit({ kind: "session.created", sessionID: "d-s", role: "research-drafter" })
    await delay(20)
    expect(setCount).toBe(1)

    binding.unbind()
    bus.emit({ kind: "session.status", sessionID: "d-s", status: "active" })
    await delay(20)
    expect(setCount).toBe(1)
    expect(store.getState().agents["research-drafter"]?.status).toBe("idle")
  })

  test("multiple flush windows produce multiple store.setState calls", async () => {
    const bus = createEventBus()
    const store = createRunStore()
    let setCount = 0
    const realSet = store.setState.bind(store)
    store.setState = ((next: Parameters<typeof store.setState>[0]) => {
      setCount += 1
      realSet(next)
    }) as typeof store.setState
    const unbind = bindBusToStore({ bus, store, flushIntervalMs: 10 })

    bus.emit({ kind: "lifecycle", phase: "starting", requestId: "r" } satisfies RunnerEvent)
    await delay(20)
    bus.emit({ kind: "lifecycle", phase: "running", requestId: "r" } satisfies RunnerEvent)
    await delay(20)

    expect(setCount).toBe(2)
    expect(store.getState().lifecycle.phase).toBe("running")
    unbind.unbind()
  })

  test("flushAndUnbind preserves pending final result events", () => {
    const bus = createEventBus()
    const store = createRunStore()
    const binding = bindBusToStore({ bus, store, flushIntervalMs: 10_000 })

    bus.emit({
      kind: "result",
      runResult: {
        status: "approved",
        round: 1,
        approvedAgents: ["source-auditor", "logic-auditor", "clarity-auditor"],
        unresolvedFindings: [],
      },
    })
    bus.emit({ kind: "lifecycle", phase: "complete", requestId: "req-final", outputDir: "runs/final" })

    binding.flushAndUnbind()

    expect(store.getState().result).toEqual({
      status: "approved",
      round: 1,
      approvedAgents: ["source-auditor", "logic-auditor", "clarity-auditor"],
      unresolvedFindings: [],
    })
    expect(store.getState().lifecycle.phase).toBe("complete")
    expect(store.getState().lifecycle.outputDir).toBe("runs/final")
  })
})
