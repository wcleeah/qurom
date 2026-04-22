import { describe, expect, test } from "bun:test"

import {
  type Bridge,
  type BridgeFactory,
  type EventBus,
  type RunnerEvent,
  attachTelemetryListener,
  createEventBus,
  describeRunnerEvent,
  runQuorum,
} from "../src/runner.ts"
import type { RuntimeConfig } from "../src/config.ts"
import type { TelemetryRun, TraceObservation } from "../src/telemetry.ts"

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
      { kind: "graph.node", node: "draftInitial", phase: "start", state: { inputMode: "topic", topic: "x", requestId: "r" } },
      { kind: "session.created", sessionID: "s", role: "drafter" },
      { kind: "session.status", sessionID: "s", status: "active" },
      { kind: "session.error", sessionID: "s", name: "X" },
      { kind: "agent.message.start", sessionID: "s", messageID: "m" },
      { kind: "agent.reasoning", sessionID: "s", key: "part-1", text: "hmm" },
      {
        kind: "agent.tool",
        tool: "read",
        status: "running",
        callID: "c",
        sessionID: "s",
        messageID: "m",
        partID: "p",
      },
      { kind: "agent.permission", permission: "edit", sessionID: "s" },
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

describe("attachTelemetryListener", () => {
  type StartArgs = Parameters<TelemetryRun["startObservation"]>[0]
  type EndArgs = Parameters<TelemetryRun["endObservation"]>

  function makeRecordingTelemetry(opts: { startDelayMs?: number } = {}): {
    telemetry: TelemetryRun
    starts: StartArgs[]
    ends: EndArgs[]
    nextObservationId: () => string
  } {
    const starts: StartArgs[] = []
    const ends: EndArgs[] = []
    let counter = 0
    const nextObservationId = () => `obs-${++counter}`

    const telemetry: TelemetryRun = {
      enabled: true,
      runWithRootObservation: async (fn) => fn(),
      async startObservation(input) {
        starts.push(input)
        if (opts.startDelayMs) await new Promise((r) => setTimeout(r, opts.startDelayMs))
        const observation: TraceObservation = {
          id: nextObservationId(),
          traceId: input.traceId,
          type: input.type ?? "Span",
          observation: {} as TraceObservation["observation"],
        }
        return observation
      },
      async endObservation(observation, input) {
        ends.push([observation, input])
      },
      updateTrace: async () => {},
      shutdown: async () => {},
    }

    return { telemetry, starts, ends, nextObservationId }
  }

  function makeParent(): TraceObservation {
    return {
      id: "parent-obs",
      traceId: "trace-1",
      type: "Span",
      observation: {} as TraceObservation["observation"],
    }
  }

  test("opens a Tool observation under the registered session parent and closes it on completion", async () => {
    const bus = createEventBus()
    const { telemetry, starts, ends } = makeRecordingTelemetry()
    const listener = attachTelemetryListener(bus, telemetry)

    bus.emit({ kind: "session.created", sessionID: "s1", role: "drafter" })
    listener.trackSessionObservation("s1", makeParent())

    bus.emit({
      kind: "agent.tool",
      tool: "webfetch",
      status: "running",
      callID: "c1",
      sessionID: "s1",
      messageID: "m1",
      partID: "t1",
      input: { url: "https://example.com" },
    })
    bus.emit({
      kind: "agent.tool",
      tool: "webfetch",
      status: "completed",
      callID: "c1",
      sessionID: "s1",
      messageID: "m1",
      partID: "t1",
      output: { ok: true },
    })

    await listener.dispose()

    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({
      traceId: "trace-1",
      parentObservationId: "parent-obs",
      name: "tool.webfetch",
      type: "Tool",
    })
    expect(starts[0]?.metadata?.role).toBe("drafter")
    expect(ends).toHaveLength(1)
    expect(ends[0][1]?.output).toMatchObject({ tool: "webfetch", status: "completed", result: { ok: true } })
    expect(ends[0][1]?.metadata?.role).toBe("drafter")
  })

  test("ignores tool events for sessions that were never registered via session.created", async () => {
    const bus = createEventBus()
    const { telemetry, starts, ends } = makeRecordingTelemetry()
    const listener = attachTelemetryListener(bus, telemetry)

    // No session.created emitted — bridge may surface events from other quorum runs in the same dir.
    listener.trackSessionObservation("s1", makeParent())

    bus.emit({
      kind: "agent.tool",
      tool: "webfetch",
      status: "running",
      callID: "c1",
      sessionID: "s1",
      messageID: "m1",
      partID: "t1",
    })

    await listener.dispose()

    expect(starts).toHaveLength(0)
    expect(ends).toHaveLength(0)
  })

  test("skips tool observations when no session parent has been registered", async () => {
    const bus = createEventBus()
    const { telemetry, starts, ends } = makeRecordingTelemetry()
    const listener = attachTelemetryListener(bus, telemetry)

    bus.emit({ kind: "session.created", sessionID: "untracked", role: "drafter" })

    bus.emit({
      kind: "agent.tool",
      tool: "webfetch",
      status: "running",
      callID: "c1",
      sessionID: "untracked",
      messageID: "m1",
      partID: "t1",
    })
    bus.emit({
      kind: "agent.tool",
      tool: "webfetch",
      status: "completed",
      callID: "c1",
      sessionID: "untracked",
      messageID: "m1",
      partID: "t1",
    })

    await listener.dispose()

    expect(starts).toHaveLength(0)
    expect(ends).toHaveLength(0)
  })

  test("serializes start before end for the same tool key (per-key promise chain)", async () => {
    const bus = createEventBus()
    // 30ms start delay forces the running event to still be in-flight when completed arrives.
    const { telemetry, starts, ends } = makeRecordingTelemetry({ startDelayMs: 30 })
    const listener = attachTelemetryListener(bus, telemetry)

    bus.emit({ kind: "session.created", sessionID: "s1", role: "drafter" })
    listener.trackSessionObservation("s1", makeParent())

    bus.emit({
      kind: "agent.tool",
      tool: "webfetch",
      status: "running",
      callID: "c1",
      sessionID: "s1",
      messageID: "m1",
      partID: "t1",
    })
    bus.emit({
      kind: "agent.tool",
      tool: "webfetch",
      status: "completed",
      callID: "c1",
      sessionID: "s1",
      messageID: "m1",
      partID: "t1",
    })

    await listener.dispose()

    expect(starts).toHaveLength(1)
    expect(ends).toHaveLength(1)
    // The end must have received an observation produced by the prior start, not undefined.
    expect(ends[0][0]).toBeDefined()
  })

  test("attaches captured permissions from agent.permission to the tool observation metadata", async () => {
    const bus = createEventBus()
    const { telemetry, starts, ends } = makeRecordingTelemetry()
    const listener = attachTelemetryListener(bus, telemetry)

    bus.emit({ kind: "session.created", sessionID: "s1", role: "drafter" })
    listener.trackSessionObservation("s1", makeParent())

    bus.emit({
      kind: "agent.permission",
      permission: "edit",
      sessionID: "s1",
      messageID: "m1",
      callID: "c1",
    })
    bus.emit({
      kind: "agent.tool",
      tool: "edit",
      status: "running",
      callID: "c1",
      sessionID: "s1",
      messageID: "m1",
      partID: "t1",
    })
    bus.emit({
      kind: "agent.tool",
      tool: "edit",
      status: "completed",
      callID: "c1",
      sessionID: "s1",
      messageID: "m1",
      partID: "t1",
    })

    await listener.dispose()

    expect(starts[0]?.metadata?.permissions).toEqual(["edit"])
    expect(ends[0][1]?.metadata?.permissions).toEqual(["edit"])
  })
})
