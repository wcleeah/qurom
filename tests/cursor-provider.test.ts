import { beforeEach, describe, expect, mock, test } from "bun:test"
import { z } from "zod"

import type { RuntimeConfig } from "../src/config"

const createCalls: unknown[] = []
const sendCalls: string[] = []
let waitResult: unknown = { status: "finished", result: "plain response" }
let waitErrors: unknown[] = []
let cancelCalled = false
let disposeCalled = false

mock.module("@cursor/sdk", () => {
  class CursorSdkError extends Error {
    readonly isRetryable: boolean
    readonly code?: string
    readonly status?: number
    readonly requestId?: string

    constructor(message: string, options: {
      isRetryable?: boolean
      code?: string
      status?: number
      requestId?: string
    } = {}) {
      super(message)
      this.isRetryable = options.isRetryable ?? false
      this.code = options.code
      this.status = options.status
      this.requestId = options.requestId
    }
  }
  class CursorAgentError extends CursorSdkError {}
  return {
    CursorSdkError,
    CursorAgentError,
    Cursor: {
      models: {
        list: mock(async () => [{
          id: "composer-2.5",
          name: "Composer 2.5",
          parameters: [{
            id: "fast",
            displayName: "Reasoning",
            values: [
              { value: "false", displayName: "Careful" },
              { value: "true", displayName: "Fast" },
            ],
          }],
        }]),
      },
    },
    Agent: {
      create: mock(async (options: unknown) => {
        createCalls.push(options)
        return {
          agentId: "cursor-agent-1",
          async send(prompt: string) {
            sendCalls.push(prompt)
            return {
              id: "cursor-run-1",
              supports(op: string) {
                return op === "cancel"
              },
              async cancel() {
                cancelCalled = true
              },
              async wait() {
                const error = waitErrors.shift()
                if (error) throw error
                return waitResult
              },
            }
          },
          async [Symbol.asyncDispose]() {
            disposeCalled = true
          },
        }
      }),
    },
  }
})

const { cursorProvider } = await import("../src/providers/cursor")

const config: RuntimeConfig = {
  env: {
    OPENCODE_BASE_URL: "http://127.0.0.1:4096",
    OPENCODE_DIRECTORY: process.cwd(),
    QUORUM_WORKSPACE_DIRECTORY: process.cwd(),
    QUORUM_CHECKPOINT_PATH: "runs/checkpoints.sqlite",
    QUORUM_CONFIG_DB_PATH: "runs/quorum-config.sqlite",
    QUORUM_CAPTURE_OPENCODE_EVENTS: "0",
    QUORUM_CAPTURE_SYNC_HISTORY: "0",
    CURSOR_API_KEY: "cursor-test-key",
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
    recursionLimit: 80,
    requireUnanimousApproval: true,
    artifactDir: "runs",
    promptAssetsDir: "assets/prompts",
    promptManagement: { source: "local", label: "production" },
    researchTools: { prefer: ["webfetch"], webSearchProvider: "exa" },
    auditRestart: { maxRestarts: 1 },
    readerDiscovery: { maxTurns: 6, enabled: true },
    agentRuntime: {
      defaultProvider: "opencode",
      roles: {
        "research-drafter": {
          provider: "cursor",
          model: "composer-2.5",
          options: { modelParams: [{ id: "fast", value: "true" }] },
        },
      },
    },
  },
}

beforeEach(() => {
  createCalls.length = 0
  sendCalls.length = 0
  waitResult = { status: "finished", result: "plain response" }
  waitErrors = []
  cancelCalled = false
  disposeCalled = false
})

describe("cursorProvider", () => {
  test("creates a local Cursor agent with per-role model", async () => {
    const handle = await cursorProvider.createRunHandle({
      config,
      role: "research-drafter",
      title: "draft",
    })

    expect(handle.id).toBe("cursor-agent-1")
    expect(createCalls[0]).toMatchObject({
      apiKey: "cursor-test-key",
      name: "draft",
      model: { id: "composer-2.5", params: [{ id: "fast", value: "true" }] },
      local: { cwd: process.cwd(), settingSources: [] },
    })
  })

  test("parses structured output through app-owned recovery", async () => {
    waitResult = { status: "finished", result: JSON.stringify({ ok: true }) }
    const handle = await cursorProvider.createRunHandle({
      config,
      role: "research-drafter",
      title: "draft",
    })

    const result = await cursorProvider.prompt({
      config,
      handle,
      role: "research-drafter",
      prompt: "return json",
      schema: z.object({ ok: z.boolean() }),
    })

    expect(result.structured).toEqual({ ok: true })
    expect(result.provider).toBe("cursor")
    expect(sendCalls[0]).toContain("Output requirements:")
  })

  test("fails when a Cursor-bound role has no model", async () => {
    const missingModel: RuntimeConfig = {
      ...config,
      quorumConfig: {
        ...config.quorumConfig,
        agentRuntime: {
          defaultProvider: "opencode",
          roles: {
            "research-drafter": { provider: "cursor", options: {} },
          },
        },
      },
    }

    await expect(cursorProvider.createRunHandle({
      config: missingModel,
      role: "research-drafter",
      title: "draft",
    })).rejects.toThrow("requires agentRuntime.roles")
  })

  test("cancels and disposes active runs", async () => {
    const handle = await cursorProvider.createRunHandle({
      config,
      role: "research-drafter",
      title: "draft",
    })
    await cursorProvider.prompt({
      config,
      handle,
      role: "research-drafter",
      prompt: "hello",
    })

    await cursorProvider.abort?.(config, handle.id)

    expect(cancelCalled).toBe(true)
    expect(disposeCalled).toBe(true)
  })

  test("retries transient Cursor transport errors once", async () => {
    waitErrors = [new Error("[unknown] [internal] Stream closed with error code NGHTTP2_FRAME_SIZE_ERROR")]
    const handle = await cursorProvider.createRunHandle({
      config,
      role: "research-drafter",
      title: "draft",
    })

    const result = await cursorProvider.prompt({
      config,
      handle,
      role: "research-drafter",
      prompt: "hello",
    })

    expect(result.text).toBe("plain response")
    expect(sendCalls).toHaveLength(2)
  })
})
