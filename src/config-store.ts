import { Database } from "bun:sqlite"
import { access, readdir } from "node:fs/promises"
import { join } from "node:path"
import { createHash } from "node:crypto"

import type { RuntimeEnv } from "./config"
import { quorumConfigSchema } from "./config"
import { ensureQuorumDataDirs, quorumDataPaths, repoDefaultsDir } from "./data-paths"
import { copyPreserveTimes } from "./migrate-copy"
import { promptAssetFiles, type PromptAssetKey } from "./prompt-asset-defs"
import {
  DEFAULT_PLAYWRIGHT_MCP_SERVER,
  mcpServerSchema,
  validateMcpRegistry,
  type McpRegistry,
  type McpServer,
} from "./mcp-config"

type ConfigProfileRow = {
  id: number
  name: string
  active: number
  created_at: string
  updated_at: string
}

type ConfigValueRow = {
  profile_id: number
  domain: string
  version: number
  value_json: string
}

export type PromptAssetSummary = {
  key: PromptAssetKey
  content: string
  version: number
}

type RoleProviderBindingRow = {
  profile_id: number
  role: string
  provider: string | null
  provider_agent: string | null
  model: string | null
  variant: string | null
  output_mode: string | null
  options_json: string
}

export type ConfigStore = ReturnType<typeof openConfigStore>

function nowIso() {
  return new Date().toISOString()
}

function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex")
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

const LEGACY_BROWSER_QA_ROLE = "browser-qa-enhancer"

const LEGACY_QUORUM_FIELDS = ["artifactDir", "promptAssetsDir", "promptManagement"] as const

const LEGACY_AGENT_FIELDS = [
  "designatedDrafter",
  "auditors",
  "summarizerAgent",
  "agentRuntime",
] as const

async function readTextIfExists(path: string) {
  const file = Bun.file(path)
  if (!(await file.exists())) return undefined
  return (await file.text()).trim()
}

async function readJsonFile(path: string) {
  return JSON.parse(await Bun.file(path).text())
}

