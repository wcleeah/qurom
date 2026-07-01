import { beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { z } from "zod"

import type { RuntimeConfig } from "../src/config"
import { createEventBus, type RunnerEvent } from "../src/runner"

const createCalls: unknown[] = []
const sendCalls: string[] = []
let waitResult: unknown = { status: "finished", result: "plain response" }
let waitResults: unknown[] = []
let waitErrors: unknown[] = []
let artifactPath = "artifacts/reader-profile.json"
let artifactBytes = Buffer.from(JSON.stringify({ ok: true }))
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
          agentId: "bc-cursor-agent-1",
          async listArtifacts() {
            return [{ path: artifactPath, sizeBytes: artifactBytes.byteLength, updatedAt: new Date().toISOString() }]
          },
          async downloadArtifact(path: string) {
            if (path !== artifactPath) throw new Error(`Missing artifact ${path}`)
            return artifactBytes
          },
          async send(prompt: string, options?: { onDelta?: (args: { update: unknown }) => void }) {
            sendCalls.push(prompt)
            options?.onDelta?.({ update: { type: "thinking-delta", text: "thinking..." } })
            options?.onDelta?.({
              update: {
                type: "tool-call-started",
                callId: "call-1",
                toolCall: { type: "shell", args: { command: "echo hi" } },
              },
            })
            options?.onDelta?.({
              update: {
                type: "tool-call-completed",
                callId: "call-1",
                toolCall: { type: "shell", result: { status: "success", value: "hi" } },
              },
            })
            options?.onDelta?.({ update: { type: "text-delta", text: "hello" } })
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
                const result = waitResults.shift()
                if (result) return result
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
  waitResults = []
  waitErrors = []
  artifactPath = "artifacts/reader-profile.json"
  artifactBytes = Buffer.from(JSON.stringify({ ok: true }))
  cancelCalled = false
  disposeCalled = false
  delete process.env.CURSOR_MCP_CONFIG_PATH
})

