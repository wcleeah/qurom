import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { deleteMcpServer, ensureConfigInitialized, getConfigStore, loadMcpRegistryFromStore, saveMcpServer, setEnabledMcpServers } from "../src/config-store"
import { DEFAULT_PLAYWRIGHT_MCP_SERVER, toCursorMcpServers, toOpenCodeMcp, validateMcpRegistry } from "../src/mcp-config"
import { ensureOpenCodeServer } from "../src/opencode-server"
import { managedOpenCodeConfig } from "../src/providers/opencode"
import { handleConfigPost, renderConfigMcp } from "../src/view/config"
import { prepareTestDataDir, testRuntimeConfig, testRuntimeEnv } from "./test-env"

let dir: string
let dataDir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-mcp-"))
  dataDir = await prepareTestDataDir(dir)
})
afterEach(async () => rm(dir, { recursive: true, force: true }))

describe("MCP registry", () => {
  test("persists CRUD and global enabled selection independently of research tools", async () => {
    const env = testRuntimeEnv({ dataDir, workspaceDir: dir })
    await ensureConfigInitialized(env)
    expect(await loadMcpRegistryFromStore(env)).toEqual({
      servers: [DEFAULT_PLAYWRIGHT_MCP_SERVER],
      enabled: ["playwright"],
    })
    await saveMcpServer(env, { name: "search", type: "remote", url: "https://mcp.example", headers: { Authorization: "Bearer ${TOKEN}" } })
    await setEnabledMcpServers(env, ["search"])
    expect(await loadMcpRegistryFromStore(env)).toEqual({
      servers: [
        DEFAULT_PLAYWRIGHT_MCP_SERVER,
        { name: "search", type: "remote", url: "https://mcp.example", headers: { Authorization: "Bearer ${TOKEN}" } },
      ],
      enabled: ["search"],
    })
    await saveMcpServer(env, { name: "renamed", type: "remote", url: "https://mcp.example", headers: {} }, "search")
    expect(await loadMcpRegistryFromStore(env)).toEqual({
      servers: [
        DEFAULT_PLAYWRIGHT_MCP_SERVER,
        { name: "renamed", type: "remote", url: "https://mcp.example", headers: {} },
      ],
      enabled: ["renamed"],
    })
    await deleteMcpServer(env, "renamed")
    expect(await loadMcpRegistryFromStore(env)).toEqual({
      servers: [DEFAULT_PLAYWRIGHT_MCP_SERVER],
      enabled: [],
    })
  })

  test("rejects duplicate names, unknown enabled names, and invalid providers fields", () => {
    expect(() => validateMcpRegistry({
      servers: [
        { name: "same", type: "local", command: "one", args: [], env: {} },
        { name: "same", type: "local", command: "two", args: [], env: {} },
      ],
      enabled: [],
    })).toThrow("Duplicate")
    expect(() => validateMcpRegistry({ servers: [], enabled: ["missing"] })).toThrow("does not exist")
  })

  test("adapts one enabled registry exactly to Cursor and OpenCode with centralized interpolation", () => {
    const registry = {
      servers: [
        { name: "local", type: "local" as const, command: "node", args: ["${ARG}"], env: { TOKEN: "${TOKEN}" }, cwd: "/tmp" },
        { name: "remote", type: "remote" as const, url: "https://mcp.example", headers: {}, oauth: { clientId: "client", scopes: ["read", "write"] } },
        { name: "off", type: "local" as const, command: "off", args: [], env: {} },
      ],
      enabled: ["local", "remote"],
    }
    expect(toCursorMcpServers(registry, { ARG: "run", TOKEN: "secret" })).toEqual({
      local: { command: "node", args: ["run"], env: { TOKEN: "secret" }, cwd: "/tmp" },
      remote: { url: "https://mcp.example", auth: { CLIENT_ID: "client", scopes: ["read", "write"] } },
    })
    expect(toOpenCodeMcp(registry, { ARG: "run", TOKEN: "secret" })).toEqual({
      local: { type: "local", command: ["node", "run"], environment: { TOKEN: "secret" }, enabled: true },
      remote: { type: "remote", url: "https://mcp.example", oauth: { clientId: "client", scope: "read write" }, enabled: true },
    })
  })

  test("preserves unrelated OpenCode config while replacing mcp authoritatively", () => {
    const config = testRuntimeConfig({ dataDir })
    config.mcpRegistry = {
      servers: [{ name: "one", type: "local", command: "server", args: [], env: {} }],
      enabled: ["one"],
    }
    expect(managedOpenCodeConfig(config, JSON.stringify({ theme: "dark", mcp: { stale: { type: "local", command: ["stale"] } } }))).toEqual({
      theme: "dark",
      mcp: { one: { type: "local", command: ["server"], enabled: true } },
    })
  })

  test("rejects a server already occupying the managed OpenCode port", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("external") })
    try {
      await expect(ensureOpenCodeServer({
        port: server.port,
        directory: dir,
        configContent: "{}",
      })).rejects.toThrow("already occupied")
    } finally {
      server.stop(true)
    }
  })

  test("dashboard exposes structured controls and handles create, enable, and validation errors", async () => {
    process.env.QUORUM_DATA_DIR = dataDir
    process.env.QUORUM_WORKSPACE_DIRECTORY = dir
    process.env.OPENCODE_DIRECTORY = dir
    const create = await handleConfigPost(new Request("http://localhost/config/mcp/save", {
      method: "POST",
      body: new URLSearchParams({ type: "local", name: "tools", command: "npx", args: "-y\ntools", environment: "TOKEN=${TOKEN}" }),
    }), "/config/mcp/save")
    expect(create?.status).toBe(303)
    const enable = await handleConfigPost(new Request("http://localhost/config/mcp/enabled", {
      method: "POST",
      body: new URLSearchParams({ enabled: "tools" }),
    }), "/config/mcp/enabled")
    expect(enable?.status).toBe(303)
    const html = await renderConfigMcp().then((response) => response.text())
    expect(html).toContain("MCP Registry")
    expect(html).toContain('name="command"')
    expect(html).toContain('value="tools" checked')
    const invalid = await handleConfigPost(new Request("http://localhost/config/mcp/save", {
      method: "POST",
      body: new URLSearchParams({ type: "remote", name: "bad", url: "not-a-url" }),
    }), "/config/mcp/save")
    expect(invalid?.status).toBe(200)
    expect(await invalid!.text()).toContain("Invalid url")
  })

  test("registry rows are isolated by active profile", async () => {
    const env = testRuntimeEnv({ dataDir, workspaceDir: dir })
    await ensureConfigInitialized(env)
    await saveMcpServer(env, { name: "default-only", type: "local", command: "one", args: [], env: {} })
    const store = getConfigStore(env)
    const now = new Date().toISOString()
    store.db.run("UPDATE config_profiles SET active = 0")
    store.db.query("INSERT INTO config_profiles (name, active, created_at, updated_at) VALUES ('other', 1, ?, ?)").run(now, now)
    store.close()
    // Active profile switch lazy-migrates the shipped Playwright MCP onto the new profile.
    expect(await loadMcpRegistryFromStore(env)).toEqual({
      servers: [DEFAULT_PLAYWRIGHT_MCP_SERVER],
      enabled: ["playwright"],
    })
  })
})
