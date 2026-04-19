import { describe, expect, test } from "bun:test"

import { createOpencodeEventBridge } from "../src/opencode-event-bridge.ts"
import { createEventBus, type RunnerEvent } from "../src/runner.ts"
import type { RuntimeConfig } from "../src/config.ts"

const baseConfig: RuntimeConfig = {
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

type StreamController = {
  push: (event: unknown) => void
  end: () => void
  returnCalls: number
  subscribeCalls: number
}

function makeStubClient(): { client: unknown; controller: StreamController } {
  const controller: StreamController = {
    push: () => {},
    end: () => {},
    returnCalls: 0,
    subscribeCalls: 0,
  }

  const client = {
    event: {
      subscribe: async (_args: unknown, opts: { signal: AbortSignal }) => {
        controller.subscribeCalls += 1

        const queue: unknown[] = []
        let resolveNext: ((value: IteratorResult<unknown>) => void) | undefined
        let ended = false

        controller.push = (event) => {
          if (resolveNext) {
            const r = resolveNext
            resolveNext = undefined
            r({ value: event, done: false })
            return
          }
          queue.push(event)
        }
        controller.end = () => {
          ended = true
          if (resolveNext) {
            const r = resolveNext
            resolveNext = undefined
            r({ value: undefined, done: true })
          }
        }

        opts.signal.addEventListener("abort", () => {
          controller.end()
        })

        const stream: AsyncIterable<unknown> & { return?: () => Promise<IteratorResult<unknown>> } = {
          [Symbol.asyncIterator]() {
            return {
              next(): Promise<IteratorResult<unknown>> {
                if (queue.length > 0) {
                  return Promise.resolve({ value: queue.shift(), done: false })
                }
                if (ended) return Promise.resolve({ value: undefined, done: true })
                return new Promise((resolve) => {
                  resolveNext = resolve
                })
              },
              return(): Promise<IteratorResult<unknown>> {
                controller.returnCalls += 1
                ended = true
                return Promise.resolve({ value: undefined, done: true })
              },
            }
          },
        }

        return { stream }
      },
    },
  }

  return { client, controller }
}

function collect(bus: ReturnType<typeof createEventBus>): RunnerEvent[] {
  const events: RunnerEvent[] = []
  bus.on((event) => events.push(event))
  return events
}

async function flush() {
  // Yield repeatedly so the bridge's for-await loop processes pushed events.
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe("createOpencodeEventBridge", () => {
  test("translates session.status, session.error, permission, message.updated to typed bus events", async () => {
    const bus = createEventBus()
    const events = collect(bus)
    const { client, controller } = makeStubClient()

    const bridge = createOpencodeEventBridge(baseConfig, {
      bus,
      clientFactory: () => client as never,
    })

    await bridge.start()
    expect(controller.subscribeCalls).toBe(1)

    bus.emit({ kind: "session.created", sessionID: "s1", role: "drafter" })

    controller.push({ type: "session.status", properties: { sessionID: "s1", status: { type: "running" } } })
    controller.push({
      type: "session.error",
      properties: { sessionID: "s1", error: { name: "BoomError", data: { message: "kapow" } } },
    })
    controller.push({
      type: "permission.asked",
      properties: { id: "p1", sessionID: "s1", permission: "read", tool: undefined },
    })
    controller.push({
      type: "message.updated",
      properties: { sessionID: "s1", info: { id: "m1", role: "assistant" } },
    })

    await flush()
    await bridge.stop()

    const kinds = events.map((e) => e.kind)
    expect(kinds).toContain("session.status")
    expect(kinds).toContain("session.error")
    expect(kinds).toContain("agent.permission")
    expect(kinds).toContain("agent.message.start")

    const status = events.find((e) => e.kind === "session.status")
    expect(status).toMatchObject({ kind: "session.status", role: "drafter", status: "running", sessionID: "s1" })

    const err = events.find((e) => e.kind === "session.error")
    expect(err).toMatchObject({ kind: "session.error", role: "drafter", name: "BoomError", message: "kapow" })

    const perm = events.find((e) => e.kind === "agent.permission")
    expect(perm).toMatchObject({ kind: "agent.permission", role: "drafter", permission: "read" })

    const start = events.find((e) => e.kind === "agent.message.start")
    expect(start).toMatchObject({ kind: "agent.message.start", role: "drafter", messageID: "m1" })
  })

  test("buffers reasoning deltas and only flushes on terminal punctuation", async () => {
    const bus = createEventBus()
    const events = collect(bus)
    const { client, controller } = makeStubClient()

    const bridge = createOpencodeEventBridge(baseConfig, {
      bus,
      clientFactory: () => client as never,
    })

    await bridge.start()
    bus.emit({ kind: "session.created", sessionID: "s1", role: "drafter" })

    // Open a reasoning part so deltas are accepted.
    controller.push({
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: { type: "reasoning", messageID: "m1", id: "r1", time: { end: undefined } },
      },
    })

    // 10 deltas with no terminal punctuation, each short.
    for (let i = 0; i < 10; i += 1) {
      controller.push({
        type: "message.part.delta",
        properties: { sessionID: "s1", messageID: "m1", partID: "r1", field: "text", delta: "abc " },
      })
    }
    await flush()

    expect(events.filter((e) => e.kind === "agent.reasoning")).toHaveLength(0)

    // Trailing period should trigger one flush.
    controller.push({
      type: "message.part.delta",
      properties: { sessionID: "s1", messageID: "m1", partID: "r1", field: "text", delta: "done." },
    })
    await flush()

    const reasoningEvents = events.filter((e) => e.kind === "agent.reasoning")
    expect(reasoningEvents).toHaveLength(1)
    expect(reasoningEvents[0]).toMatchObject({ kind: "agent.reasoning", role: "drafter" })

    await bridge.stop()
  })

  test("double start() does not open a second subscriber", async () => {
    const bus = createEventBus()
    const { client, controller } = makeStubClient()

    const bridge = createOpencodeEventBridge(baseConfig, {
      bus,
      clientFactory: () => client as never,
    })

    await bridge.start()
    await bridge.start()
    await bridge.start()

    expect(controller.subscribeCalls).toBe(1)

    await bridge.stop()
  })

  test("stop() aborts the iterator; restart opens a fresh subscriber", async () => {
    const bus = createEventBus()
    const { client, controller } = makeStubClient()

    const bridge = createOpencodeEventBridge(baseConfig, {
      bus,
      clientFactory: () => client as never,
    })

    await bridge.start()
    expect(controller.subscribeCalls).toBe(1)

    await bridge.stop()
    // The iterator is unblocked via abort signal; the for-await loop exits cleanly.
    // We don't require return() to be called (abort path uses ended flag), only that
    // a second start() opens a brand new subscription.

    await bridge.start()
    expect(controller.subscribeCalls).toBe(2)

    await bridge.stop()
  })

  test("emits agent.tool and agent.telemetry counter on tool completion", async () => {
    const bus = createEventBus()
    const events = collect(bus)
    const { client, controller } = makeStubClient()

    const bridge = createOpencodeEventBridge(baseConfig, {
      bus,
      clientFactory: () => client as never,
    })

    await bridge.start()
    bus.emit({ kind: "session.created", sessionID: "s1", role: "drafter" })

    controller.push({
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: {
          type: "tool",
          messageID: "m1",
          id: "t1",
          callID: "c1",
          tool: "webfetch",
          state: { status: "running", input: {} },
        },
      },
    })
    await flush()

    const toolEvents = events.filter((e) => e.kind === "agent.tool")
    expect(toolEvents).toHaveLength(1)
    expect(toolEvents[0]).toMatchObject({
      kind: "agent.tool",
      role: "drafter",
      tool: "webfetch",
      status: "running",
      callID: "c1",
    })

    const telemetryEvents = events.filter((e) => e.kind === "agent.telemetry")
    expect(telemetryEvents).toHaveLength(1)
    expect(telemetryEvents[0]).toMatchObject({ kind: "agent.telemetry", role: "drafter", toolCallsTotal: 1 })

    await bridge.stop()
  })
})