describe("cursorProvider", () => {
  async function tempOutputFile(name = "cursor-output.txt") {
    const dir = await mkdtemp(join(tmpdir(), "qurom-cursor-output-"))
    return join(dir, name)
  }

  test("creates a cloud Cursor agent with per-role model by default", async () => {
    const handle = await cursorProvider.createRunHandle({
      config,
      role: "research-drafter",
      title: "draft",
    })

    expect(handle.id).toBe("bc-cursor-agent-1")
    expect(createCalls[0]).toMatchObject({
      apiKey: "cursor-test-key",
      name: "draft",
      model: { id: "composer-2.5", params: [{ id: "fast", value: "true" }] },
      cloud: {},
    })
  })

  test("can create a local Cursor agent when role options request it", async () => {
    const localConfig: RuntimeConfig = {
      ...config,
      quorumConfig: {
        ...config.quorumConfig,
        agentRuntime: {
          ...config.quorumConfig.agentRuntime,
          roles: {
            "research-drafter": {
              provider: "cursor",
              model: "composer-2.5",
              options: {
                runtime: "local",
                settingSources: ["project"],
                modelParams: [{ id: "fast", value: "true" }],
              },
            },
          },
        },
      },
    }

    await cursorProvider.createRunHandle({
      config: localConfig,
      role: "research-drafter",
      title: "draft",
    })

    expect(createCalls[0]).toMatchObject({
      local: { cwd: process.cwd(), settingSources: ["project"] },
    })
  })

  test("copies configured MCP server definitions from Cursor mcp.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qurom-cursor-mcp-"))
    process.env.CURSOR_MCP_CONFIG_PATH = join(dir, "mcp.json")
    await writeFile(process.env.CURSOR_MCP_CONFIG_PATH, JSON.stringify({
      mcpServers: {
        webfetch: { url: "https://mcp.example/webfetch" },
        exa: { command: "npx", args: ["-y", "exa-mcp-server"] },
        unused: { url: "https://mcp.example/unused" },
      },
    }))
    const mcpConfig: RuntimeConfig = {
      ...config,
      quorumConfig: {
        ...config.quorumConfig,
        researchTools: { prefer: ["webfetch", "exa"], webSearchProvider: "exa" },
        agentRuntime: {
          ...config.quorumConfig.agentRuntime,
          roles: {
            "research-drafter": {
              provider: "cursor",
              model: "composer-2.5",
              options: {
                mcpServers: {
                  exa: { url: "https://override.example/exa" },
                },
              },
            },
          },
        },
      },
    }

    await cursorProvider.createRunHandle({
      config: mcpConfig,
      role: "research-drafter",
      title: "draft",
    })

    expect(createCalls[0]).toMatchObject({
      mcpServers: {
        webfetch: { url: "https://mcp.example/webfetch" },
        exa: { url: "https://override.example/exa" },
      },
    })
    expect(createCalls[0]).not.toMatchObject({
      mcpServers: {
        unused: { url: "https://mcp.example/unused" },
      },
    })
  })

  test("parses structured output through app-owned recovery", async () => {
    const outputFile = await tempOutputFile("reader-profile.json")
    waitResult = { status: "finished", result: "OK" }
    artifactPath = "artifacts/reader-profile.json"
    artifactBytes = Buffer.from(JSON.stringify({ ok: true }))
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
      outputFile,
    })

    expect(result.structured).toEqual({ ok: true })
    expect(result.provider).toBe("cursor")
    expect(sendCalls[0]).toBe("return json")
    expect(sendCalls[0]).not.toContain("Output requirements:")
    expect(sendCalls[0]).not.toContain("## Output instructions")
  })

  test("emits runner activity events from Cursor deltas", async () => {
    const outputFile = await tempOutputFile("message.txt")
    artifactPath = "artifacts/message.txt"
    artifactBytes = Buffer.from("plain response")
    const bus = createEventBus()
    const events: RunnerEvent[] = []
    bus.on((event) => events.push(event))
    const handle = await cursorProvider.createRunHandle({
      config,
      role: "research-drafter",
      title: "draft",
    })

    await cursorProvider.prompt({
      config,
      bus,
      handle,
      role: "research-drafter",
      prompt: "hello",
      outputFile,
    })

    expect(events.some((event) => event.kind === "agent.message.start" && event.sessionID === handle.id)).toBe(true)
    expect(events).toContainEqual({
      kind: "agent.reasoning",
      sessionID: handle.id,
      key: "cursor-thinking",
      text: "thinking...",
      done: false,
    })
    expect(events).toContainEqual(expect.objectContaining({
      kind: "agent.tool",
      tool: "shell",
      status: "running",
      callID: "call-1",
      sessionID: handle.id,
    }))
    expect(events).toContainEqual(expect.objectContaining({
      kind: "agent.tool",
      tool: "shell",
      status: "completed",
      callID: "call-1",
      sessionID: handle.id,
    }))
    expect(events).toContainEqual(expect.objectContaining({
      kind: "agent.message.text",
      sessionID: handle.id,
      text: "hello",
    }))
  })

  test("downloads Cursor cloud artifact output over stale local files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qurom-cursor-artifact-"))
    const outputFile = join(dir, "reader-profile.json")
    await mkdir(dir, { recursive: true })
    await writeFile(outputFile, JSON.stringify({ ok: false }))
    waitResult = { status: "finished", result: "OK" }
    artifactPath = "artifacts/reader-profile.json"
    artifactBytes = Buffer.from(JSON.stringify({ ok: true }))
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
      outputFile,
    })

    expect(result.structured).toEqual({ ok: true })
    expect(JSON.parse(await readFile(outputFile, "utf8"))).toEqual({ ok: true })
    const files = await readdir(dirname(outputFile))
    expect(files).not.toContain("reader-profile.json.cursor-response.json")
    const metadataFile = files.find((file) => /^cursor-research-drafter-call-1-attempt-1-cursor-run-1-metadata\.json$/.test(file))
    const resultFile = files.find((file) => /^cursor-research-drafter-call-1-attempt-1-cursor-run-1-result\.json$/.test(file))
    const responseFile = files.find((file) => /^cursor-research-drafter-call-1-attempt-1-cursor-run-1-response\.txt$/.test(file))
    const artifactsFile = files.find((file) => /^cursor-research-drafter-call-1-attempt-1-cursor-run-1-artifacts\.json$/.test(file))
    expect(metadataFile).toBeDefined()
    expect(resultFile).toBeDefined()
    expect(responseFile).toBeDefined()
    expect(artifactsFile).toBeDefined()
    expect(await readFile(join(dirname(outputFile), responseFile!), "utf8")).toBe("OK")
    expect(JSON.parse(await readFile(join(dirname(outputFile), metadataFile!), "utf8"))).toMatchObject({
      agentId: "bc-cursor-agent-1",
      runId: "cursor-run-1",
      requestedArtifact: "reader-profile.json",
    })
    expect(JSON.parse(await readFile(join(dirname(outputFile), artifactsFile!), "utf8"))).toEqual([
      expect.objectContaining({ path: "artifacts/reader-profile.json" }),
    ])
    expect(sendCalls[0]).toBe("return json")
  })

  test("downloads Cursor cloud artifacts from nested agents/artifacts paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qurom-cursor-nested-artifact-"))
    const outputFile = join(dir, "reader-profile.json")
    waitResult = { status: "finished", result: "OK" }
    artifactPath = "agents/artifacts/reader-profile.json"
    artifactBytes = Buffer.from(JSON.stringify({ ok: true }))
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
      outputFile,
    })

    expect(result.structured).toEqual({ ok: true })
    expect(JSON.parse(await readFile(outputFile, "utf8"))).toEqual({ ok: true })
  })

  test("rejects Cursor prompts without an output file", async () => {
    const handle = await cursorProvider.createRunHandle({
      config,
      role: "research-drafter",
      title: "draft",
    })

    await expect(cursorProvider.prompt({
      config,
      handle,
      role: "research-drafter",
      prompt: "return inline",
    })).rejects.toThrow("inline output is disabled")
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
    const outputFile = await tempOutputFile("message.txt")
    artifactPath = "artifacts/message.txt"
    artifactBytes = Buffer.from("plain response")
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
      outputFile,
    })

    await cursorProvider.abort?.(config, handle.id)

    expect(cancelCalled).toBe(true)
    expect(disposeCalled).toBe(true)
  })

  test("retries transient Cursor transport errors once", async () => {
    const outputFile = await tempOutputFile("message.txt")
    artifactPath = "artifacts/message.txt"
    artifactBytes = Buffer.from("plain response")
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
      outputFile,
    })

    expect(result.text).toBe("plain response")
    expect(sendCalls).toHaveLength(2)
  })

  test("retries Cursor runs that return status error once", async () => {
    const outputFile = await tempOutputFile("message.txt")
    artifactPath = "artifacts/message.txt"
    artifactBytes = Buffer.from("recovered response")
    waitResults = [
      { status: "error", result: "", message: "Stream closed with error code NGHTTP2_FRAME_SIZE_ERROR" },
      { status: "finished", result: "recovered response" },
    ]
    const debugEvents: Array<{ type: string; data?: Record<string, unknown> }> = []
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
      outputFile,
      telemetry: {
        debugLog: {
          write(type, data) {
            debugEvents.push({ type, data })
          },
        },
      } as never,
    })

    expect(result.text).toBe("recovered response")
    expect(sendCalls).toHaveLength(2)
    expect(debugEvents).toHaveLength(1)
    expect(debugEvents[0]).toMatchObject({
      type: "cursor.prompt.error",
      data: {
        role: "research-drafter",
        agentId: "bc-cursor-agent-1",
        attempt: 1,
        willRetry: true,
        name: "CursorRunStatusError",
        runId: "cursor-run-1",
        status: "error",
      },
    })
  })
})
