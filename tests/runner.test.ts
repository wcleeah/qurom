import { describe, expect, test } from "bun:test"

import {
  type Bridge,
  type BridgeFactory,
  type EventBus,
  type RunnerEvent,
  createEventBus,
  describeRunnerEvent,
  runQuorum,
} from "../src/runner.ts"
import type { RuntimeConfig } from "../src/config.ts"
import type { TelemetryRun } from "../src/telemetry.ts"

const config: RuntimeConfig = {
  env: {
    OPENCODE_BASE_URL: "http://127.0.0.1:4096",
    OPENCODE_DIRECTORY: process.cwd(),
    QUORUM_CHECKPOINT_PATH: "runs/checkpoints.sqlite",
    QUORUM_CAPTURE_OPENCODE_EVENTS: "0",
    QUORUM_CAPTURE_SYNC_HISTORY: "0",
    LANGFUSE_PUBLIC_KEY: undefined,
    LANGFUSE_SECRET_KEY: undefined,
    LANGFUSE_BASE_URL: undefined,
  },
  quorumConfig: {
    designatedDrafter: "research-drafter",
    auditors: ["source-auditor"],
    maxRounds: 1,
    maxRebuttalTurnsPerFinding: 1,
    requireUnanimousApproval: true,
    artifactDir: "runs",
    researchTools: { prefer: ["webfetch"], webSearchProvider: "exa" },
  },
}

function disabledTelemetry(): TelemetryRun {
  return {
    enabled: false,
    runWithRootObservation: async (fn) => fn(),
    startObservation: async () => undefined,
    endObservation: async () => {},
    updateTrace: async () => {},
    shutdown: async () => {},
  }
}

describe("createEventBus", () => {
  test("delivers an event to all subscribed listeners exactly once", () => {
    const bus = createEventBus()
    const calls: string[] = []
    bus.on((event) => calls.push(`a:${describeRunnerEvent(event)}`))
    bus.on((event) => calls.push(`b:${describeRunnerEvent(event)}`))

    bus.emit({ kind: "lifecycle", phase: "starting", requestId: "req-1" })

    expect(calls).toEqual(["a:lifecycle:starting", "b:lifecycle:starting"])
  })

  test("off() returned from on() removes the listener", () => {
    const bus = createEventBus()
    const calls: string[] = []
    const off = bus.on((event) => calls.push(describeRunnerEvent(event)))

    bus.emit({ kind: "lifecycle", phase: "starting", requestId: "req-1" })
    off()
    bus.emit({ kind: "lifecycle", phase: "complete", requestId: "req-1" })

    expect(calls).toEqual(["lifecycle:starting"])
  })

  test("bus.off(listener) also detaches", () => {
    const bus = createEventBus()
    const calls: string[] = []
    const listener = (event: RunnerEvent) => calls.push(describeRunnerEvent(event))
    bus.on(listener)

    bus.emit({ kind: "lifecycle", phase: "starting", requestId: "req-1" })
    bus.off(listener)
    bus.emit({ kind: "lifecycle", phase: "complete", requestId: "req-1" })

    expect(calls).toEqual(["lifecycle:starting"])
  })

  test("a throwing listener does not prevent the next listener from running", () => {
    const bus = createEventBus()
    const calls: string[] = []
    bus.on(() => {
      throw new Error("boom")
    })
    bus.on((event) => calls.push(describeRunnerEvent(event)))

    bus.emit({ kind: "lifecycle", phase: "starting", requestId: "req-1" })

    expect(calls).toEqual(["lifecycle:starting"])
  })

  test("describeRunnerEvent covers every RunnerEvent kind (compile-time exhaustive)", () => {
    const samples: RunnerEvent[] = [
      { kind: "lifecycle", phase: "starting", requestId: "r" },
      { kind: "graph.node", node: "draftInitial", phase: "start" },
      { kind: "session.created", sessionID: "s", role: "drafter" },
      { kind: "session.status", sessionID: "s", role: "drafter", status: "active" },
      { kind: "session.error", sessionID: "s", role: "drafter", name: "X" },
      { kind: "agent.message.start", role: "drafter", messageID: "m" },
      { kind: "agent.reasoning", role: "drafter", text: "hmm" },
      { kind: "agent.tool", role: "drafter", tool: "read", status: "running", callID: "c" },
      { kind: "agent.permission", role: "drafter", permission: "edit" },
      { kind: "agent.telemetry", role: "drafter" },
      { kind: "result", runResult: { ok: true } },
    ]
    const labels = samples.map(describeRunnerEvent)
    expect(labels.length).toBe(samples.length)
    expect(new Set(labels).size).toBe(samples.length)
  })
})

describe("runQuorum", () => {
  test("emits lifecycle:starting before invoking the graph and runs bridge.start before the graph", async () => {
    const events: RunnerEvent[] = []
    const bus: EventBus = createEventBus()
    bus.on((event) => events.push(event))

    const sequence: string[] = []
    const bridge: Bridge = {
      async start() {
        sequence.push("bridge.start")
      },
      async stop() {
        sequence.push("bridge.stop")
      },
    }
    const bridgeFactory: BridgeFactory = () => bridge

    const ac = new AbortController()
    ac.abort()

    const prerequisites = {
      skill: { name: "research", content: "skill" },
      agents: [],
    } as unknown as Parameters<typeof runQuorum>[0]["prerequisites"]

    let threw: unknown
    try {
      await runQuorum({
        config,
        prerequisites,
        request: { inputMode: "topic", topic: "abort-fast" },
        bus,
        signal: ac.signal,
        bridgeFactory,
        telemetryFactory: async () => disabledTelemetry(),
      })
    } catch (error) {
      threw = error
    }

    // We pre-aborted the signal, so the graph invoke must reject. The runner
    // must still have emitted lifecycle:starting and lifecycle:running before
    // the failure, and lifecycle:error afterwards.
    expect(threw).toBeDefined()
    expect(events[0]).toMatchObject({ kind: "lifecycle", phase: "starting" })
    expect(events.some((e) => e.kind === "lifecycle" && e.phase === "error")).toBe(true)
    expect(sequence).toContain("bridge.start")
    expect(sequence).toContain("bridge.stop")
    expect(sequence.indexOf("bridge.start")).toBeLessThan(sequence.indexOf("bridge.stop"))
  })

  test("calls telemetry.shutdown and bridge.stop even when the run errors", async () => {
    const bus = createEventBus()
    let telemetryShutdownCalled = false
    let bridgeStopCalled = false

    const telemetryFactory = async (): Promise<TelemetryRun> => ({
      enabled: false,
      runWithRootObservation: async () => {
        throw new Error("simulated graph failure")
      },
      startObservation: async () => undefined,
      endObservation: async () => {},
      updateTrace: async () => {},
      async shutdown() {
        telemetryShutdownCalled = true
      },
    })

    const bridgeFactory: BridgeFactory = () => ({
      async start() {},
      async stop() {
        bridgeStopCalled = true
      },
    })

    const prerequisites = {
      skill: { name: "research", content: "skill" },
      agents: [],
    } as unknown as Parameters<typeof runQuorum>[0]["prerequisites"]

    await expect(
      runQuorum({
        config,
        prerequisites,
        request: { inputMode: "topic", topic: "fail" },
        bus,
        bridgeFactory,
        telemetryFactory,
      }),
    ).rejects.toThrow("simulated graph failure")

    expect(telemetryShutdownCalled).toBe(true)
    expect(bridgeStopCalled).toBe(true)
  })
})
