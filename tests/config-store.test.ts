import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  getConfigStore,
  listPromptAssetsFromFiles,
  loadQuorumConfigFromStore,
  seedConfigStoreFromFiles,
  syncOpencodeAgentsFromStore,
  updatePromptAsset,
  updateRoleBinding,
} from "../src/config-store"
import { promptAssetFiles } from "../src/prompt-asset-defs"
import { handleConfigPost, renderConfigPrompts, renderConfigRoles } from "../src/view/config"

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
  dir = await mkdtemp(join(tmpdir(), "qurom-config-store-"))
  await writeFixtures()
  process.env.OPENCODE_DIRECTORY = dir
  process.env.QUORUM_WORKSPACE_DIRECTORY = dir
  process.env.QUORUM_CONFIG_DB_PATH = join(dir, "runs", "quorum-config.sqlite")
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("config store", () => {
  test("seeds current file config and role definitions into sqlite, while prompts stay file-backed", async () => {
    const store = await getConfigStore(env())
    const profile = await seedConfigStoreFromFiles(env(), store)
    const roleCount = store.db.query<{ count: number }, []>("SELECT count(*) as count FROM role_definitions").get()?.count
    const promptTable = store.db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'prompt_assets'").get()
    store.close()

    expect(profile.name).toBe("default")
    expect(roleCount).toBe(3)
    expect(promptTable).toBeNull()
    expect((await loadQuorumConfigFromStore(env())).designatedDrafter).toBe("research-drafter")
    expect((await listPromptAssetsFromFiles(env())).find((prompt) => prompt.key === "audit")?.content).toBe("prompt:audit.md")
  })

  test("role binding updates are merged into loaded runtime config", async () => {
    await seedConfigStoreFromFiles(env())
    await updateRoleBinding(env(), "source-auditor", {
      provider: "opencode",
      providerAgent: "custom-source-auditor",
      variant: "fast",
    })

    const config = await loadQuorumConfigFromStore(env())
    expect(config.agentRuntime.roles["source-auditor"]).toMatchObject({
      provider: "opencode",
      providerAgent: "custom-source-auditor",
      variant: "fast",
    })
  })

  test("prompt updates write prompt asset files directly", async () => {
    await seedConfigStoreFromFiles(env())
    await updatePromptAsset(env(), "audit", "updated audit prompt")

    const assets = await listPromptAssetsFromFiles(env())
    expect(assets.find((prompt) => prompt.key === "audit")?.content).toBe("updated audit prompt")
  })

  test("OpenCode role definitions are rendered directly from agent files", async () => {
    await seedConfigStoreFromFiles(env())
    await writeFile(join(dir, ".opencode", "agents", "research-drafter.md"), "edited file definition")
    await syncOpencodeAgentsFromStore(env())

    const rolesHtml = await renderConfigRoles().then((r) => r.text())
    expect(rolesHtml).toContain("edited file definition")
  })

  test("view config routes render and update sqlite-backed settings", async () => {
    await seedConfigStoreFromFiles(env())

    const rolesHtml = await renderConfigRoles().then((r) => r.text())
    expect(rolesHtml).toContain("source-auditor")
    expect(rolesHtml).toContain("data-role-instructions hidden")
    expect(rolesHtml).toContain("OpenCode role configuration is file-backed")

    const promptHtml = await renderConfigPrompts().then((r) => r.text())
    expect(promptHtml).toContain("audit")

    const req = new Request("http://localhost/config/roles/source-auditor", {
      method: "POST",
      body: new URLSearchParams({ provider: "opencode", providerAgent: "custom-agent" }),
    })
    const response = await handleConfigPost(req, "/config/roles/source-auditor")
    expect(response?.status).toBe(303)
    expect((await loadQuorumConfigFromStore(env())).agentRuntime.roles["source-auditor"]?.providerAgent).toBe("custom-agent")
  })
})
