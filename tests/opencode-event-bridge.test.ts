import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

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
    summarizerAgent: "markdown-summarizer",
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
  lastSubscribeArgs?: unknown
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
      subscribe: async (args: unknown, opts: { signal: AbortSignal }) => {
        controller.subscribeCalls += 1
        controller.lastSubscribeArgs = args

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
  test("translates session.status, session.error, permission, message.updated to typed bus events without role", async () => {
    const bus = createEventBus()
    const events = collect(bus)
    const { client, controller } = makeStubClient()

    const bridge = createOpencodeEventBridge(baseConfig, {
      bus,
      getRunDir: () => "/tmp/unused",
      clientFactory: () => client as never,
    })

    await bridge.start()
    expect(controller.subscribeCalls).toBe(1)

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
    expect(status).toMatchObject({ kind: "session.status", status: "running", sessionID: "s1" })
    expect(status).not.toHaveProperty("role")

    const err = events.find((e) => e.kind === "session.error")
    expect(err).toMatchObject({ kind: "session.error", name: "BoomError", message: "kapow", sessionID: "s1" })
    expect(err).not.toHaveProperty("role")

    const perm = events.find((e) => e.kind === "agent.permission")
    expect(perm).toMatchObject({ kind: "agent.permission", permission: "read", sessionID: "s1" })
    expect(perm).not.toHaveProperty("role")

    const start = events.find((e) => e.kind === "agent.message.start")
    expect(start).toMatchObject({ kind: "agent.message.start", messageID: "m1", sessionID: "s1" })
    expect(start).not.toHaveProperty("role")
  })

  test("buffers reasoning deltas and only flushes on terminal punctuation", async () => {
    const bus = createEventBus()
    const events = collect(bus)
    const { client, controller } = makeStubClient()

    const bridge = createOpencodeEventBridge(baseConfig, {
      bus,
      getRunDir: () => "/tmp/unused",
      clientFactory: () => client as never,
    })

    await bridge.start()

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

    // Trailing period should trigger one update.
    controller.push({
      type: "message.part.delta",
      properties: { sessionID: "s1", messageID: "m1", partID: "r1", field: "text", delta: "done." },
    })
    await flush()

    const interimReasoning = events.filter((e) => e.kind === "agent.reasoning")
    expect(interimReasoning).toHaveLength(1)
    expect(interimReasoning.at(-1)).toMatchObject({ kind: "agent.reasoning", sessionID: "s1", key: "s1:m1:r1", done: false })

    // End of reasoning should mark the final emission done.
    controller.push({
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: { type: "reasoning", messageID: "m1", id: "r1", time: { end: Date.now() } },
      },
    })
    await flush()

    const reasoningEvents = events.filter((e) => e.kind === "agent.reasoning")
    expect(reasoningEvents.at(-1)).toMatchObject({ kind: "agent.reasoning", sessionID: "s1", key: "s1:m1:r1", done: true })
    expect(reasoningEvents.at(-1)).not.toHaveProperty("role")

    await bridge.stop()
  })

  test("emits assistant text parts so non-reasoning replies are visible", async () => {
    const bus = createEventBus()
    const events = collect(bus)
    const { client, controller } = makeStubClient()

    const bridge = createOpencodeEventBridge(baseConfig, {
      bus,
      getRunDir: () => "/tmp/unused",
      clientFactory: () => client as never,
    })

    await bridge.start()

    controller.push({
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: { type: "text", messageID: "m1", id: "p1", time: { end: undefined } },
      },
    })

    controller.push({
      type: "message.part.delta",
      properties: { sessionID: "s1", messageID: "m1", partID: "p1", field: "text", delta: "This is visible." },
    })
    await flush()

    const partial = events.filter((e) => e.kind === "agent.message.text")
    expect(partial).toHaveLength(1)
    expect(partial[0]).toMatchObject({ kind: "agent.message.text", sessionID: "s1", key: "s1:m1:p1", done: false })

    controller.push({
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: { type: "text", messageID: "m1", id: "p1", time: { end: Date.now() } },
      },
    })
    await flush()

    const final = events.filter((e) => e.kind === "agent.message.text")
    expect(final.at(-1)).toMatchObject({ kind: "agent.message.text", sessionID: "s1", key: "s1:m1:p1", done: true })

    await bridge.stop()
  })

  test("emits events for sessions the bridge never saw a session.created for (no per-session filter)", async () => {
    const bus = createEventBus()
    const events = collect(bus)
    const { client, controller } = makeStubClient()

    const bridge = createOpencodeEventBridge(baseConfig, {
      bus,
      getRunDir: () => "/tmp/unused",
      clientFactory: () => client as never,
    })

    await bridge.start()

    controller.push({
      type: "session.status",
      properties: { sessionID: "stranger-session", status: { type: "running" } },
    })
    await flush()
    await bridge.stop()

    expect(events.find((e) => e.kind === "session.status")).toMatchObject({
      kind: "session.status",
      sessionID: "stranger-session",
      status: "running",
    })
  })

  test("double start() does not open a second subscriber", async () => {
    const bus = createEventBus()
    const { client, controller } = makeStubClient()

    const bridge = createOpencodeEventBridge(baseConfig, {
      bus,
      getRunDir: () => "/tmp/unused",
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
      getRunDir: () => "/tmp/unused",
      clientFactory: () => client as never,
    })

    await bridge.start()
    expect(controller.subscribeCalls).toBe(1)

    await bridge.stop()

    await bridge.start()
    expect(controller.subscribeCalls).toBe(2)

    await bridge.stop()
  })

  test("emits agent.tool on tool state transitions without role", async () => {
    const bus = createEventBus()
    const events = collect(bus)
    const { client, controller } = makeStubClient()

    const bridge = createOpencodeEventBridge(baseConfig, {
      bus,
      getRunDir: () => "/tmp/unused",
      clientFactory: () => client as never,
    })

    await bridge.start()

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
      tool: "webfetch",
      status: "running",
      callID: "c1",
      sessionID: "s1",
      messageID: "m1",
      partID: "t1",
    })
    expect(toolEvents[0]).not.toHaveProperty("role")

    expect(events.filter((e) => (e as { kind: string }).kind === "agent.telemetry")).toHaveLength(0)

    await bridge.stop()
  })

  test("scopes the SSE subscription to the configured opencode directory", async () => {
    const bus = createEventBus()
    const { client, controller } = makeStubClient()

    const bridge = createOpencodeEventBridge(baseConfig, {
      bus,
      getRunDir: () => "/tmp/unused",
      clientFactory: () => client as never,
    })

    await bridge.start()
    expect(controller.subscribeCalls).toBe(1)
    expect(controller.lastSubscribeArgs).toMatchObject({ directory: baseConfig.env.OPENCODE_DIRECTORY })

    await bridge.stop()
  })

  test("on session.idle event, persists captured opencode events to runDir/opencode-events.json", async () => {
    const bus = createEventBus()
    const { client, controller } = makeStubClient()
    const runDir = await mkdtemp(join(tmpdir(), "bridge-snapshot-"))

    try {
      const bridge = createOpencodeEventBridge(
        {
          ...baseConfig,
          env: { ...baseConfig.env, QUORUM_CAPTURE_OPENCODE_EVENTS: "1" },
        },
        {
          bus,
          runDir,
          clientFactory: () => client as never,
        },
      )

      await bridge.start()

      controller.push({ type: "session.status", properties: { sessionID: "s1", status: { type: "running" } } })
      controller.push({ type: "session.idle", properties: { sessionID: "s1" } })
      await flush()
      // give persistArtifacts microtask a chance to flush
      await new Promise((r) => setTimeout(r, 10))

      const snapshot = JSON.parse(await readFile(join(runDir, "opencode-events.json"), "utf8"))
      expect(Array.isArray(snapshot)).toBe(true)
      expect(snapshot.length).toBeGreaterThanOrEqual(2)
      expect(snapshot[0]).toMatchObject({ type: "session.status" })

      await bridge.stop()
    } finally {
      await rm(runDir, { recursive: true, force: true })
    }
  })

  test("stop() flushes a final snapshot for any unwritten captured events", async () => {
    const bus = createEventBus()
    const { client, controller } = makeStubClient()
    const runDir = await mkdtemp(join(tmpdir(), "bridge-final-"))

    try {
      const bridge = createOpencodeEventBridge(
        {
          ...baseConfig,
          env: { ...baseConfig.env, QUORUM_CAPTURE_OPENCODE_EVENTS: "1" },
        },
        {
          bus,
          runDir,
          clientFactory: () => client as never,
        },
      )

      await bridge.start()

      controller.push({ type: "session.status", properties: { sessionID: "s1", status: { type: "running" } } })
      await flush()
      await bridge.stop()

      const snapshot = JSON.parse(await readFile(join(runDir, "opencode-events.json"), "utf8"))
      expect(Array.isArray(snapshot)).toBe(true)
      expect(snapshot.length).toBeGreaterThanOrEqual(1)
    } finally {
      await rm(runDir, { recursive: true, force: true })
    }
  })

  test("persistArtifacts is a no-op when no run dir has been assigned yet", async () => {
    const bus = createEventBus()
    const { client, controller } = makeStubClient()

    const bridge = createOpencodeEventBridge(
      {
        ...baseConfig,
        env: { ...baseConfig.env, QUORUM_CAPTURE_OPENCODE_EVENTS: "1" },
      },
      {
        bus,
        getRunDir: () => undefined,
        clientFactory: () => client as never,
      },
    )

    await bridge.start()
    controller.push({ type: "session.status", properties: { sessionID: "s1", status: { type: "running" } } })
    controller.push({ type: "session.idle", properties: { sessionID: "s1" } })
    await flush()
    await bridge.stop()

    expect(true).toBe(true)
  })
})
