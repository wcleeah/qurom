import { describe, expect, test } from "bun:test"
import { createRunStore, reduce } from "../src/tui/state/runStore"
import type { RunnerEvent } from "../src/runner"

describe("reduce", () => {
  test("lifecycle event updates phase, requestId, traceId, outputDir", () => {
    const initial = createRunStore().getState()
    const next = reduce(initial, {
      kind: "lifecycle",
      phase: "running",
      requestId: "r-1",
      traceId: "t-1",
      outputDir: "/tmp/out",
    })
    expect(next.lifecycle.phase).toBe("running")
    expect(next.lifecycle.requestId).toBe("r-1")
    expect(next.lifecycle.traceId).toBe("t-1")
    expect(next.lifecycle.outputDir).toBe("/tmp/out")
  })

  test("graph.node stores node, phase, and full state slice", () => {
    const initial = createRunStore().getState()
    const slice = { inputMode: "topic" as const, topic: "x", requestId: "r" }
    const next = reduce(initial, { kind: "graph.node", node: "draftFullDraft", phase: "start", state: slice })
    expect(next.graph.node).toBe("draftFullDraft")
    expect(next.graph.phase).toBe("start")
    expect(next.graph.state).toBe(slice)
  })

  test("graph.node end appends node history", () => {
    let state = createRunStore().getState()
    state = reduce(state, { kind: "graph.node", node: "runParallelAudits", phase: "start", state: { requestId: "r" } })
    state = reduce(state, { kind: "graph.node", node: "runParallelAudits", phase: "end", state: { requestId: "r" } })
    expect(state.nodeHistory).toHaveLength(1)
    expect(state.nodeHistory[0]?.node).toBe("runParallelAudits")
    expect(state.nodeHistory[0]?.status).toBe("completed")
  })

  test("session.created with role=root sets rootSessionID", () => {
    const initial = createRunStore().getState()
    const next = reduce(initial, { kind: "session.created", sessionID: "root-s", role: "root" })
    expect(next.lifecycle.rootSessionID).toBe("root-s")
  })

  test("session.created assigns sessionID to the role key", () => {
    const initial = createRunStore().getState()
    const next = reduce(initial, { kind: "session.created", sessionID: "d-s", role: "research-drafter" })
    expect(next.agents["research-drafter"]?.sessionID).toBe("d-s")
  })

  test("session.status routes via sessionID to derive agent status", () => {
    let state = createRunStore().getState()
    state = reduce(state, { kind: "session.created", sessionID: "d-s", role: "research-drafter" })
    state = reduce(state, { kind: "session.status", sessionID: "d-s", status: "active" })
    expect(state.agents["research-drafter"]?.status).toBe("running")
    state = reduce(state, { kind: "session.status", sessionID: "d-s", status: "completed" })
    expect(state.agents["research-drafter"]?.status).toBe("complete")
  })

  test("session.error sets status=error and appends system log", () => {
    let state = createRunStore().getState()
    state = reduce(state, { kind: "session.created", sessionID: "d-s", role: "research-drafter" })
    state = reduce(state, { kind: "session.error", sessionID: "d-s", name: "Boom", message: "kaboom" })
    expect(state.agents["research-drafter"]?.status).toBe("error")
    expect(state.systemLog.at(-1)?.text).toBe("error: Boom: kaboom")
  })

  test("agent.metadata updates model and variant for the matching session", () => {
    let state = createRunStore().getState()
    state = reduce(state, { kind: "session.created", sessionID: "d-s", role: "research-drafter" })
    state = reduce(state, {
      kind: "agent.metadata",
      agent: "research-drafter",
      sessionID: "d-s",
      model: "opencode/gpt-5.4",
      variant: "high",
    })
    expect(state.agents["research-drafter"]?.model).toBe("opencode/gpt-5.4")
    expect(state.agents["research-drafter"]?.variant).toBe("high")
  })

  test("agent.tool running sets active tool name", () => {
    let state = createRunStore().getState()
    state = reduce(state, { kind: "session.created", sessionID: "d-s", role: "research-drafter" })
    state = reduce(state, {
      kind: "agent.tool",
      tool: "read",
      status: "running",
      callID: "c-1",
      sessionID: "d-s",
      messageID: "m-1",
      partID: "p-1",
    })
    expect(state.agents["research-drafter"]?.tool).toBe("read")
  })

  test("agent.tool completed clears active tool", () => {
    let state = createRunStore().getState()
    state = reduce(state, { kind: "session.created", sessionID: "d-s", role: "research-drafter" })
    state = reduce(state, {
      kind: "agent.tool",
      tool: "read",
      status: "running",
      callID: "c",
      sessionID: "d-s",
      messageID: "m",
      partID: "p",
    })
    state = reduce(state, {
      kind: "agent.tool",
      tool: "read",
      status: "completed",
      callID: "c",
      sessionID: "d-s",
      messageID: "m",
      partID: "p",
    })
    expect(state.agents["research-drafter"]?.tool).toBeUndefined()
  })

  test("result stores runResult", () => {
    const initial = createRunStore().getState()
    const next = reduce(initial, { kind: "result", runResult: { ok: true } })
    expect(next.result).toEqual({ ok: true })
  })
})

describe("createRunStore", () => {
  test("getState returns initial empty state", () => {
    const store = createRunStore()
    expect(store.getState().lifecycle.phase).toBe("starting")
    expect(store.getState().agents).toEqual({})
  })

  test("setState notifies subscribers; unsubscribe stops notifications", () => {
    const store = createRunStore()
    const calls: number[] = []
    const unsub = store.subscribe((s) => calls.push(s.systemLog.length))
    store.setState({ systemLog: [{ text: "hello", ts: 1 }] })
    expect(calls).toEqual([1])
    unsub()
    store.setState({ systemLog: [] })
    expect(calls).toEqual([1])
  })
})

const _exhaustive: RunnerEvent["kind"] = "lifecycle"
void _exhaustive
