import { describe, expect, test } from "bun:test"
import { createInitialState, createRunStore, reduce, resolveRoleKey } from "../src/tui/state/runStore"
import type { RuntimeConfig } from "../src/config"
import type { RunnerEvent } from "../src/runner"

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

describe("resolveRoleKey", () => {
  test("root resolves to undefined (no agent slot)", () => {
    expect(resolveRoleKey("root", config)).toBeUndefined()
  })

  test("drafter resolves to designatedDrafter name", () => {
    expect(resolveRoleKey("drafter", config)).toBe("research-drafter")
  })

  test("auditor:source-auditor resolves to source-auditor", () => {
    expect(resolveRoleKey("auditor:source-auditor", config)).toBe("source-auditor")
  })

  test("unknown auditor returns undefined", () => {
    expect(resolveRoleKey("auditor:nope", config)).toBeUndefined()
  })

  test("garbage role returns undefined", () => {
    expect(resolveRoleKey("garbage", config)).toBeUndefined()
  })
})

describe("createInitialState", () => {
  test("seeds drafter and every auditor as idle", () => {
    const state = createInitialState(config)
    expect(Object.keys(state.agents).sort()).toEqual(
      ["clarity-auditor", "logic-auditor", "research-drafter", "source-auditor"],
    )
    for (const agent of Object.values(state.agents)) {
      expect(agent.status).toBe("idle")
      expect(agent.scrollback).toEqual([])
      expect(agent.tokensIn).toBe(0)
      expect(agent.tokensOut).toBe(0)
    }
    expect(state.lifecycle.phase).toBe("starting")
  })
})

