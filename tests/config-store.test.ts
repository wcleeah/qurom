import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  ensureConfigInitialized,
  getConfigStore,
  loadPromptAssetsFromStore,
  loadQuorumConfigFromStore,
  loadRoleBindingsFromStore,
  updatePromptAsset,
  updateQuorumConfig,
  updateRoleBinding,
} from "../src/config-store"
import { promptAssetFiles } from "../src/prompt-asset-defs"
import { handleConfigPost, renderConfigIndex, renderConfigPrompts, renderConfigRoles } from "../src/view/config"
import { prepareTestDataDir, testRuntimeEnv } from "./test-env"

let dir: string
let dataDir: string

function env() {
  return testRuntimeEnv({ dataDir, workspaceDir: dir })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-config-store-"))
  dataDir = await prepareTestDataDir(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("config store", () => {
  test("seeds defaults into sqlite for quorum config, prompts, and role bindings", async () => {
    await ensureConfigInitialized(env())
    const store = getConfigStore(env())
    const promptCount = store.db.query<{ count: number }, []>("SELECT count(*) as count FROM prompt_assets").get()?.count
    const bindingCount = store.db.query<{ count: number }, []>("SELECT count(*) as count FROM role_provider_bindings").get()?.count
    store.close()

    expect(promptCount).toBe(Object.keys(promptAssetFiles).length)
    expect(bindingCount).toBeGreaterThan(0)
    expect((await loadQuorumConfigFromStore(env())).maxRounds).toBeGreaterThan(0)
    expect((await loadRoleBindingsFromStore(env()))["source-auditor"]).toBeDefined()
    expect((await loadPromptAssetsFromStore(env())).sourceAuditorAudit).toContain("source support")
  })

  test("role binding updates are stored separately from quorum policy", async () => {
    await ensureConfigInitialized(env())
    await updateRoleBinding(env(), "source-auditor", {
      provider: "opencode",
      providerAgent: "custom-source-auditor",
      variant: "fast",
    })

    const bindings = await loadRoleBindingsFromStore(env())
    expect(bindings["source-auditor"]).toMatchObject({
      provider: "opencode",
      providerAgent: "custom-source-auditor",
      variant: "fast",
    })
  })

  test("quorum config updates are validated and saved to the active profile", async () => {
    await ensureConfigInitialized(env())
    const current = await loadQuorumConfigFromStore(env())
    await updateQuorumConfig(env(), JSON.stringify({
      ...current,
      designQuorum: { enabled: false },
    }))

    const config = await loadQuorumConfigFromStore(env())
    expect(config.designQuorum).toEqual({ enabled: false })
  })

  test("legacy browser QA config and bindings are pruned from sqlite profiles", async () => {
    await ensureConfigInitialized(env())
    const current = await loadQuorumConfigFromStore(env())
    await updateQuorumConfig(env(), JSON.stringify({
      ...current,
      designQuorum: {
        enabled: true,
        browserQa: { enabled: true },
      } as Record<string, unknown>,
    }))
    await updateRoleBinding(env(), "browser-qa-enhancer", {
      provider: "cursor",
      providerAgent: "browser-qa-enhancer",
    })

    const config = await loadQuorumConfigFromStore(env())
    const store = getConfigStore(env())
    const binding = store.db
      .query<{ role: string }, []>("SELECT role FROM role_provider_bindings WHERE role = 'browser-qa-enhancer'")
      .get()
    store.close()

    expect((config.designQuorum as Record<string, unknown> | undefined)?.browserQa).toBeUndefined()
    expect((await loadRoleBindingsFromStore(env()))["browser-qa-enhancer"]).toBeUndefined()
    expect(binding).toBeNull()
  })

  test("prompt updates are stored in sqlite", async () => {
    await ensureConfigInitialized(env())
    await updatePromptAsset(env(), "sourceAuditorAudit", "updated audit prompt")

    const assets = await loadPromptAssetsFromStore(env())
    expect(assets.sourceAuditorAudit).toBe("updated audit prompt")
  })

  test("save all active prompts updates every posted content field", async () => {
    await ensureConfigInitialized(env())
    process.env.QUORUM_DATA_DIR = dataDir
    process.env.OPENCODE_DIRECTORY = dir
    process.env.QUORUM_WORKSPACE_DIRECTORY = dir

    const response = await handleConfigPost(
      new Request("http://localhost/config/prompts", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          "content:sourceAuditorAudit": "batch-active-audit",
          "content:logicAuditorAudit": "batch-active-logic",
        }).toString(),
      }),
      "/config/prompts",
    )
    expect(response?.status).toBe(303)
    const assets = await loadPromptAssetsFromStore(env())
    expect(assets.sourceAuditorAudit).toBe("batch-active-audit")
    expect(assets.logicAuditorAudit).toBe("batch-active-logic")
  })

  test("view config routes render and update sqlite-backed settings", async () => {
    await ensureConfigInitialized(env())
    process.env.QUORUM_DATA_DIR = dataDir
    process.env.OPENCODE_DIRECTORY = dir
    process.env.QUORUM_WORKSPACE_DIRECTORY = dir

    const indexHtml = await renderConfigIndex().then((r) => r.text())
    expect(indexHtml).toContain("Save quorum config")
    expect(indexHtml).toContain('name="maxRounds"')
    expect(indexHtml).not.toContain("browserQa")

    const rolesHtml = await renderConfigRoles().then((r) => r.text())
    expect(rolesHtml).toContain("source-auditor")
    expect(rolesHtml).toContain(".opencode/agents/")
    expect(rolesHtml).not.toContain("edited file definition")

    const promptHtml = await renderConfigPrompts().then((r) => r.text())
    expect(promptHtml).toContain("source-auditor")
    expect(promptHtml).toContain("sourceAuditorAudit")
    expect(promptHtml).toContain("Save all")
    expect(promptHtml).toContain("Matches default")
    expect(promptHtml).toContain('name="content:sourceAuditorAudit"')

    await updatePromptAsset(env(), "sourceAuditorAudit", "diverted active audit prompt")
    const divertedHtml = await renderConfigPrompts().then((r) => r.text())
    expect(divertedHtml).toContain("Modified from default")

    const req = new Request("http://localhost/config/roles/source-auditor", {
      method: "POST",
      body: new URLSearchParams({ provider: "opencode", providerAgent: "custom-agent" }),
    })
    const response = await handleConfigPost(req, "/config/roles/source-auditor")
    expect(response?.status).toBe(303)
    expect((await loadRoleBindingsFromStore(env()))["source-auditor"]?.providerAgent).toBe("custom-agent")

    const quorumReq = new Request("http://localhost/config/quorum", {
      method: "POST",
      body: new URLSearchParams({
        maxRounds: "8",
        maxRebuttalTurnsPerFinding: "2",
        recursionLimit: "80",
        "auditRestart.maxRestarts": "1",
        requireUnanimousApproval: "1",
        "designQuorum.enabled": "1",
        "readerDiscovery.enabled": "1",
        "readerDiscovery.maxTurns": "6",
        "researchTools.prefer": "exa",
        "researchTools.webSearchProvider": "exa",
      }),
    })
    const quorumResponse = await handleConfigPost(quorumReq, "/config/quorum")
    expect(quorumResponse?.status).toBe(303)
    expect((await loadQuorumConfigFromStore(env())).maxRounds).toBe(8)
  })

  test("migrates legacy checkpoints.sqlite into the data directory", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises")
    const { join } = await import("node:path")
    const workspace = await mkdtemp(join(tmpdir(), "qurom-migrate-checkpoints-"))
    const dataDir = await prepareTestDataDir(workspace)
    const legacyRuns = join(workspace, "runs")
    await mkdir(legacyRuns, { recursive: true })
    await writeFile(join(legacyRuns, "checkpoints.sqlite"), "legacy-checkpoint-db")

    const migrateEnv = testRuntimeEnv({ dataDir, workspaceDir: workspace })
    await ensureConfigInitialized(migrateEnv)

    const migrated = await Bun.file(migrateEnv.QUORUM_CHECKPOINT_PATH).text()
    expect(migrated).toBe("legacy-checkpoint-db")
    await rm(workspace, { recursive: true, force: true })
  })
})
