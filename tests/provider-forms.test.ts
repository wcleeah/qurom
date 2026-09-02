import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

mock.module("@cursor/sdk", () => {
  class CursorSdkError extends Error {
    readonly isRetryable = false
  }
  class CursorAgentError extends Error {}
  class AgentBusyError extends CursorAgentError {
    constructor(message = "[agent_busy] Agent already has an active run") {
      super(message)
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
              { value: "false", displayName: "Off" },
              { value: "true", displayName: "On" },
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
      create: mock(async () => {
        throw new Error("not used")
      }),
    },
  }
})

const { renderConfigRoles, handleConfigPost } = await import("../src/view/config")
const { modelParamsFromForm } = await import("../src/view/role-binding-form")
const { ensureConfigInitialized, loadRoleBindingsFromStore, updateRoleBinding } = await import("../src/config-store")
const { prepareTestDataDir, testRuntimeEnv } = await import("./test-env")

let dir: string
let dataDir: string
const savedEnv: Record<string, string | undefined> = {}

function env() {
  return testRuntimeEnv({ dataDir, workspaceDir: dir })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-provider-forms-"))
  dataDir = await prepareTestDataDir(dir)
  const runtimeEnv = env()
  for (const key of [
    "OPENCODE_DIRECTORY",
    "QUORUM_WORKSPACE_DIRECTORY",
    "QUORUM_DATA_DIR",
    "QUORUM_CONFIG_DB_PATH",
    "QUORUM_CHECKPOINT_PATH",
    "QUORUM_RUNS_DIR",
  ] as const) {
    savedEnv[key] = process.env[key]
  }
  process.env.OPENCODE_DIRECTORY = dir
  process.env.QUORUM_WORKSPACE_DIRECTORY = dir
  process.env.QUORUM_DATA_DIR = dataDir
  process.env.QUORUM_CONFIG_DB_PATH = runtimeEnv.QUORUM_CONFIG_DB_PATH
  process.env.QUORUM_CHECKPOINT_PATH = runtimeEnv.QUORUM_CHECKPOINT_PATH
  process.env.QUORUM_RUNS_DIR = runtimeEnv.QUORUM_RUNS_DIR
  process.env.CURSOR_API_KEY = "cursor-test-key"
  await ensureConfigInitialized(env())
})

afterEach(async () => {
  delete process.env.CURSOR_API_KEY
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(dir, { recursive: true, force: true })
})

describe("provider-specific role forms", () => {
  test("renders OpenCode role configuration as read-only agent file content", async () => {
    const html = await renderConfigRoles().then((response) => response.text())

    expect(html).toContain(".opencode/agents/research-drafter.md")
    expect(html).toContain("config-readonly-agent")
    expect(html).not.toContain("Edit .opencode/agents/")
    expect(html).not.toContain("drafter definition")
    expect(html).toContain("data-save-actions hidden")
    expect(html).not.toContain('placeholder="composer-2.5"')
  })

  test("renders Cursor model dropdown and parameter controls from catalog", async () => {
    await updateRoleBinding(env(), "source-auditor", {
      provider: "cursor",
      model: "composer-2.5",
      options: { modelParams: [{ id: "fast", value: "true" }] },
    })

    const html = await renderConfigRoles().then((response) => response.text())

    expect(html).toContain('<select class="form-input" name="model">')
    expect(html).toContain("Composer 2.5")
    expect(html).toContain("Opus 4.8")
    expect(html).toContain('data-role-binding-form')
    expect(html).toContain('data-autosave="true"')
    expect(html).toContain('data-model-param-set="composer-2.5"')
    expect(html).toContain('data-model-param-set="claude-opus-4-8" hidden')
    expect(html).toContain('name="modelParam:fast"')
    expect(html).toContain('name="modelParam:thinking"')
    expect(html).toContain('name="modelParam:context"')
    expect(html).toContain("Reasoning")
    expect(html).toContain('<option value="true" selected>Fast</option>')
  })

  test("persists Cursor model params into role binding options", async () => {
    const req = new Request("http://localhost/config/roles/source-auditor", {
      method: "POST",
      body: new URLSearchParams({
        provider: "cursor",
        model: "composer-2.5",
        "modelParam:fast": "true",
      }),
    })
    const response = await handleConfigPost(req, "/config/roles/source-auditor")
    const bindings = await loadRoleBindingsFromStore(env())

    expect(response?.status).toBe(303)
    expect(bindings["source-auditor"]).toMatchObject({
      provider: "cursor",
      model: "composer-2.5",
      options: { modelParams: [{ id: "fast", value: "true" }] },
    })
  })

  test("drops leftover previous-model params when saving a different Cursor model", async () => {
    const req = new Request("http://localhost/config/roles/source-auditor", {
      method: "POST",
      body: new URLSearchParams({
        provider: "cursor",
        model: "claude-opus-4-8",
        "modelParam:fast": "true",
        "modelParam:thinking": "false",
      }),
    })
    const response = await handleConfigPost(req, "/config/roles/source-auditor")
    const bindings = await loadRoleBindingsFromStore(env())

    expect(response?.status).toBe(303)
    expect(bindings["source-auditor"]).toMatchObject({
      provider: "cursor",
      model: "claude-opus-4-8",
      options: { modelParams: [{ id: "thinking", value: "false" }] },
    })
    expect(bindings["source-auditor"]?.options?.modelParams).toEqual([
      { id: "thinking", value: "false" },
    ])
  })

  test("returns JSON for autosave posts instead of redirecting", async () => {
    const req = new Request("http://localhost/config/roles/source-auditor", {
      method: "POST",
      headers: { accept: "application/json" },
      body: new URLSearchParams({
        provider: "cursor",
        model: "composer-2.5",
        "modelParam:fast": "false",
      }),
    })
    const response = await handleConfigPost(req, "/config/roles/source-auditor")

    expect(response?.status).toBe(200)
    expect(await response?.json()).toEqual({ ok: true })
    expect((await loadRoleBindingsFromStore(env()))["source-auditor"]).toMatchObject({
      provider: "cursor",
      model: "composer-2.5",
      options: { modelParams: [{ id: "fast", value: "false" }] },
    })
  })

  test("modelParamsFromForm keeps only ids advertised for the selected model", () => {
    const params = new URLSearchParams({
      model: "claude-opus-4-8",
      "modelParam:fast": "true",
      "modelParam:thinking": "false",
    })
    expect(modelParamsFromForm(params, {
      providerId: "cursor",
      parametersByModel: {
        "claude-opus-4-8": [{ id: "thinking", label: "Thinking", values: [] }],
      },
    })).toEqual([{ id: "thinking", value: "false" }])
  })
})
