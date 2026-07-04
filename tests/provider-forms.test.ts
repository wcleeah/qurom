import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

mock.module("@cursor/sdk", () => {
  class CursorSdkError extends Error {
    readonly isRetryable = false
  }
  class CursorAgentError extends Error {}
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
      create: mock(async () => {
        throw new Error("not used")
      }),
    },
  }
})

const { renderConfigRoles, handleConfigPost } = await import("../src/view/config")
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
    expect(html).toContain("data-role-instructions hidden")
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
    expect(html).toContain('name="modelParam:fast"')
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
})
