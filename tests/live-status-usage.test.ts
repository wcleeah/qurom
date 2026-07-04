import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createEventBus } from "../src/runner.ts"
import { createLiveStatusWriter } from "../src/live-status.ts"

describe("createLiveStatusWriter usage", () => {
  test("aggregates agent.usage deltas and snapshots them on node end", async () => {
    const bus = createEventBus()
    const dir = await mkdtemp(join(tmpdir(), "qurom-live-status-"))

    const writer = createLiveStatusWriter(bus, dir, { maxRounds: 3 })
    try {
      bus.emit({ kind: "lifecycle", phase: "running", requestId: "req-1" })
      bus.emit({ kind: "session.created", sessionID: "ses-1", role: "source-auditor" })
      bus.emit({ kind: "graph.node", node: "runParallelAudits", phase: "start", state: { round: 0 } as never })

      bus.emit({
        kind: "agent.usage",
        sessionID: "ses-1",
        messageID: "msg-1",
        tokensIn: 100,
        tokensOut: 10,
        source: "opencode",
      })
      bus.emit({
        kind: "agent.usage",
        sessionID: "ses-1",
        messageID: "msg-1",
        tokensIn: 150,
        tokensOut: 20,
        source: "opencode",
      })

      bus.emit({ kind: "graph.node", node: "runParallelAudits", phase: "end", state: { round: 0 } as never })
      await Bun.sleep(30)

      const live = await Bun.file(`${dir}/live-status.json`).json() as {
        usage: { tokensIn: number; tokensOut: number }
        usageAvailable: boolean
        nodeHistory: Array<{ usage?: { tokensIn: number; tokensOut: number }; usageAvailable?: boolean }>
      }

      expect(live.usageAvailable).toBe(true)
      expect(live.usage).toEqual({ tokensIn: 150, tokensOut: 20 })
      expect(live.nodeHistory.at(-1)?.usageAvailable).toBe(true)
      expect(live.nodeHistory.at(-1)?.usage).toEqual({ tokensIn: 150, tokensOut: 20 })
    } finally {
      writer.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("dedupes cumulative cursor usage by run id", async () => {
    const bus = createEventBus()
    const dir = await mkdtemp(join(tmpdir(), "qurom-live-status-"))

    const writer = createLiveStatusWriter(bus, dir, { maxRounds: 3 })
    try {
      bus.emit({ kind: "session.created", sessionID: "ses-cursor", role: "research-drafter" })
      bus.emit({ kind: "graph.node", node: "draftFullDraft", phase: "start", state: { round: 0 } as never })

      bus.emit({
        kind: "agent.usage",
        sessionID: "ses-cursor",
        runID: "run-1",
        tokensIn: 200,
        tokensOut: 40,
        source: "cursor",
        cumulative: true,
      })
      bus.emit({
        kind: "agent.usage",
        sessionID: "ses-cursor",
        runID: "run-1",
        tokensIn: 300,
        tokensOut: 70,
        source: "cursor",
        cumulative: true,
      })
      await Bun.sleep(30)

      const live = await Bun.file(`${dir}/live-status.json`).json() as {
        usage: { tokensIn: number; tokensOut: number }
      }
      expect(live.usage).toEqual({ tokensIn: 300, tokensOut: 70 })
    } finally {
      writer.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
