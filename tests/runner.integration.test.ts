import { describe, expect, test } from "bun:test"

import { createEventBus, type BridgeFactory, type GraphFactory, type RunQuorumArgs, runQuorum } from "../src/runner.ts"
import type { RuntimeConfig } from "../src/config.ts"
import type { TelemetryRun } from "../src/telemetry.ts"

const shouldRun = process.env.RUN_INTEGRATION === "1"

const testIfIntegration = shouldRun ? test : test.skip

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

const prerequisites = {
  skill: { name: "research", content: "skill" },
  agents: [],
} as unknown as RunQuorumArgs["prerequisites"]

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

describe("runQuorum integration", () => {
  testIfIntegration("two back-to-back runs do not duplicate bridge events", async () => {
    const graphStarts: string[] = []
    let bridgeStartCalls = 0

    const graphFactory: GraphFactory = ((_, __, input) => ({
      invoke: async (request) => {
        input?.observer?.onNodeStart?.("ingestRequest", request)
        input?.observer?.onNodeEnd?.("ingestRequest", request)
        input?.observer?.onSessionCreated?.({
          sessionID: `root-${request.requestId}`,
          role: "root",
          requestId: request.requestId,
        })
        input?.observer?.onSessionCreated?.({
          sessionID: `drafter-${request.requestId}`,
          role: "drafter",
          requestId: request.requestId,
        })
        graphStarts.push(request.requestId)
        return {
          requestId: request.requestId,
          status: "approved",
          round: 0,
          approvedAgents: ["source-auditor"],
          unresolvedFindings: [],
          failureReason: undefined,
          outputPath: `runs/${request.requestId}`,
        }
      },
    })) as GraphFactory

    const bridgeFactory: BridgeFactory = (_, { bus }) => ({
      async start() {
        bridgeStartCalls += 1
        bus.emit({ kind: "session.status", sessionID: "drafter-run", status: "active" })
        bus.emit({ kind: "agent.tool", tool: "read", status: "running", callID: "call-1", sessionID: "drafter-run", messageID: "m-1", partID: "p-1" })
        bus.emit({ kind: "agent.tool", tool: "read", status: "completed", callID: "call-1", sessionID: "drafter-run", messageID: "m-1", partID: "p-1" })
      },
      async stop() {},
    })

    const runOnce = async () => {
      const bus = createEventBus()
      const events: string[] = []
      bus.on((event) => events.push(event.kind === "agent.tool" ? `${event.kind}:${event.tool}:${event.status}` : event.kind))

      await runQuorum({
        config,
        prerequisites,
        request: { inputMode: "topic", topic: "test" },
        bus,
        graphFactory,
        bridgeFactory,
        telemetryFactory: async () => disabledTelemetry(),
      })

      return events
    }

    const first = await runOnce()
    const second = await runOnce()

    expect(first.filter((event) => event === "agent.tool:read:running")).toHaveLength(1)
    expect(first.filter((event) => event === "agent.tool:read:completed")).toHaveLength(1)
    expect(second.filter((event) => event === "agent.tool:read:running")).toHaveLength(1)
    expect(second.filter((event) => event === "agent.tool:read:completed")).toHaveLength(1)
    expect(bridgeStartCalls).toBe(2)
    expect(graphStarts).toHaveLength(2)
  })
})
