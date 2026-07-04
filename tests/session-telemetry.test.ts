import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { createEventBus } from "../src/runner.ts"
import {
  applyOpencodeAgentUsageEvent,
  applySessionTelemetryEvent,
  createSessionTelemetryWriter,
  emptySessionTelemetryFile,
  sumSessionTelemetryUsage,
} from "../src/session-telemetry.ts"
import { resolveRunTelemetry } from "../src/view/telemetry-view.ts"
describe("session telemetry", () => {
  test("records created and completed call metadata", () => {
    let file = emptySessionTelemetryFile()
    file = applySessionTelemetryEvent(file, {
      kind: "session.telemetry",
      sessionID: "bc-123",
      role: "reader-interviewer",
      provider: "cursor",
      phase: "created",
      requestedModel: "default",
      modelParams: [{ id: "reasoning", value: "low" }],
      completedAt: Date.parse("2026-07-04T09:00:00.000Z"),
    })
    file = applySessionTelemetryEvent(file, {
      kind: "session.telemetry",
      sessionID: "bc-123",
      role: "reader-interviewer",
      provider: "cursor",
      phase: "completed",
      cursorRunId: "run-1",
      callIndex: 1,
      resolvedModel: "auto",
      completedAt: Date.parse("2026-07-04T09:00:21.892Z"),
      usage: {
        tokensIn: 6000,
        tokensOut: 400,
        costUsd: 0.01,
        costAvailable: true,
        costEstimated: true,
      },
      usageSource: "csv-import",
    })

    expect(file.sessions).toHaveLength(1)
    expect(file.sessions[0]?.requestedModel).toBe("default")
    expect(file.sessions[0]?.modelParams?.[0]?.value).toBe("low")
    expect(file.sessions[0]?.calls[0]?.resolvedModel).toBe("auto")
    expect(sumSessionTelemetryUsage(file).tokensOut).toBe(400)
  })

  test("resolveRunTelemetry omits est for csv-import with actual cost", () => {
    const resolved = resolveRunTelemetry({
      version: 1,
      sessions: [{
        sessionId: "bc-123",
        role: "reader-interviewer",
        provider: "cursor",
        calls: [{
          resolvedModel: "auto",
          usage: {
            tokensIn: 1000,
            tokensOut: 200,
            costUsd: 0.02,
            costAvailable: true,
            costEstimated: false,
          },
          usageSource: "csv-import",
        }],
      }],
    })

    expect(resolved.usageAvailable).toBe(true)
    expect(resolved.usage.tokensIn).toBe(1000)
    expect(resolved.usage.tokensOut).toBe(200)
    expect(resolved.costAvailable).toBe(true)
    expect(resolved.costEstimated).toBe(false)
  })

  test("resolveRunTelemetry keeps est for csv-import with estimated cost", () => {
    const resolved = resolveRunTelemetry({
      version: 1,
      sessions: [{
        sessionId: "bc-123",
        role: "reader-interviewer",
        provider: "cursor",
        calls: [{
          resolvedModel: "auto",
          usage: {
            tokensIn: 1000,
            tokensOut: 200,
            costUsd: 0.02,
            costAvailable: true,
            costEstimated: true,
          },
          usageSource: "csv-import",
        }],
      }],
    })

    expect(resolved.costAvailable).toBe(true)
    expect(resolved.costEstimated).toBe(true)
  })

  test("applyOpencodeAgentUsageEvent accumulates message deltas per session", () => {
    const context = {
      role: "research-drafter",
      accumulatedBySession: new Map(),
      messageUsageTotals: new Map(),
    }

    let file = emptySessionTelemetryFile()
    file = applyOpencodeAgentUsageEvent(file, {
      sessionID: "ses_123",
      messageID: "msg_1",
      tokensIn: 100,
      tokensOut: 10,
      costUsd: 0.01,
      costAvailable: true,
      costEstimated: false,
    }, context)
    file = applyOpencodeAgentUsageEvent(file, {
      sessionID: "ses_123",
      messageID: "msg_1",
      tokensIn: 150,
      tokensOut: 20,
      costUsd: 0.015,
      costAvailable: true,
      costEstimated: false,
    }, context)

    expect(file.sessions).toHaveLength(1)
    expect(file.sessions[0]?.provider).toBe("opencode")
    expect(file.sessions[0]?.role).toBe("research-drafter")
    expect(file.sessions[0]?.calls[0]?.usage).toMatchObject({
      tokensIn: 150,
      tokensOut: 20,
      costUsd: 0.015,
      costAvailable: true,
    })
    expect(file.sessions[0]?.calls[0]?.usageSource).toBe("sdk")
  })

  test("createSessionTelemetryWriter persists opencode agent.usage events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-session-telemetry-"))
    const bus = createEventBus()
    const writer = createSessionTelemetryWriter(dir, bus)

    bus.emit({ kind: "session.created", sessionID: "ses_live", role: "reader-interviewer" })
    bus.emit({
      kind: "agent.usage",
      sessionID: "ses_live",
      messageID: "msg_a",
      tokensIn: 80,
      tokensOut: 12,
      source: "opencode",
      costUsd: 0.004,
      costAvailable: true,
      costEstimated: false,
    })
    bus.emit({
      kind: "session.telemetry",
      sessionID: "ses_live",
      provider: "opencode",
      phase: "completed",
      providerAgent: "reader-interviewer",
      resolvedModel: "gpt-5",
      completedAt: Date.now(),
    })

    await writer.flush()

    const saved = JSON.parse(await readFile(join(dir, "session-telemetry.json"), "utf8"))
    expect(saved.sessions[0]?.role).toBe("reader-interviewer")
    expect(saved.sessions[0]?.calls[0]?.resolvedModel).toBe("gpt-5")
    expect(saved.sessions[0]?.calls[0]?.usage).toMatchObject({
      tokensIn: 80,
      tokensOut: 12,
      costUsd: 0.004,
      costAvailable: true,
    })
    expect(saved.sessions[0]?.calls[0]?.usageSource).toBe("sdk")

    writer.dispose()
  })

  test("createSessionTelemetryWriter stamps graph node on usage events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorum-session-telemetry-node-"))
    const bus = createEventBus()
    const writer = createSessionTelemetryWriter(dir, bus)

    bus.emit({ kind: "session.created", sessionID: "ses_node", role: "source-auditor" })
    bus.emit({ kind: "graph.node", node: "runParallelAudits", phase: "start", state: { round: 2 } as never })
    bus.emit({
      kind: "agent.usage",
      sessionID: "ses_node",
      messageID: "msg_node",
      tokensIn: 42,
      tokensOut: 7,
      source: "opencode",
    })

    await writer.flush()

    const saved = JSON.parse(await readFile(join(dir, "session-telemetry.json"), "utf8"))
    expect(saved.sessions[0]?.node).toBe("runParallelAudits")
    expect(saved.sessions[0]?.round).toBe(2)

    writer.dispose()
  })

  test("resolveRunTelemetry reads only session telemetry", () => {
    const resolved = resolveRunTelemetry({
      version: 1,
      sessions: [{
        sessionId: "ses_123",
        role: "research-drafter",
        provider: "opencode",
        calls: [{
          usage: {
            tokensIn: 1000,
            tokensOut: 200,
            costUsd: 0.02,
            costAvailable: true,
            costEstimated: false,
          },
          usageSource: "sdk",
        }],
      }],
    })

    expect(resolved.usage.tokensIn).toBe(1000)
    expect(resolved.usage.tokensOut).toBe(200)
    expect(resolved.usage.costUsd).toBeCloseTo(0.02)
  })
})
