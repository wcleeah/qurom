import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  getConfigStore,
  loadPromptAssetsFromStore,
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
  process.env.QUORUM_CONFIG_DB_PATH = join(dir, "runs", "quorum-config.sqlite")
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("config store", () => {
  test("seeds current file config, prompts, and role definitions into sqlite", async () => {
    const store = await getConfigStore(env())
    const profile = await seedConfigStoreFromFiles(env(), store)
    const roleCount = store.db.query<{ count: number }, []>("SELECT count(*) as count FROM role_definitions").get()?.count
    store.close()

    expect(profile.name).toBe("default")
    expect(roleCount).toBe(3)
    expect((await loadQuorumConfigFromStore(env())).designatedDrafter).toBe("research-drafter")
    expect((await loadPromptAssetsFromStore(env())).audit).toBe("prompt:audit.md")
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

  test("prompt updates replace active prompt content", async () => {
    await seedConfigStoreFromFiles(env())
    await updatePromptAsset(env(), "audit", "updated audit prompt")

    const assets = await loadPromptAssetsFromStore(env())
    expect(assets.audit).toBe("updated audit prompt")
  })

  test("syncOpencodeAgentsFromStore writes generated compatibility agent files", async () => {
    await seedConfigStoreFromFiles(env())
    await writeFile(join(dir, ".opencode", "agents", "research-drafter.md"), "old")
    await syncOpencodeAgentsFromStore(env())

    expect(await readFile(join(dir, ".opencode", "agents", "research-drafter.md"), "utf8")).toContain("drafter definition")
  })

  test("view config routes render and update sqlite-backed settings", async () => {
    await seedConfigStoreFromFiles(env())

    const rolesHtml = await renderConfigRoles().then((r) => r.text())
    expect(rolesHtml).toContain("source-auditor")

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
