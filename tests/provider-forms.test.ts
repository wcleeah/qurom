import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { promptAssetFiles } from "../src/prompt-asset-defs"

mock.module("@cursor/sdk", () => {
  class CursorAgentError extends Error {}
  return {
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
const { loadQuorumConfigFromStore, seedConfigStoreFromFiles, updateRoleBinding } = await import("../src/config-store")

let dir: string

function env() {
  return {
    OPENCODE_DIRECTORY: dir,
    QUORUM_WORKSPACE_DIRECTORY: dir,
    QUORUM_CONFIG_DB_PATH: join(dir, "runs", "quorum-config.sqlite"),
  }
}

async function writeFixtures() {
  await mkdir(join(dir, "assets", "prompts"), { recursive: true })
  await mkdir(join(dir, ".opencode", "agents"), { recursive: true })
  await mkdir(join(dir, "runs"), { recursive: true })
  await writeFile(join(dir, "quorum.config.json"), JSON.stringify({
    designatedDrafter: "research-drafter",
    auditors: ["source-auditor"],
    summarizerAgent: "markdown-summarizer",
    maxRounds: 2,
    maxRebuttalTurnsPerFinding: 1,
    requireUnanimousApproval: true,
    artifactDir: "runs",
    promptAssetsDir: "assets/prompts",
    promptManagement: { source: "local", label: "test" },
    researchTools: { prefer: ["exa"], webSearchProvider: "exa" },
    auditRestart: { maxRestarts: 1 },
    readerDiscovery: { maxTurns: 2, enabled: true },
  }, null, 2))
  for (const filename of Object.values(promptAssetFiles)) {
    await writeFile(join(dir, "assets", "prompts", filename), `prompt:${filename}`)
  }
  await writeFile(join(dir, ".opencode", "agents", "research-drafter.md"), "drafter definition")
  await writeFile(join(dir, ".opencode", "agents", "source-auditor.md"), "auditor definition")
  await writeFile(join(dir, ".opencode", "agents", "markdown-summarizer.md"), "summarizer definition")
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-provider-forms-"))
  await writeFixtures()
  process.env.OPENCODE_DIRECTORY = dir
  process.env.QUORUM_WORKSPACE_DIRECTORY = dir
  process.env.QUORUM_CONFIG_DB_PATH = join(dir, "runs", "quorum-config.sqlite")
  process.env.CURSOR_API_KEY = "cursor-test-key"
})

afterEach(async () => {
  delete process.env.CURSOR_API_KEY
  await rm(dir, { recursive: true, force: true })
})

describe("provider-specific role forms", () => {
  test("renders Cursor model dropdown and parameter controls from catalog", async () => {
    await seedConfigStoreFromFiles(env())
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
    await seedConfigStoreFromFiles(env())

    const req = new Request("http://localhost/config/roles/source-auditor", {
      method: "POST",
      body: new URLSearchParams({
        provider: "cursor",
        model: "composer-2.5",
        "modelParam:fast": "true",
      }),
    })
    const response = await handleConfigPost(req, "/config/roles/source-auditor")
    const config = await loadQuorumConfigFromStore(env())

    expect(response?.status).toBe(303)
    expect(config.agentRuntime.roles["source-auditor"]).toMatchObject({
      provider: "cursor",
      model: "composer-2.5",
      options: { modelParams: [{ id: "fast", value: "true" }] },
    })
  })
})
