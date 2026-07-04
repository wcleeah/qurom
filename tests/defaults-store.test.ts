import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  listDefaultsPrompts,
  listDefaultsRoleBindings,
  readDefaultsQuorumConfig,
  updateDefaultsPrompt,
  updateDefaultsQuorumConfig,
  updateDefaultsRoleBinding,
} from "../src/defaults-store"
import { loadPromptAssetsFromStore } from "../src/config-store"
import {
  handleConfigDefaultsPost,
  renderConfigDefaultsBindings,
  renderConfigDefaultsIndex,
  renderConfigDefaultsPrompts,
} from "../src/view/config-defaults"
import { renderConfigIndex } from "../src/view/config"
import { prepareTestDataDir, testRuntimeEnv } from "./test-env"
import { configureViewServer } from "../src/view/server-options"

let dir: string
let dataDir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-defaults-store-"))
  dataDir = await prepareTestDataDir(dir)
  configureViewServer({ admin: true })
  process.env.QUORUM_DATA_DIR = dataDir
  process.env.OPENCODE_DIRECTORY = dir
  process.env.QUORUM_WORKSPACE_DIRECTORY = dir
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("defaults store", () => {
  test("reads and updates shipped defaults prompts", async () => {
    const prompts = await listDefaultsPrompts(dir)
    expect(prompts.some((prompt) => prompt.key === "audit")).toBe(true)

    await updateDefaultsPrompt(dir, "audit", "updated default audit prompt")
    const updated = await listDefaultsPrompts(dir)
    expect(updated.find((prompt) => prompt.key === "audit")?.content).toBe("updated default audit prompt")
  })

  test("validates defaults quorum config before writing", async () => {
    const current = await readDefaultsQuorumConfig(dir)
    const parsed = JSON.parse(current)
    await updateDefaultsQuorumConfig(dir, JSON.stringify({
      ...parsed,
      maxRounds: 12,
    }))
    const updated = JSON.parse(await readDefaultsQuorumConfig(dir))
    expect(updated.maxRounds).toBe(12)
    expect(updated.artifactDir).toBeUndefined()
  })

  test("reads and updates shipped defaults role bindings in sqlite", async () => {
    const bindings = await listDefaultsRoleBindings(dir)
    expect(bindings.some((binding) => binding.role === "source-auditor")).toBe(true)

    await updateDefaultsRoleBinding(dir, "source-auditor", {
      provider: "opencode",
      providerAgent: "custom-default-auditor",
      variant: "fast",
    })
    const updated = await listDefaultsRoleBindings(dir)
    expect(updated.find((binding) => binding.role === "source-auditor")).toMatchObject({
      provider: "opencode",
      provider_agent: "custom-default-auditor",
      variant: "fast",
    })
  })
})

describe("defaults config UI", () => {
  test("hides defaults tab when view server is not started with --admin", async () => {
    configureViewServer({ admin: false })
    const indexHtml = await renderConfigIndex().then((r) => r.text())
    expect(indexHtml).not.toContain('href="/config/defaults"')
    expect(indexHtml).not.toContain(">Defaults<")
  })

  test("renders defaults editor pages", async () => {
    const indexHtml = await renderConfigDefaultsIndex().then((r) => r.text())
    expect(indexHtml).toContain("Default resources")
    expect(indexHtml).toContain('name="maxRounds"')
    expect(indexHtml).toContain("defaults/quorum-config.sqlite")

    const promptsHtml = await renderConfigDefaultsPrompts().then((r) => r.text())
    expect(promptsHtml).toContain("audit")
    expect(promptsHtml).toContain("Apply to active")

    const bindingsHtml = await renderConfigDefaultsBindings().then((r) => r.text())
    expect(bindingsHtml).toContain("defaults/opencode/agents/")
    expect(bindingsHtml).toContain("config-readonly-agent")
    expect(bindingsHtml).toContain("Apply to active")
  })

  test("apply default prompt copies content into active sqlite profile", async () => {
    await updateDefaultsPrompt(dir, "audit", "applied-from-defaults audit prompt")
    const response = await handleConfigDefaultsPost(
      new Request("http://localhost/config/defaults/apply/prompts/audit", { method: "POST" }),
      "/config/defaults/apply/prompts/audit",
    )
    expect(response?.status).toBe(303)
    expect((await loadPromptAssetsFromStore(testRuntimeEnv({ dataDir, workspaceDir: dir }))).audit)
      .toBe("applied-from-defaults audit prompt")
  })
})
