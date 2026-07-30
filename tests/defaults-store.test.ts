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
    expect(prompts.some((prompt) => prompt.key === "sourceAuditorAudit")).toBe(true)

    await updateDefaultsPrompt(dir, "sourceAuditorAudit", "updated default audit prompt")
    const updated = await listDefaultsPrompts(dir)
    expect(updated.find((prompt) => prompt.key === "sourceAuditorAudit")?.content).toBe("updated default audit prompt")
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
    expect(promptsHtml).toContain("source-auditor")
    expect(promptsHtml).toContain("sourceAuditorAudit")
    expect(promptsHtml).toContain("Apply to active")
    expect(promptsHtml).toContain('formaction="/config/defaults/apply/prompts/sourceAuditorAudit"')
    expect(promptsHtml).not.toContain('class="config-form inline-form"')

    const bindingsHtml = await renderConfigDefaultsBindings().then((r) => r.text())
    expect(bindingsHtml).toContain("defaults/opencode/agents/")
    expect(bindingsHtml).toContain("config-readonly-agent")
    expect(bindingsHtml).toContain("Apply to active")
  })

  test("apply default prompt copies content into active sqlite profile", async () => {
    await updateDefaultsPrompt(dir, "sourceAuditorAudit", "applied-from-defaults audit prompt")
    const response = await handleConfigDefaultsPost(
      new Request("http://localhost/config/defaults/apply/prompts/sourceAuditorAudit", { method: "POST" }),
      "/config/defaults/apply/prompts/sourceAuditorAudit",
    )
    expect(response?.status).toBe(200)
    expect((await loadPromptAssetsFromStore(testRuntimeEnv({ dataDir, workspaceDir: dir }))).sourceAuditorAudit)
      .toBe("applied-from-defaults audit prompt")
  })

  test("apply prompt uses posted textarea content when provided", async () => {
    const response = await handleConfigDefaultsPost(
      new Request("http://localhost/config/defaults/apply/prompts/htmlDesignerDesign", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ content: "applied-from-form design prompt" }).toString(),
      }),
      "/config/defaults/apply/prompts/htmlDesignerDesign",
    )
    expect(response?.status).toBe(200)
    expect((await loadPromptAssetsFromStore(testRuntimeEnv({ dataDir, workspaceDir: dir }))).htmlDesignerDesign)
      .toBe("applied-from-form design prompt")
  })
})