describe("reduce", () => {
  test("lifecycle event updates phase, requestId, traceId, outputDir", () => {
    const initial = createInitialState(config)
    const next = reduce(
      initial,
      { kind: "lifecycle", phase: "running", requestId: "r-1", traceId: "t-1", outputDir: "/tmp/out" },
      config,
    )
    expect(next.lifecycle.phase).toBe("running")
    expect(next.lifecycle.requestId).toBe("r-1")
    expect(next.lifecycle.traceId).toBe("t-1")
    expect(next.lifecycle.outputDir).toBe("/tmp/out")
  })

  test("graph.node stores node, phase, and full state slice", () => {
    const initial = createInitialState(config)
    const slice = { inputMode: "topic" as const, topic: "x", requestId: "r" }
    const next = reduce(initial, { kind: "graph.node", node: "draftInitial", phase: "start", state: slice }, config)
    expect(next.graph.node).toBe("draftInitial")
    expect(next.graph.phase).toBe("start")
    expect(next.graph.state).toBe(slice)
  })

  test("session.created with role=root sets rootSessionID, no agent change", () => {
    const initial = createInitialState(config)
    const next = reduce(initial, { kind: "session.created", sessionID: "root-s", role: "root" }, config)
    expect(next.lifecycle.rootSessionID).toBe("root-s")
    expect(next.agents["research-drafter"]?.sessionID).toBeUndefined()
  })

  test("session.created with role=drafter assigns sessionID to drafter slot", () => {
    const initial = createInitialState(config)
    const next = reduce(initial, { kind: "session.created", sessionID: "d-s", role: "drafter" }, config)
    expect(next.agents["research-drafter"]?.sessionID).toBe("d-s")
  })

  test("session.created with auditor role assigns sessionID to that auditor slot", () => {
    const initial = createInitialState(config)
    const next = reduce(
      initial,
      { kind: "session.created", sessionID: "src-s", role: "auditor:source-auditor" },
      config,
    )
    expect(next.agents["source-auditor"]?.sessionID).toBe("src-s")
  })

  test("session.created with unmapped role appends a system log entry", () => {
    const initial = createInitialState(config)
    const next = reduce(initial, { kind: "session.created", sessionID: "x", role: "unknown" }, config)
    expect(next.systemLog).toHaveLength(1)
    expect(next.systemLog[0]?.text).toContain("unmapped role")
  })

  test("session.status routes via sessionID to derive agent status", () => {
    let state = createInitialState(config)
    state = reduce(state, { kind: "session.created", sessionID: "d-s", role: "drafter" }, config)
    state = reduce(state, { kind: "session.status", sessionID: "d-s", status: "active" }, config)
    expect(state.agents["research-drafter"]?.status).toBe("running")
    state = reduce(state, { kind: "session.status", sessionID: "d-s", status: "idle" }, config)
    expect(state.agents["research-drafter"]?.status).toBe("idle")
  })

  test("session.error sets status=error and appends system scrollback", () => {
    let state = createInitialState(config)
    state = reduce(state, { kind: "session.created", sessionID: "d-s", role: "drafter" }, config)
    state = reduce(state, { kind: "session.error", sessionID: "d-s", name: "Boom", message: "kaboom" }, config)
    const agent = state.agents["research-drafter"]!
    expect(agent.status).toBe("error")
    expect(agent.scrollback.at(-1)?.text).toBe("error: Boom: kaboom")
  })

  test("agent.message.start appends an assistant-started entry", () => {
    let state = createInitialState(config)
    state = reduce(state, { kind: "session.created", sessionID: "d-s", role: "drafter" }, config)
    state = reduce(state, { kind: "agent.message.start", sessionID: "d-s", messageID: "m-1" }, config)
    expect(state.agents["research-drafter"]?.scrollback.at(-1)?.text).toBe("assistant started")
  })

  test("agent.reasoning appends a reasoning entry", () => {
    let state = createInitialState(config)
    state = reduce(state, { kind: "session.created", sessionID: "d-s", role: "drafter" }, config)
    state = reduce(state, { kind: "agent.reasoning", sessionID: "d-s", text: "thinking" }, config)
    const entry = state.agents["research-drafter"]!.scrollback.at(-1)!
    expect(entry.kind).toBe("reasoning")
    expect(entry.text).toBe("thinking")
  })

  test("agent.tool running sets activeTool and appends a tool entry (no counter)", () => {
    let state = createInitialState(config)
    state = reduce(state, { kind: "session.created", sessionID: "d-s", role: "drafter" }, config)
    state = reduce(
      state,
      {
        kind: "agent.tool",
        tool: "read",
        status: "running",
        callID: "c-1",
        sessionID: "d-s",
        messageID: "m-1",
        partID: "p-1",
      },
      config,
    )
    const agent = state.agents["research-drafter"]!
    expect(agent.activeTool).toEqual({ tool: "read", callID: "c-1", startedAt: agent.activeTool!.startedAt })
    expect(agent.scrollback.at(-1)?.text).toBe("read running")
    // Per-role tool counters intentionally not tracked.
    expect((agent as Record<string, unknown>).toolsTotal).toBeUndefined()
    expect((agent as Record<string, unknown>).toolsErrored).toBeUndefined()
  })

  test("agent.tool completed clears activeTool and appends completion entry", () => {
    let state = createInitialState(config)
    state = reduce(state, { kind: "session.created", sessionID: "d-s", role: "drafter" }, config)
    state = reduce(
      state,
      { kind: "agent.tool", tool: "read", status: "running", callID: "c", sessionID: "d-s", messageID: "m", partID: "p" },
      config,
    )
    state = reduce(
      state,
      {
        kind: "agent.tool",
        tool: "read",
        status: "completed",
        callID: "c",
        sessionID: "d-s",
        messageID: "m",
        partID: "p",
      },
      config,
    )
    const agent = state.agents["research-drafter"]!
    expect(agent.activeTool).toBeUndefined()
    expect(agent.scrollback.at(-1)?.text).toBe("read completed")
  })

  test("agent.tool error clears activeTool and appends failure entry (no error counter)", () => {
    let state = createInitialState(config)
    state = reduce(state, { kind: "session.created", sessionID: "d-s", role: "drafter" }, config)
    state = reduce(
      state,
      {
        kind: "agent.tool",
        tool: "read",
        status: "error",
        callID: "c",
        sessionID: "d-s",
        messageID: "m",
        partID: "p",
        error: "no perms",
      },
      config,
    )
    const agent = state.agents["research-drafter"]!
    expect(agent.activeTool).toBeUndefined()
    expect(agent.scrollback.at(-1)?.text).toBe("read failed: no perms")
  })

  test("agent.permission stores pendingPermission and appends entry", () => {
    let state = createInitialState(config)
    state = reduce(state, { kind: "session.created", sessionID: "d-s", role: "drafter" }, config)
    state = reduce(state, { kind: "agent.permission", permission: "edit", sessionID: "d-s" }, config)
    const agent = state.agents["research-drafter"]!
    expect(agent.pendingPermission).toBe("edit")
    expect(agent.scrollback.at(-1)?.text).toBe("edit")
  })

  test("result stores runResult", () => {
    const initial = createInitialState(config)
    const next = reduce(initial, { kind: "result", runResult: { ok: true } }, config)
    expect(next.result).toEqual({ ok: true })
  })
})

describe("createRunStore", () => {
  test("get returns initial seeded state", () => {
    const store = createRunStore({ config })
    expect(store.get().lifecycle.phase).toBe("starting")
    expect(store.get().agents["research-drafter"]).toBeDefined()
  })

  test("set notifies subscribers; unsubscribe stops notifications", () => {
    const store = createRunStore({ config })
    const calls: number[] = []
    const unsub = store.subscribe((s) => calls.push(s.systemLog.length))
    const next: typeof store extends infer S ? (S extends { get: () => infer T } ? T : never) : never =
      store.get()
    store.set({ ...next, systemLog: [{ kind: "system", text: "hello", ts: 1 }] })
    expect(calls).toEqual([1])
    unsub()
    store.set({ ...store.get(), systemLog: [] })
    expect(calls).toEqual([1])
  })

  test("throwing subscriber does not break other subscribers", () => {
    const store = createRunStore({ config })
    const seen: string[] = []
    store.subscribe(() => {
      throw new Error("boom")
    })
    store.subscribe(() => seen.push("ok"))
    store.set({ ...store.get(), systemLog: [{ kind: "system", text: "x", ts: 0 }] })
    expect(seen).toEqual(["ok"])
  })
})

// Type tripwire: discriminated union must be exhaustive in the reducer.
const _exhaustive: RunnerEvent["kind"] = "lifecycle"
void _exhaustive
