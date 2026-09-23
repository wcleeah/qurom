import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  CURSOR_PRICING_SYNC_PROMPT,
  githubHttpsUrlFromRemote,
  githubHttpsUrlFromSlugOrRemote,
  launchCursorPricingSyncAgent,
  resolvePricingSyncRepoUrl,
  setCursorPricingSyncCreateAgentForTests,
} from "../src/cursor-pricing-sync-agent"
import { ensureConfigInitialized } from "../src/config-store"
import { handleConfigPost, renderConfigIndex } from "../src/view/config"
import { prepareTestDataDir, testRuntimeEnv } from "./test-env"

const createCalls: unknown[] = []
const sendCalls: string[] = []

function fakeCreateAgent(options: unknown) {
  createCalls.push(options)
  return Promise.resolve({
    agentId: "bc-pricing-sync",
    async send(prompt: string) {
      sendCalls.push(prompt)
      return { id: "run-pricing-sync" }
    },
  })
}

describe("cursor pricing repo URL helpers", () => {
  test("normalizes git remotes and slugs to github https URLs", () => {
    expect(githubHttpsUrlFromRemote("git@github.com:wcleeah/qurom.git")).toBe("https://github.com/wcleeah/qurom")
    expect(githubHttpsUrlFromRemote("https://github.com/wcleeah/qurom.git")).toBe("https://github.com/wcleeah/qurom")
    expect(githubHttpsUrlFromSlugOrRemote("wcleeah/qurom")).toBe("https://github.com/wcleeah/qurom")
    expect(githubHttpsUrlFromSlugOrRemote("https://github.com/wcleeah/qurom")).toBe("https://github.com/wcleeah/qurom")
  })

  test("prefers QUORUM_GITHUB_REPO over git origin", async () => {
    const url = await resolvePricingSyncRepoUrl({
      githubRepo: "acme/qurom",
      workspaceDir: "/tmp",
      readRemote: async () => "git@github.com:other/repo.git",
    })
    expect(url).toBe("https://github.com/acme/qurom")
  })
})

describe("launchCursorPricingSyncAgent", () => {
  beforeEach(() => {
    createCalls.length = 0
    sendCalls.length = 0
  })

  test("requires an API key", async () => {
    await expect(launchCursorPricingSyncAgent({ githubRepo: "acme/qurom" }))
      .rejects.toThrow("CURSOR_API_KEY is not set")
  })

  test("creates a cloud agent with autoCreatePR and sends the pricing prompt", async () => {
    const launch = await launchCursorPricingSyncAgent({
      apiKey: "cursor-test-key",
      githubRepo: "wcleeah/qurom",
      createAgent: fakeCreateAgent,
    })
    expect(launch.agentId).toBe("bc-pricing-sync")
    expect(launch.agentUrl).toBe("https://cursor.com/agents/bc-pricing-sync")
    expect(launch.repoUrl).toBe("https://github.com/wcleeah/qurom")
    expect(createCalls[0]).toMatchObject({
      apiKey: "cursor-test-key",
      name: "Update Cursor pricing map",
      cloud: {
        repos: [{ url: "https://github.com/wcleeah/qurom" }],
        autoCreatePR: true,
      },
    })
    expect(sendCalls).toEqual([CURSOR_PRICING_SYNC_PROMPT])
  })
})

describe("config pricing sync button", () => {
  let dir: string
  let dataDir: string
  let previousEnv: Record<string, string | undefined>

  beforeEach(async () => {
    createCalls.length = 0
    sendCalls.length = 0
    setCursorPricingSyncCreateAgentForTests(fakeCreateAgent)
    dir = await mkdtemp(join(tmpdir(), "qurom-pricing-sync-ui-"))
    dataDir = await prepareTestDataDir(dir)
    previousEnv = {
      QUORUM_DATA_DIR: process.env.QUORUM_DATA_DIR,
      OPENCODE_DIRECTORY: process.env.OPENCODE_DIRECTORY,
      QUORUM_WORKSPACE_DIRECTORY: process.env.QUORUM_WORKSPACE_DIRECTORY,
      CURSOR_API_KEY: process.env.CURSOR_API_KEY,
      QUORUM_GITHUB_REPO: process.env.QUORUM_GITHUB_REPO,
    }
    process.env.QUORUM_DATA_DIR = dataDir
    process.env.OPENCODE_DIRECTORY = dir
    process.env.QUORUM_WORKSPACE_DIRECTORY = dir
    process.env.CURSOR_API_KEY = "cursor-test-key"
    process.env.QUORUM_GITHUB_REPO = "wcleeah/qurom"
    await ensureConfigInitialized(testRuntimeEnv({ dataDir, workspaceDir: dir }))
  })

  afterEach(async () => {
    setCursorPricingSyncCreateAgentForTests(undefined)
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(dir, { recursive: true, force: true })
  })

  test("renders the Update Cursor pricing button on the config page", async () => {
    const html = await renderConfigIndex().then((r) => r.text())
    expect(html).toContain("Cursor model pricing")
    expect(html).toContain("Update Cursor pricing")
    expect(html).toContain('action="/config/cursor-pricing-sync"')
  })

  test("posts launch a cursor agent and show the agent link", async () => {
    const response = await handleConfigPost(
      new Request("http://localhost/config/cursor-pricing-sync", { method: "POST" }),
      "/config/cursor-pricing-sync",
    )
    expect(response?.status).toBe(303)
    expect(response?.headers.get("Location")).toBe("/config")
    const html = await renderConfigIndex().then((r) => r.text())
    expect(html).toContain("bc-pricing-sync")
    expect(html).toContain("https://cursor.com/agents/bc-pricing-sync")
    expect(html).toContain("https://github.com/wcleeah/qurom")
    expect(createCalls).toHaveLength(1)
    expect(sendCalls).toEqual([CURSOR_PRICING_SYNC_PROMPT])
  })
})
