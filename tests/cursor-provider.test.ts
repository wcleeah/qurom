import { beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { z } from "zod"

import type { RuntimeConfig } from "../src/config"
import { createEventBus, type RunnerEvent } from "../src/runner"
import { testQuorumConfig, testRuntimeEnv, unitTestDataDir } from "./test-env"

const createCalls: unknown[] = []
const resumeCalls: unknown[] = []
const sendCalls: string[] = []
let waitResult: unknown = { status: "finished", result: "plain response" }
let waitResults: unknown[] = []
let waitErrors: unknown[] = []
let sendErrors: unknown[] = []
let listRunsItems: unknown[] = []
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
  class AgentBusyError extends CursorAgentError {
    constructor(message = "[agent_busy] Agent already has an active run") {
      super(message, { isRetryable: false, code: "agent_busy", status: 409 })
      this.name = "AgentBusyError"
    }
  }
  return {
    CursorSdkError,
    CursorAgentError,
    AgentBusyError,
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
        }, {
          id: "claude-opus-4-8",
          name: "Opus 4.8",
          parameters: [{
            id: "thinking",
            displayName: "Thinking",
            values: [
              { value: "false" },
              { value: "true" },
            ],
          }, {
            id: "context",
            displayName: "Context",
            values: [
              { value: "300k" },
              { value: "1m" },
            ],
          }],
          variants: [{
            isDefault: true,
            params: [
              { id: "cyber", value: "false" },
              { id: "thinking", value: "true" },
              { id: "context", value: "1m" },
              { id: "effort", value: "high" },
              { id: "fast", value: "false" },
            ],
          }],
        }]),
      },
    },
    Agent: {
      create: mock(async (options: unknown) => {
        createCalls.push(options)
        return createMockAgent("bc-cursor-agent-1")
      }),
      resume: mock(async (agentId: string, options: unknown) => {
        resumeCalls.push({ agentId, options })
        return createMockAgent(agentId)
      }),
      getRun: mock(async () => ({
        id: "cursor-run-attached",
        agentId: "bc-cursor-agent-1",
        status: "running" as const,
        async wait() {
          const error = waitErrors.shift()
          if (error) throw error
          const result = waitResults.shift()
          if (result) return result
          return waitResult
        },
      })),
      listRuns: mock(async () => ({ items: listRunsItems })),
    },
  }

  function createMockAgent(agentId: string) {
    return {
      agentId,
      async listArtifacts() {
        return [{ path: artifactPath, sizeBytes: artifactBytes.byteLength, updatedAt: new Date().toISOString() }]
      },
      async downloadArtifact(path: string) {
        if (path !== artifactPath) throw new Error(`Missing artifact ${path}`)
        return artifactBytes
      },
      async send(prompt: string, options?: { onDelta?: (args: { update: unknown }) => void }) {
        sendCalls.push(prompt)
        const sendError = sendErrors.shift()
        if (sendError) throw sendError
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
          id: `cursor-run-${sendCalls.length}`,
          agentId,
          status: "running" as const,
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
  }
})

const { AgentBusyError, CursorSdkError } = await import("@cursor/sdk")
const { cursorProvider, clampCursorAgentName, cursorAgentBusyRetry, isCursorAgentBusyError } = await import("../src/providers/cursor")

const config: RuntimeConfig = {
  env: {
    ...testRuntimeEnv({ dataDir: unitTestDataDir("cursor-provider"), workspaceDir: process.cwd() }),
    CURSOR_API_KEY: "cursor-test-key",
    CONTEXT7_API_KEY: undefined,
    EXA_API_KEY: undefined,
    LANGFUSE_PUBLIC_KEY: undefined,
    LANGFUSE_SECRET_KEY: undefined,
    LANGFUSE_BASE_URL: undefined,
  },
  quorumConfig: testQuorumConfig({
    maxRounds: 1,
    researchTools: { prefer: ["webfetch"], webSearchProvider: "exa" },
  }),
  roleBindings: {
    "research-drafter": {
      provider: "cursor",
      model: "composer-2.5",
      options: { modelParams: [{ id: "fast", value: "true" }] },
    },
  },
  mcpRegistry: { servers: [], enabled: [] },
}

