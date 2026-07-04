import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createEventBus } from "../src/runner.ts"
import { createLiveStatusWriter } from "../src/live-status.ts"
import { createSessionTelemetryWriter } from "../src/session-telemetry.ts"

describe("live status without usage", () => {
  test("does not persist token usage in live-status or node-history", async () => {
    const bus = createEventBus()
    const dir = await mkdtemp(join(tmpdir(), "qurom-live-status-"))

    const liveWriter = createLiveStatusWriter(bus, dir, { maxRounds: 3 })
    const telemetryWriter = createSessionTelemetryWriter(dir, bus)
    try {
      bus.emit({ kind: "lifecycle", phase: "running", requestId: "req-1" })
      bus.emit({ kind: "session.created", sessionID: "ses-1", role: "source-auditor" })
      bus.emit({ kind: "graph.node", node: "runParallelAudits", phase: "start", state: { round: 0 } as never })
      bus.emit({
        kind: "agent.usage",
        sessionID: "ses-1",
        messageID: "msg-1",
        tokensIn: 150,
        tokensOut: 20,
        costUsd: 0.015,
        costAvailable: true,
        costEstimated: false,
        source: "opencode",
      })
      bus.emit({ kind: "graph.node", node: "runParallelAudits", phase: "end", state: { round: 0 } as never })

      await telemetryWriter.flush()
      await Bun.sleep(30)

      const live = JSON.parse(await readFile(join(dir, "live-status.json"), "utf8")) as {
        usage?: unknown
        nodeHistory: Array<{ usage?: unknown; usageAvailable?: boolean }>
      }
      const sessionTelemetry = JSON.parse(await readFile(join(dir, "session-telemetry.json"), "utf8")) as {
        sessions: Array<{ node?: string; calls: Array<{ usage?: { tokensIn: number } }> }>
      }

      expect(live.usage).toBeUndefined()
      expect(live.nodeHistory.at(-1)?.usage).toBeUndefined()
      expect(live.nodeHistory.at(-1)?.usageAvailable).toBeUndefined()
      expect(sessionTelemetry.sessions[0]?.node).toBe("runParallelAudits")
      expect(sessionTelemetry.sessions[0]?.calls[0]?.usage?.tokensIn).toBe(150)
    } finally {
      liveWriter.dispose()
      telemetryWriter.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("records cursor cumulative usage in session-telemetry only", async () => {
    const bus = createEventBus()
    const dir = await mkdtemp(join(tmpdir(), "qurom-live-status-"))

    const liveWriter = createLiveStatusWriter(bus, dir, { maxRounds: 3 })
    const telemetryWriter = createSessionTelemetryWriter(dir, bus)
    try {
      bus.emit({ kind: "session.created", sessionID: "ses-cursor", role: "research-drafter" })
      bus.emit({ kind: "graph.node", node: "draftFullDraft", phase: "start", state: { round: 0 } as never })
      bus.emit({
        kind: "agent.usage",
        sessionID: "ses-cursor",
        runID: "run-1",
        tokensIn: 200,
        tokensOut: 40,
        costUsd: 0.02,
        costAvailable: true,
        costEstimated: true,
        source: "cursor",
        cumulative: true,
      })
      bus.emit({
        kind: "agent.usage",
        sessionID: "ses-cursor",
        runID: "run-1",
        tokensIn: 300,
        tokensOut: 70,
        costUsd: 0.05,
        costAvailable: true,
        costEstimated: true,
        source: "cursor",
        cumulative: true,
      })

      await telemetryWriter.flush()
      await Bun.sleep(30)

      const live = await Bun.file(join(dir, "live-status.json")).json() as Record<string, unknown>
      const sessionTelemetry = await Bun.file(join(dir, "session-telemetry.json")).json() as {
        sessions: Array<{ calls: Array<{ usage?: { tokensIn: number; tokensOut: number; costUsd?: number } }> }>
      }

      expect(live.usage).toBeUndefined()
      expect(sessionTelemetry.sessions[0]?.calls[0]?.usage?.tokensIn).toBe(300)
      expect(sessionTelemetry.sessions[0]?.calls[0]?.usage?.tokensOut).toBe(70)
      expect(sessionTelemetry.sessions[0]?.calls[0]?.usage?.costUsd).toBeCloseTo(0.05)
    } finally {
      liveWriter.dispose()
      telemetryWriter.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
