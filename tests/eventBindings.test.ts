import { describe, expect, test } from "bun:test"
import { createEventBus, type RunnerEvent } from "../src/runner"
import { createRunStore } from "../src/tui/state/runStore"
import { bindBusToStore } from "../src/tui/state/eventBindings"
import type { RuntimeConfig } from "../src/config"

const config: RuntimeConfig = {
  env: {} as RuntimeConfig["env"],
  quorumConfig: {
    designatedDrafter: "research-drafter",
    auditors: ["source-auditor", "logic-auditor", "clarity-auditor"],
    maxRounds: 3,
    maxRebuttalTurnsPerFinding: 2,
    requireUnanimousApproval: true,
    artifactDir: "runs",
    researchTools: { prefer: ["webfetch"], webSearchProvider: "exa" },
  },
}

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

describe("bindBusToStore", () => {
  test("100 events in one tick coalesce into a single store.set with all entries in order", async () => {
    const bus = createEventBus()
    const store = createRunStore({ config })
    let setCount = 0
    const realSet = store.set.bind(store)
    store.set = (next) => {
      setCount += 1
      realSet(next)
    }
    const unbind = bindBusToStore({ bus, store, config, flushIntervalMs: 25 })

    // Seed drafter session so reasoning events are routed.
    bus.emit({ kind: "session.created", sessionID: "d-s", role: "drafter" })
    for (let i = 0; i < 100; i += 1) {
      bus.emit({ kind: "agent.reasoning", sessionID: "d-s", text: `r-${i}` })
    }

    expect(setCount).toBe(0) // nothing dispatched yet
    await delay(50)
    expect(setCount).toBe(1)
    const scrollback = store.get().agents["research-drafter"]!.scrollback
    const reasoning = scrollback.filter((s) => s.kind === "reasoning")
    expect(reasoning).toHaveLength(100)
    expect(reasoning.map((e) => e.text)).toEqual(Array.from({ length: 100 }, (_, i) => `r-${i}`))

    unbind()
  })

  test("unbind stops further dispatch", async () => {
    const bus = createEventBus()
    const store = createRunStore({ config })
    let setCount = 0
    const realSet = store.set.bind(store)
    store.set = (next) => {
      setCount += 1
      realSet(next)
    }
    const unbind = bindBusToStore({ bus, store, config, flushIntervalMs: 10 })
    bus.emit({ kind: "session.created", sessionID: "d-s", role: "drafter" })
    await delay(20)
    expect(setCount).toBe(1)

    unbind()
    bus.emit({ kind: "agent.reasoning", sessionID: "d-s", text: "after unbind" })
    await delay(20)
    expect(setCount).toBe(1)
    const reasoning = store.get().agents["research-drafter"]!.scrollback.filter((s) => s.kind === "reasoning")
    expect(reasoning).toHaveLength(0)
  })

  test("multiple flush windows produce multiple store.set calls", async () => {
    const bus = createEventBus()
    const store = createRunStore({ config })
    let setCount = 0
    const realSet = store.set.bind(store)
    store.set = (next) => {
      setCount += 1
      realSet(next)
    }
    const unbind = bindBusToStore({ bus, store, config, flushIntervalMs: 10 })

    bus.emit({ kind: "lifecycle", phase: "starting", requestId: "r" } satisfies RunnerEvent)
    await delay(20)
    bus.emit({ kind: "lifecycle", phase: "running", requestId: "r" } satisfies RunnerEvent)
    await delay(20)

    expect(setCount).toBe(2)
    expect(store.get().lifecycle.phase).toBe("running")
    unbind()
  })
})