export function openConfigStore(dbPath: string) {
  const db = new Database(dbPath, { create: true, strict: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run(`
CREATE TABLE IF NOT EXISTS config_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS config_profiles_one_active
ON config_profiles(active)
WHERE active = 1;

CREATE TABLE IF NOT EXISTS config_values (
  profile_id INTEGER NOT NULL,
  domain TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, domain),
  FOREIGN KEY (profile_id) REFERENCES config_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS role_provider_bindings (
  profile_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  provider TEXT,
  provider_agent TEXT,
  model TEXT,
  variant TEXT,
  output_mode TEXT,
  options_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, role),
  FOREIGN KEY (profile_id) REFERENCES config_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS prompt_assets (
  profile_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, key),
  FOREIGN KEY (profile_id) REFERENCES config_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS role_instructions (
  profile_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, role),
  FOREIGN KEY (profile_id) REFERENCES config_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  profile_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, name),
  FOREIGN KEY (profile_id) REFERENCES config_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mcp_enabled (
  profile_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (profile_id, name),
  FOREIGN KEY (profile_id, name) REFERENCES mcp_servers(profile_id, name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS config_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER,
  source TEXT NOT NULL,
  action TEXT NOT NULL,
  subject TEXT NOT NULL,
  before_hash TEXT,
  after_hash TEXT,
  validation_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
  `)
  db.run("DROP TABLE IF EXISTS role_definitions")
  db.run("DROP TABLE IF EXISTS prompt_assets_legacy")

  return {
    db,
    close() {
      db.close()
    },
  }
}

export function getConfigStore(env: RuntimeEnv): ConfigStore {
  return openConfigStore(env.QUORUM_CONFIG_DB_PATH)
}

function activeProfile(store: ConfigStore): ConfigProfileRow | undefined {
  return store.db
    .query<ConfigProfileRow, []>("SELECT id, name, active, created_at, updated_at FROM config_profiles WHERE active = 1 LIMIT 1")
    .get() ?? undefined
}

function createProfile(store: ConfigStore, name = "default"): ConfigProfileRow {
  const ts = nowIso()
  store.db.run("UPDATE config_profiles SET active = 0 WHERE active = 1")
  store.db
    .query("INSERT INTO config_profiles (name, active, created_at, updated_at) VALUES (?, 1, ?, ?)")
    .run(name, ts, ts)
  const profile = activeProfile(store)
  if (!profile) throw new Error("Failed to create active config profile")
  return profile
}

function writeAudit(store: ConfigStore, input: {
  profileId?: number
  source: string
  action: string
  subject: string
  before?: string
  after?: string
  validationStatus?: string
}) {
  store.db
    .query(`
INSERT INTO config_audit_log (profile_id, source, action, subject, before_hash, after_hash, validation_status, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.profileId ?? null,
      input.source,
      input.action,
      input.subject,
      input.before ? sha256(input.before) : null,
      input.after ? sha256(input.after) : null,
      input.validationStatus ?? "ok",
      nowIso(),
    )
}

function stripLegacyQuorumFields(config: Record<string, unknown>) {
  const next = { ...config }
  for (const field of LEGACY_QUORUM_FIELDS) {
    delete next[field]
  }
  for (const field of LEGACY_AGENT_FIELDS) {
    delete next[field]
  }
  if (next.designQuorum && typeof next.designQuorum === "object") {
    const designQuorum = { ...(next.designQuorum as Record<string, unknown>) }
    delete designQuorum.designatedDesigner
    next.designQuorum = designQuorum
  }
  return next
}

export function bindingRowToRoleBinding(row: Pick<RoleProviderBindingRow, "provider" | "provider_agent" | "model" | "variant" | "output_mode" | "options_json">) {
  const options = parseJson<Record<string, unknown>>(row.options_json, {})
  delete options.mcpServers
  return {
    provider: row.provider ?? undefined,
    providerAgent: row.provider_agent ?? undefined,
    model: row.model ?? undefined,
    variant: row.variant ?? undefined,
    outputMode: row.output_mode ?? undefined,
    options,
  }
}

export function normalizeQuorumConfig(config: unknown) {
  const stripped = stripLegacyQuorumFields(
    typeof config === "object" && config !== null ? (config as Record<string, unknown>) : {},
  )
  return quorumConfigSchema.parse(stripped)
}

function pruneLegacyBrowserQaRows(store: ConfigStore, profileId: number) {
  const before = store.db
    .query<ConfigValueRow, [number, string]>("SELECT profile_id, domain, version, value_json FROM config_values WHERE profile_id = ? AND domain = ?")
    .get(profileId, "quorum")
  if (before) {
    const normalized = JSON.stringify(normalizeQuorumConfig(JSON.parse(before.value_json)), null, 2)
    if (normalized !== before.value_json) {
      store.db
        .query("UPDATE config_values SET value_json = ?, updated_at = ? WHERE profile_id = ? AND domain = ?")
        .run(normalized, nowIso(), profileId, "quorum")
      writeAudit(store, {
        profileId,
        source: "migration",
        action: "prune",
        subject: "config:legacy-fields",
        before: before.value_json,
        after: normalized,
      })
    }
  }

  store.db.query("DELETE FROM role_provider_bindings WHERE profile_id = ? AND role = ?").run(profileId, LEGACY_BROWSER_QA_ROLE)
  const rows = store.db.query<{ role: string; options_json: string }, [number]>(
    "SELECT role, options_json FROM role_provider_bindings WHERE profile_id = ?",
  ).all(profileId)
  for (const row of rows) {
    const options = parseJson<Record<string, unknown>>(row.options_json, {})
    if (!("mcpServers" in options)) continue
    delete options.mcpServers
    store.db.query("UPDATE role_provider_bindings SET options_json = ?, updated_at = ? WHERE profile_id = ? AND role = ?")
      .run(JSON.stringify(options), nowIso(), profileId, row.role)
  }
}

async function readDefaultsPrompts(workspaceDir: string): Promise<Array<{ key: PromptAssetKey; content: string }>> {
  const promptDir = join(repoDefaultsDir(workspaceDir), "prompts")
  const prompts: Array<{ key: PromptAssetKey; content: string }> = []
  for (const [key, filename] of Object.entries(promptAssetFiles) as Array<[PromptAssetKey, string]>) {
    const content = await readTextIfExists(join(promptDir, filename))
    if (!content) throw new Error(`Missing defaults prompt ${filename}`)
    prompts.push({ key, content })
  }
  return prompts
}

function insertPromptAsset(store: ConfigStore, profileId: number, key: PromptAssetKey, content: string, source: string) {
  const ts = nowIso()
  store.db
    .query(`
INSERT INTO prompt_assets (profile_id, key, content, version, created_at, updated_at)
VALUES (?, ?, ?, 1, ?, ?)
ON CONFLICT(profile_id, key) DO NOTHING
    `)
    .run(profileId, key, content, ts, ts)
  writeAudit(store, {
    profileId,
    source,
    action: "seed",
    subject: `prompt:${key}`,
    after: content,
  })
}

function insertRoleBindingFromRow(
  store: ConfigStore,
  profileId: number,
  binding: Pick<RoleProviderBindingRow, "role" | "provider" | "provider_agent" | "model" | "variant" | "output_mode" | "options_json">,
  source: string,
) {
  const ts = nowIso()
  store.db
    .query(`
INSERT INTO role_provider_bindings (profile_id, role, provider, provider_agent, model, variant, output_mode, options_json, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(profile_id, role) DO NOTHING
    `)
    .run(
      profileId,
      binding.role,
      binding.provider,
      binding.provider_agent,
      binding.model,
      binding.variant,
      binding.output_mode,
      binding.options_json,
      ts,
      ts,
    )
  writeAudit(store, {
    profileId,
    source,
    action: "seed",
    subject: `binding:${binding.role}`,
  })
}

async function seedBindingsFromDefaultsSqlite(store: ConfigStore, profileId: number, workspaceDir: string, source: string) {
  const { ensureDefaultsConfigDb, listDefaultsRoleBindings } = await import("./defaults-store")
  await ensureDefaultsConfigDb(workspaceDir)
  for (const binding of await listDefaultsRoleBindings(workspaceDir)) {
    insertRoleBindingFromRow(store, profileId, binding, source)
  }
}

/** Insert Playwright MCP when missing; enable it only on first insert. */
function ensureDefaultPlaywrightMcp(store: ConfigStore, profileId: number, source: string) {
  const existing = store.db.query<{ name: string }, [number, string]>(
    "SELECT name FROM mcp_servers WHERE profile_id = ? AND name = ?",
  ).get(profileId, DEFAULT_PLAYWRIGHT_MCP_SERVER.name)
  if (existing) return

  const ts = nowIso()
  const configJson = JSON.stringify(DEFAULT_PLAYWRIGHT_MCP_SERVER)
  store.db.query(`
INSERT INTO mcp_servers (profile_id, name, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
  `).run(profileId, DEFAULT_PLAYWRIGHT_MCP_SERVER.name, configJson, ts, ts)

  const maxPos = store.db.query<{ position: number }, [number]>(
    "SELECT COALESCE(MAX(position), -1) AS position FROM mcp_enabled WHERE profile_id = ?",
  ).get(profileId)
  store.db.query("INSERT INTO mcp_enabled (profile_id, name, position) VALUES (?, ?, ?)")
    .run(profileId, DEFAULT_PLAYWRIGHT_MCP_SERVER.name, (maxPos?.position ?? -1) + 1)

  writeAudit(store, {
    profileId,
    source,
    action: "seed",
    subject: `mcp:${DEFAULT_PLAYWRIGHT_MCP_SERVER.name}`,
    after: configJson,
  })
}

async function seedProfileFromDefaults(store: ConfigStore, workspaceDir: string): Promise<ConfigProfileRow> {
  const profile = createProfile(store, "default")
  const configPath = join(repoDefaultsDir(workspaceDir), "quorum.config.json")
  const rawConfig = await readJsonFile(configPath)
  const quorumConfig = normalizeQuorumConfig(rawConfig)
  const configJson = JSON.stringify(quorumConfig, null, 2)
  const ts = nowIso()

  store.db
    .query("INSERT INTO config_values (profile_id, domain, version, value_json, created_at, updated_at) VALUES (?, 'quorum', 1, ?, ?, ?)")
    .run(profile.id, configJson, ts, ts)
  writeAudit(store, {
    profileId: profile.id,
    source: "seed-defaults",
    action: "seed",
    subject: "config:quorum",
    after: configJson,
  })

  for (const prompt of await readDefaultsPrompts(workspaceDir)) {
    insertPromptAsset(store, profile.id, prompt.key, prompt.content, "seed-defaults")
  }
  await seedBindingsFromDefaultsSqlite(store, profile.id, workspaceDir, "seed-defaults")
  ensureDefaultPlaywrightMcp(store, profile.id, "seed-defaults")

  pruneLegacyBrowserQaRows(store, profile.id)
  return profile
}

async function lazyMigrateMissingDefaults(store: ConfigStore, profileId: number, workspaceDir: string) {
  for (const prompt of await readDefaultsPrompts(workspaceDir)) {
    const existing = store.db
      .query<{ key: string }, [number, string]>("SELECT key FROM prompt_assets WHERE profile_id = ? AND key = ?")
      .get(profileId, prompt.key)
    if (!existing) insertPromptAsset(store, profileId, prompt.key, prompt.content, "lazy-migrate")
  }
  const { ensureDefaultsConfigDb, listDefaultsRoleBindings } = await import("./defaults-store")
  await ensureDefaultsConfigDb(workspaceDir)
  for (const binding of await listDefaultsRoleBindings(workspaceDir)) {
    const existing = store.db
      .query<{ role: string }, [number, string]>("SELECT role FROM role_provider_bindings WHERE profile_id = ? AND role = ?")
      .get(profileId, binding.role)
    if (!existing) insertRoleBindingFromRow(store, profileId, binding, "lazy-migrate")
  }
  ensureDefaultPlaywrightMcp(store, profileId, "lazy-migrate")
}

async function importLegacyPromptFiles(store: ConfigStore, profileId: number, workspaceDir: string) {
  const legacyDirs = [
    join(workspaceDir, "assets", "prompts"),
    join(repoDefaultsDir(workspaceDir), "prompts"),
  ]
  for (const dir of legacyDirs) {
    for (const [key, filename] of Object.entries(promptAssetFiles) as Array<[PromptAssetKey, string]>) {
      const content = await readTextIfExists(join(dir, filename))
      if (!content) continue
      const existing = store.db
        .query<{ key: string }, [number, string]>("SELECT key FROM prompt_assets WHERE profile_id = ? AND key = ?")
        .get(profileId, key)
      if (!existing) insertPromptAsset(store, profileId, key, content, "legacy-import")
    }
  }
}

async function migrateLegacyDataIfNeeded(env: RuntimeEnv) {
  const paths = quorumDataPaths(env.QUORUM_DATA_DIR)
  const workspaceDir = env.QUORUM_WORKSPACE_DIRECTORY
  const legacyRunsDir = join(workspaceDir, "runs")
  const legacyConfigDb = join(legacyRunsDir, "quorum-config.sqlite")
  const legacyCheckpointDb = join(legacyRunsDir, "checkpoints.sqlite")

  await ensureQuorumDataDirs(paths)

  const targetConfigExists = await Bun.file(paths.configDb).exists()
  const legacyConfigExists = await Bun.file(legacyConfigDb).exists()

  if (!targetConfigExists && legacyConfigExists) {
    await copyPreserveTimes(legacyConfigDb, paths.configDb)
    console.warn(`[qurom] Migrated config database to ${paths.configDb}`)
  }

  if (!(await Bun.file(paths.checkpointDb).exists()) && await Bun.file(legacyCheckpointDb).exists()) {
    await copyPreserveTimes(legacyCheckpointDb, paths.checkpointDb)
    console.warn(`[qurom] Migrated checkpoint database to ${paths.checkpointDb}`)
  }

  let migratedRunDirs = 0
  try {
    const legacyEntries = await readdir(legacyRunsDir, { withFileTypes: true })
    for (const entry of legacyEntries) {
      if (!entry.isDirectory()) continue
      if (entry.name === ".drafts") continue
      const source = join(legacyRunsDir, entry.name)
      const dest = join(paths.runsDir, entry.name)
      try {
        await access(dest)
        continue
      } catch {
        await copyPreserveTimes(source, dest, { recursive: true })
        migratedRunDirs += 1
      }
    }
    if (migratedRunDirs > 0) {
      console.warn(`[qurom] Migrated ${migratedRunDirs} run director${migratedRunDirs === 1 ? "y" : "ies"} to ${paths.runsDir}`)
    }
  } catch {
    // No legacy runs directory.
  }
}

async function ensureActiveProfile(store: ConfigStore, env: RuntimeEnv): Promise<ConfigProfileRow> {
  const workspaceDir = env.QUORUM_WORKSPACE_DIRECTORY
  let profile = activeProfile(store)
  if (!profile) {
    profile = await seedProfileFromDefaults(store, workspaceDir)
  }
  pruneLegacyBrowserQaRows(store, profile.id)
  await lazyMigrateMissingDefaults(store, profile.id, workspaceDir)
  await importLegacyPromptFiles(store, profile.id, env.QUORUM_WORKSPACE_DIRECTORY)
  return profile
}

export async function ensureConfigInitialized(env: RuntimeEnv) {
  await migrateLegacyDataIfNeeded(env)
  const store = getConfigStore(env)
  try {
    await ensureActiveProfile(store, env)
  } finally {
    store.close()
  }
}

export async function loadQuorumConfigFromStore(env: RuntimeEnv) {
  const store = getConfigStore(env)
  try {
    const profile = await ensureActiveProfile(store, env)
    const row = store.db
      .query<ConfigValueRow, [number, string]>("SELECT profile_id, domain, version, value_json FROM config_values WHERE profile_id = ? AND domain = ?")
      .get(profile.id, "quorum")
    if (!row) throw new Error("Missing quorum config in active config profile")
    return normalizeQuorumConfig(JSON.parse(row.value_json))
  } finally {
    store.close()
  }
}

export async function loadRoleBindingsFromStore(env: RuntimeEnv) {
  const store = getConfigStore(env)
  try {
    const profile = await ensureActiveProfile(store, env)
    const rows = store.db
      .query<RoleProviderBindingRow, [number]>(`
SELECT profile_id, role, provider, provider_agent, model, variant, output_mode, options_json
FROM role_provider_bindings
WHERE profile_id = ?
      `)
      .all(profile.id)
    const bindings: Record<string, ReturnType<typeof bindingRowToRoleBinding>> = {}
    for (const row of rows) {
      if (row.role === LEGACY_BROWSER_QA_ROLE) continue
      bindings[row.role] = bindingRowToRoleBinding(row)
    }
    return bindings
  } finally {
    store.close()
  }
}

export async function loadMcpRegistryFromStore(env: RuntimeEnv): Promise<McpRegistry> {
  const store = getConfigStore(env)
  try {
    const profile = await ensureActiveProfile(store, env)
    const servers = store.db.query<{ config_json: string }, [number]>(
      "SELECT config_json FROM mcp_servers WHERE profile_id = ? ORDER BY name",
    ).all(profile.id).map((row) => mcpServerSchema.parse(JSON.parse(row.config_json)))
    const enabled = store.db.query<{ name: string }, [number]>(
      "SELECT name FROM mcp_enabled WHERE profile_id = ? ORDER BY position, name",
    ).all(profile.id).map((row) => row.name)
    return validateMcpRegistry({ servers, enabled })
  } finally {
    store.close()
  }
}

export async function saveMcpServer(env: RuntimeEnv, input: McpServer, previousName?: string) {
  const server = mcpServerSchema.parse(input)
  const store = getConfigStore(env)
  try {
    const profile = await ensureActiveProfile(store, env)
    const oldName = previousName?.trim() || server.name
    const duplicate = store.db.query<{ name: string }, [number, string]>(
      "SELECT name FROM mcp_servers WHERE profile_id = ? AND name = ?",
    ).get(profile.id, server.name)
    if (duplicate && oldName !== server.name) throw new Error(`MCP server ${JSON.stringify(server.name)} already exists`)
    const ts = nowIso()
    store.db.transaction(() => {
      if (oldName !== server.name) {
        const enabled = store.db.query<{ position: number }, [number, string]>(
          "SELECT position FROM mcp_enabled WHERE profile_id = ? AND name = ?",
        ).get(profile.id, oldName)
        store.db.query("DELETE FROM mcp_enabled WHERE profile_id = ? AND name = ?").run(profile.id, oldName)
        store.db.query("DELETE FROM mcp_servers WHERE profile_id = ? AND name = ?").run(profile.id, oldName)
        store.db.query(`
INSERT INTO mcp_servers (profile_id, name, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        `).run(profile.id, server.name, JSON.stringify(server), ts, ts)
        if (enabled) {
          store.db.query("INSERT INTO mcp_enabled (profile_id, name, position) VALUES (?, ?, ?)")
            .run(profile.id, server.name, enabled.position)
        }
        return
      }
      store.db.query(`
INSERT INTO mcp_servers (profile_id, name, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
ON CONFLICT(profile_id, name) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at
      `).run(profile.id, server.name, JSON.stringify(server), ts, ts)
    })()
  } finally {
    store.close()
  }
}

export async function deleteMcpServer(env: RuntimeEnv, name: string) {
  const store = getConfigStore(env)
  try {
    const profile = await ensureActiveProfile(store, env)
    store.db.transaction(() => {
      store.db.query("DELETE FROM mcp_enabled WHERE profile_id = ? AND name = ?").run(profile.id, name)
      store.db.query("DELETE FROM mcp_servers WHERE profile_id = ? AND name = ?").run(profile.id, name)
    })()
  } finally {
    store.close()
  }
}

export async function setEnabledMcpServers(env: RuntimeEnv, names: string[]) {
  const store = getConfigStore(env)
  try {
    const profile = await ensureActiveProfile(store, env)
    const unique = [...new Set(names)]
    const known = new Set(store.db.query<{ name: string }, [number]>(
      "SELECT name FROM mcp_servers WHERE profile_id = ?",
    ).all(profile.id).map((row) => row.name))
    for (const name of unique) {
      if (!known.has(name)) throw new Error(`Enabled MCP server ${JSON.stringify(name)} does not exist`)
    }
    store.db.transaction(() => {
      store.db.query("DELETE FROM mcp_enabled WHERE profile_id = ?").run(profile.id)
      unique.forEach((name, position) => {
        store.db.query("INSERT INTO mcp_enabled (profile_id, name, position) VALUES (?, ?, ?)")
          .run(profile.id, name, position)
      })
    })()
  } finally {
    store.close()
  }
}

export async function loadPromptAssetsFromStore(env: RuntimeEnv): Promise<Record<PromptAssetKey, string>> {
  const store = getConfigStore(env)
  try {
    const profile = await ensureActiveProfile(store, env)
    const assets = {} as Record<PromptAssetKey, string>
    for (const key of Object.keys(promptAssetFiles) as PromptAssetKey[]) {
      const row = store.db
        .query<{ content: string }, [number, string]>("SELECT content FROM prompt_assets WHERE profile_id = ? AND key = ?")
        .get(profile.id, key)
      if (!row?.content?.trim()) {
        throw new Error(`Missing required prompt asset ${JSON.stringify(key)} in config database`)
      }
      assets[key] = row.content.trim()
    }
    return assets
  } finally {
    store.close()
  }
}

export async function listConfigSummary(env: RuntimeEnv) {
  const store = getConfigStore(env)
  try {
    const profile = await ensureActiveProfile(store, env)
    const configRow = store.db
      .query<ConfigValueRow, [number, string]>("SELECT profile_id, domain, version, value_json FROM config_values WHERE profile_id = ? AND domain = ?")
      .get(profile.id, "quorum")
    const prompts = store.db
      .query<{ key: string; content: string; version: number }, [number]>(`
SELECT key, content, version FROM prompt_assets WHERE profile_id = ? ORDER BY key
      `)
      .all(profile.id)
      .map((row) => ({
        key: row.key as PromptAssetKey,
        content: row.content,
        version: row.version,
      }))
    const bindings = store.db
      .query<RoleProviderBindingRow, [number]>(`
SELECT profile_id, role, provider, provider_agent, model, variant, output_mode, options_json
FROM role_provider_bindings
WHERE profile_id = ?
ORDER BY role
      `)
      .all(profile.id)
    return {
      profile,
      config: configRow ? normalizeQuorumConfig(JSON.parse(configRow.value_json)) : undefined,
      prompts,
      bindings,
    }
  } finally {
    store.close()
  }
}

export async function updateRoleBinding(env: RuntimeEnv, role: string, input: {
  provider?: string
  providerAgent?: string
  model?: string
  variant?: string
  outputMode?: string
  options?: Record<string, unknown>
}) {
  const store = getConfigStore(env)
  try {
    const profile = await ensureActiveProfile(store, env)
    if (role === LEGACY_BROWSER_QA_ROLE) {
      pruneLegacyBrowserQaRows(store, profile.id)
      return
    }
    const before = store.db
      .query<RoleProviderBindingRow, [number, string]>(`
SELECT profile_id, role, provider, provider_agent, model, variant, output_mode, options_json
FROM role_provider_bindings
WHERE profile_id = ? AND role = ?
      `)
      .get(profile.id, role)
    const ts = nowIso()
    const optionsJson = JSON.stringify(input.options ?? {})
    store.db
      .query(`
INSERT INTO role_provider_bindings (profile_id, role, provider, provider_agent, model, variant, output_mode, options_json, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(profile_id, role) DO UPDATE SET
  provider = excluded.provider,
  provider_agent = excluded.provider_agent,
  model = excluded.model,
  variant = excluded.variant,
  output_mode = excluded.output_mode,
  options_json = excluded.options_json,
  updated_at = excluded.updated_at
      `)
      .run(
        profile.id,
        role,
        input.provider || null,
        input.providerAgent || null,
        input.model || null,
        input.variant || null,
        input.outputMode || null,
        optionsJson,
        ts,
        ts,
      )
    writeAudit(store, {
      profileId: profile.id,
      source: "view",
      action: "update",
      subject: `binding:${role}`,
      before: before ? JSON.stringify(before) : undefined,
      after: JSON.stringify(input),
    })
  } finally {
    store.close()
  }
}

export async function updateQuorumConfig(env: RuntimeEnv, content: string) {
  const parsed = normalizeQuorumConfig(JSON.parse(content))
  const store = getConfigStore(env)
  try {
    const profile = await ensureActiveProfile(store, env)
    const before = store.db
      .query<ConfigValueRow, [number, string]>("SELECT profile_id, domain, version, value_json FROM config_values WHERE profile_id = ? AND domain = ?")
      .get(profile.id, "quorum")
    const configJson = JSON.stringify(parsed, null, 2)
    const ts = nowIso()
    store.db
      .query(`
INSERT INTO config_values (profile_id, domain, version, value_json, created_at, updated_at)
VALUES (?, 'quorum', 1, ?, ?, ?)
ON CONFLICT(profile_id, domain) DO UPDATE SET
  value_json = excluded.value_json,
  updated_at = excluded.updated_at
      `)
      .run(profile.id, configJson, ts, ts)
    writeAudit(store, {
      profileId: profile.id,
      source: "view",
      action: "update",
      subject: "config:quorum",
      before: before?.value_json,
      after: configJson,
    })
  } finally {
    store.close()
  }
}

export async function updatePromptAsset(env: RuntimeEnv, key: string, content: string) {
  await updatePromptAssets(env, [{ key, content }])
}

export async function updatePromptAssets(
  env: RuntimeEnv,
  updates: Array<{ key: string; content: string }>,
) {
  if (updates.length === 0) return
  for (const update of updates) {
    if (!(update.key in promptAssetFiles)) throw new Error(`Unknown prompt asset ${JSON.stringify(update.key)}`)
    if (!update.content.trim()) throw new Error(`Prompt content cannot be empty for ${update.key}`)
  }
  const store = getConfigStore(env)
  try {
    const profile = await ensureActiveProfile(store, env)
    const ts = nowIso()
    for (const update of updates) {
      const before = store.db
        .query<{ content: string }, [number, string]>("SELECT content FROM prompt_assets WHERE profile_id = ? AND key = ?")
        .get(profile.id, update.key)
      const next = update.content.trim()
      if (before?.content.trim() === next) continue
      store.db
        .query(`
INSERT INTO prompt_assets (profile_id, key, content, version, created_at, updated_at)
VALUES (?, ?, ?, 1, ?, ?)
ON CONFLICT(profile_id, key) DO UPDATE SET
  content = excluded.content,
  version = prompt_assets.version + 1,
  updated_at = excluded.updated_at
        `)
        .run(profile.id, update.key, next, ts, ts)
      writeAudit(store, {
        profileId: profile.id,
        source: "view",
        action: "update",
        subject: `prompt:${update.key}`,
        before: before?.content,
        after: next,
      })
    }
  } finally {
    store.close()
  }
}

export async function syncOpencodeAgentsFromStore(_env: RuntimeEnv) {
  // OpenCode agent definitions are filesystem-only under .opencode/agents/.
}