beforeEach(() => {
  createCalls.length = 0
  resumeCalls.length = 0
  sendCalls.length = 0
  waitResult = { status: "finished", result: "plain response" }
  waitResults = []
  waitErrors = []
  sendErrors = []
  listRunsItems = []
  artifactPath = "artifacts/reader-profile.json"
  artifactBytes = Buffer.from(JSON.stringify({ ok: true }))
  cancelCalled = false
  disposeCalled = false
  cursorAgentBusyRetry.extraSendAttempts = 0
  cursorAgentBusyRetry.sleep = async () => {}
  delete process.env.CURSOR_MCP_CONFIG_PATH
  delete process.env.CONTEXT7_API_KEY
  delete process.env.GENERIC_MCP_TOKEN
  delete process.env.SEARCH_API_KEY
})

describe("cursorProvider", () => {
  async function tempOutputFile(name = "cursor-output.txt") {
    const dir = await mkdtemp(join(tmpdir(), "qurom-cursor-output-"))
    return join(dir, name)
  }

  test("clampCursorAgentName keeps short names and truncates long ones", () => {
    expect(clampCursorAgentName("draft")).toBe("draft")
    const long = "html-ask:" + "a".repeat(120)
    const clamped = clampCursorAgentName(long)
    expect(clamped.length).toBe(100)
    expect(clamped).toMatch(/-[a-f0-9]{8}$/)
  })

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

  test("resumes a Cursor agent by id and can prompt again", async () => {
    const handle = await cursorProvider.resumeRunHandle!({
      config,
      role: "research-drafter",
      title: "html-ask:thread-1",
      handleId: "bc-existing-agent",
    })

    expect(handle.id).toBe("bc-existing-agent")
    expect(resumeCalls[0]).toMatchObject({
      agentId: "bc-existing-agent",
      options: {
        apiKey: "cursor-test-key",
        cloud: {},
      },
    })

    const result = await cursorProvider.prompt({
      config,
      role: "research-drafter",
      handle,
      prompt: "follow up",
    })
    expect(result.text).toBe("plain response")
    expect(sendCalls).toEqual(["follow up"])
  })

  test("clamps long agent titles before calling Cursor create", async () => {
    const longTitle = "audit:" + "x".repeat(120)
    await cursorProvider.createRunHandle({
      config,
      role: "research-drafter",
      title: longTitle,
    })

    const createOptions = createCalls[0] as { name?: string }
    expect(createOptions.name).toBe(clampCursorAgentName(longTitle))
    expect(createOptions.name!.length).toBe(100)
  })

  test("can create a local Cursor agent when role options request it", async () => {
    const localConfig: RuntimeConfig = {
      ...config,
      roleBindings: {
        ...config.roleBindings,
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

  test("overlays saved form params onto the catalog default variant", async () => {
    const mcpConfig: RuntimeConfig = {
      ...config,
      roleBindings: {
        ...config.roleBindings,
        "research-drafter": {
          provider: "cursor",
          model: "claude-opus-4-8",
          options: {
            modelParams: [
              { id: "thinking", value: "true" },
              { id: "context", value: "300k" },
              { id: "effort", value: "low" },
              { id: "fast", value: "false" },
            ],
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
      model: {
        id: "claude-opus-4-8",
        params: [
          { id: "cyber", value: "false" },
          { id: "thinking", value: "true" },
          { id: "context", value: "300k" },
          { id: "effort", value: "high" },
          { id: "fast", value: "false" },
        ],
      },
    })
  })

  test("does not send leftover params from a previous model", async () => {
    const leftoverConfig: RuntimeConfig = {
      ...config,
      roleBindings: {
        ...config.roleBindings,
        "research-drafter": {
          provider: "cursor",
          model: "claude-opus-4-8",
          options: {
            modelParams: [
              { id: "fast", value: "true" },
              { id: "thinking", value: "false" },
            ],
          },
        },
      },
    }

    await cursorProvider.createRunHandle({
      config: leftoverConfig,
      role: "research-drafter",
      title: "draft",
    })

    expect(createCalls[0]).toMatchObject({
      model: {
        id: "claude-opus-4-8",
        params: [
          { id: "cyber", value: "false" },
          { id: "thinking", value: "false" },
          { id: "context", value: "1m" },
          { id: "effort", value: "high" },
          { id: "fast", value: "false" },
        ],
      },
    })
  })

  test("maps enabled MCP server definitions from the SQLite-backed runtime registry", async () => {
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
      mcpRegistry: {
        servers: [
          { name: "webfetch", type: "remote", url: "https://mcp.example/webfetch", headers: {} },
          { name: "exa", type: "remote", url: "https://registry.example/exa", headers: {} },
          { name: "unused", type: "remote", url: "https://mcp.example/unused", headers: {} },
        ],
        enabled: ["webfetch", "exa"],
      },
      quorumConfig: {
        ...config.quorumConfig,
        researchTools: { prefer: ["webfetch", "exa"], webSearchProvider: "exa" },
      },
      roleBindings: {
        ...config.roleBindings,
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
    }

    await cursorProvider.createRunHandle({
      config: mcpConfig,
      role: "research-drafter",
      title: "draft",
    })

    expect(createCalls[0]).toMatchObject({
      mcpServers: {
        webfetch: { url: "https://mcp.example/webfetch" },
        exa: { url: "https://registry.example/exa" },
      },
    })
    expect(createCalls[0]).not.toMatchObject({
      mcpServers: {
        unused: { url: "https://mcp.example/unused" },
      },
    })
  })

  test("interpolates environment placeholders in Cursor MCP definitions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qurom-cursor-mcp-env-"))
    process.env.CURSOR_MCP_CONFIG_PATH = join(dir, "mcp.json")
    process.env.CONTEXT7_API_KEY = "context7-secret"
    process.env.GENERIC_MCP_TOKEN = "generic-secret"
    await writeFile(process.env.CURSOR_MCP_CONFIG_PATH, JSON.stringify({
      mcpServers: {
        context7: {
          command: "context7-mcp",
          env: { CONTEXT7_API_KEY: "${env:CONTEXT7_API_KEY}" },
        },
        generic: {
          command: "generic-mcp",
          args: ["--token", "{ENV:GENERIC_MCP_TOKEN}"],
          env: { GENERIC_MCP_TOKEN: "{ENV:GENERIC_MCP_TOKEN}" },
        },
      },
    }))
    const mcpConfig: RuntimeConfig = {
      ...config,
      mcpRegistry: {
        servers: [
          { name: "context7", type: "local", command: "context7-mcp", args: [], env: { CONTEXT7_API_KEY: "${env:CONTEXT7_API_KEY}" } },
          { name: "generic", type: "local", command: "generic-mcp", args: ["--token", "{ENV:GENERIC_MCP_TOKEN}"], env: { GENERIC_MCP_TOKEN: "{ENV:GENERIC_MCP_TOKEN}" } },
        ],
        enabled: ["context7", "generic"],
      },
      quorumConfig: {
        ...config.quorumConfig,
        researchTools: { prefer: ["context7", "generic"], webSearchProvider: "exa" },
      },
    }

    await cursorProvider.createRunHandle({
      config: mcpConfig,
      role: "research-drafter",
      title: "draft",
    })

    expect(createCalls[0]).toMatchObject({
      mcpServers: {
        context7: {
          env: { CONTEXT7_API_KEY: "context7-secret" },
        },
        generic: {
          args: ["--token", "generic-secret"],
          env: { GENERIC_MCP_TOKEN: "generic-secret" },
        },
      },
    })
  })

  test("ignores legacy role-level Cursor MCP overrides", async () => {
    process.env.SEARCH_API_KEY = "role-search-secret"
    const mcpConfig: RuntimeConfig = {
      ...config,
      roleBindings: {
        ...config.roleBindings,
        "research-drafter": {
          provider: "cursor",
          model: "composer-2.5",
          options: {
            mcpServers: {
              search: {
                url: "https://mcp.example/search?key=${env:SEARCH_API_KEY}",
                headers: { Authorization: "Bearer ${env:SEARCH_API_KEY}" },
                env: { SEARCH_API_KEY: "${SEARCH_API_KEY}" },
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

    expect(createCalls[0]).not.toHaveProperty("mcpServers")
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

  test("provides indirect downloadable artifact output instructions for runtime prompt construction", async () => {
    const instructions = cursorProvider.outputInstructions?.({
      config,
      handle: {
        id: "bc-cursor-agent-1",
        providerId: "cursor",
        role: "research-drafter",
        title: "draft",
      },
      role: "research-drafter",
      outputFile: "/tmp/reader-profile-1.json",
      schema: z.object({ ok: z.boolean() }),
    })

    expect(instructions).toContain("Write the downloadable Cursor Cloud artifact to `/opt/cursor/artifacts/reader-profile-1.json`")
    expect(instructions).toContain("The artifact must be named exactly `reader-profile-1.json`")
    expect(instructions).toContain("\"ok\"")
    expect(instructions).not.toContain("/tmp/reader-profile-1.json")
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

  test("rejects structured Cursor prompts without an output file", async () => {
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
      schema: z.object({ ok: z.boolean() }),
    })).rejects.toThrow("Cursor provider requires outputFile for structured prompts")
  })

  test("fails when a Cursor-bound role has no model", async () => {
    const missingModel: RuntimeConfig = {
      ...config,
      roleBindings: {
        "research-drafter": { provider: "cursor", options: {} },
      },
    }

    await expect(cursorProvider.createRunHandle({
      config: missingModel,
      role: "research-drafter",
      title: "draft",
    })).rejects.toThrow("requires roleBindings")
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
    expect(cancelCalled).toBe(true)
    expect(debugEvents).toHaveLength(2)
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
    expect(debugEvents[1]).toMatchObject({
      type: "cursor.prompt.complete",
      data: {
        role: "research-drafter",
        handleId: "bc-cursor-agent-1",
      },
    })
  })

  test("attaches to the active run when send returns agent_busy", async () => {
    const outputFile = await tempOutputFile("message.txt")
    artifactPath = "artifacts/message.txt"
    artifactBytes = Buffer.from("recovered response")
    waitResults = [
      { status: "error", result: "", message: "transient run failure" },
      { status: "finished", result: "recovered response" },
    ]
    sendErrors = [null, new AgentBusyError()]
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

    expect(result.text).toBe("recovered response")
    expect(sendCalls).toHaveLength(2)
    expect(cancelCalled).toBe(true)
    expect(result.raw).toMatchObject({ runId: "cursor-run-1" })
  })

  test("fails agent_busy when there is no active run to attach", async () => {
    const outputFile = await tempOutputFile("message.txt")
    sendErrors = [new AgentBusyError()]
    const handle = await cursorProvider.createRunHandle({
      config,
      role: "research-drafter",
      title: "draft",
    })

    await expect(cursorProvider.prompt({
      config,
      handle,
      role: "research-drafter",
      prompt: "hello",
      outputFile,
    })).rejects.toThrow(/agent_busy/)
    expect(sendCalls).toHaveLength(1)
  })

  test("attaches to a live run when agent_busy is a CursorSdkError with code", async () => {
    const outputFile = await tempOutputFile("message.txt")
    artifactPath = "artifacts/message.txt"
    artifactBytes = Buffer.from("recovered response")
    waitResult = { status: "finished", result: "recovered response" }
    sendErrors = [new CursorSdkError("[agent_busy] Agent already has an active run", {
      isRetryable: false,
      code: "agent_busy",
      status: 409,
    })]
    listRunsItems = [{
      id: "cursor-run-live",
      agentId: "bc-cursor-agent-1",
      status: "running",
      supports() {
        return false
      },
      async wait() {
        return waitResult
      },
    }]
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

    expect(sendCalls).toHaveLength(1)
    expect(result.text).toBe("recovered response")
    expect(result.raw).toMatchObject({ runId: "cursor-run-live" })
  })

  test("retries send after agent_busy when the previous run has already finished", async () => {
    const outputFile = await tempOutputFile("message.txt")
    artifactPath = "artifacts/message.txt"
    artifactBytes = Buffer.from("follow-up response")
    waitResult = { status: "finished", result: "follow-up response" }
    cursorAgentBusyRetry.extraSendAttempts = 2
    sendErrors = [new CursorSdkError("[agent_busy] Agent already has an active run", {
      isRetryable: false,
      code: "agent_busy",
      status: 409,
    })]
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

    expect(sendCalls).toHaveLength(2)
    expect(result.text).toBe("follow-up response")
  })

  test("isCursorAgentBusyError matches SDK code and message shapes", () => {
    expect(isCursorAgentBusyError(new AgentBusyError())).toBe(true)
    expect(isCursorAgentBusyError(new CursorSdkError("[agent_busy] Agent already has an active run", {
      code: "agent_busy",
      status: 409,
    }))).toBe(true)
    expect(isCursorAgentBusyError(new Error("NGHTTP2_REFUSED_STREAM"))).toBe(false)
  })

  test("collectExistingOutput waits on a live cloud run without sending", async () => {
    const outputFile = await tempOutputFile("reader-profile.json")
    artifactPath = "artifacts/reader-profile.json"
    artifactBytes = Buffer.from(JSON.stringify({ ok: true }))
    const handle = await cursorProvider.createRunHandle({
      config,
      role: "research-drafter",
      title: "draft",
    })
    listRunsItems = [{
      id: "cursor-run-live",
      agentId: handle.id,
      status: "running",
      async wait() {
        return { id: "cursor-run-live", status: "finished", result: "OK" }
      },
    }]

    const collected = await cursorProvider.collectExistingOutput!({
      config,
      handle,
      role: "research-drafter",
      outputFile,
    })

    expect(sendCalls).toEqual([])
    expect(collected).toMatchObject({ status: "harvested", source: "wait" })
    if (collected.status === "harvested") {
      expect(JSON.parse(collected.result.text ?? "")).toEqual({ ok: true })
    }
    expect(JSON.parse(await readFile(outputFile, "utf8"))).toEqual({ ok: true })
  })

  test("collectExistingOutput pulls artifacts from a finished cloud run without sending", async () => {
    const outputFile = await tempOutputFile("reader-profile.json")
    artifactPath = "artifacts/reader-profile.json"
    artifactBytes = Buffer.from(JSON.stringify({ harvested: true }))
    const handle = await cursorProvider.createRunHandle({
      config,
      role: "research-drafter",
      title: "draft",
    })
    listRunsItems = [{
      id: "cursor-run-done",
      agentId: handle.id,
      status: "finished",
      result: "OK",
      async wait() {
        return { id: "cursor-run-done", status: "finished", result: "OK" }
      },
    }]

    const collected = await cursorProvider.collectExistingOutput!({
      config,
      handle,
      role: "research-drafter",
      outputFile,
    })

    expect(sendCalls).toEqual([])
    expect(collected).toMatchObject({ status: "harvested", source: "artifacts" })
    expect(JSON.parse(await readFile(outputFile, "utf8"))).toEqual({ harvested: true })
  })

  test("collectExistingOutput is idle when the resumed agent never started a run", async () => {
    const outputFile = await tempOutputFile("reader-profile.json")
    artifactPath = "artifacts/missing.json"
    const handle = await cursorProvider.createRunHandle({
      config,
      role: "research-drafter",
      title: "draft",
    })
    listRunsItems = []

    const collected = await cursorProvider.collectExistingOutput!({
      config,
      handle,
      role: "research-drafter",
      outputFile,
    })

    expect(collected.status).toBe("idle")
    expect(sendCalls).toEqual([])
  })
})
