import { Database } from "bun:sqlite"
import { access, readdir } from "node:fs/promises"
import { join } from "node:path"
import { createHash } from "node:crypto"

import type { RoleBinding, RuntimeEnv } from "./config"
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
import {
  GRAPHICAL_ENHANCER_ROLE,
  LEGACY_INTERACTIVE_ENHANCER_ROLE,
} from "./design-artifacts"

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
const LEGACY_INTERACTIVE_ENHANCER_PROMPT_KEY = "interactiveEnhancerEnhance"

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

CREATE TABLE IF NOT EXISTS role_binding_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(profile_id, name),
  FOREIGN KEY (profile_id) REFERENCES config_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS role_binding_preset_roles (
  preset_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  provider TEXT,
  provider_agent TEXT,
  model TEXT,
  variant TEXT,
  output_mode TEXT,
  options_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (preset_id, role),
  FOREIGN KEY (preset_id) REFERENCES role_binding_presets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS role_binding_preset_state (
  profile_id INTEGER PRIMARY KEY,
  last_used_preset_id INTEGER,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES config_profiles(id) ON DELETE CASCADE
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

export function bindingRowToRoleBinding(row: Pick<RoleProviderBindingRow, "provider" | "provider_agent" | "model" | "variant" | "output_mode" | "options_json">): RoleBinding {
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

export type RoleBindingSnapshotSummary = {
  id: number
  name: string
  roleCount: number
  createdAt: string
  updatedAt: string
  matchesLive: boolean
  isLastUsed: boolean
}

const SNAPSHOT_NAME_MAX = 80

type RoleBindingSnapshotRow = {
  id: number
  name: string
  created_at: string
  updated_at: string
}

function isLegacyBindingRole(role: string) {
  return role === LEGACY_BROWSER_QA_ROLE || role === LEGACY_INTERACTIVE_ENHANCER_ROLE
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, stableJsonValue((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

export function canonicalRoleBindingJson(binding: RoleBinding | undefined): string {
  if (!binding) return "null"
  return JSON.stringify({
    provider: binding.provider ?? null,
    providerAgent: binding.providerAgent ?? null,
    model: binding.model ?? null,
    variant: binding.variant ?? null,
    outputMode: binding.outputMode ?? null,
    options: stableJsonValue(binding.options ?? {}),
  })
}

export function normalizeRoleBindingSnapshotName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ")
  if (!trimmed) throw new Error("Snapshot name is required")
  if (trimmed.length > SNAPSHOT_NAME_MAX) {
    throw new Error(`Snapshot name must be ${SNAPSHOT_NAME_MAX} characters or fewer`)
  }
  return trimmed
}

function snapshotNameConflictMessage(name: string) {
  return `A snapshot named ${JSON.stringify(name)} already exists`
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}

export function normalizeQuorumConfig(config: unknown) {
  const stripped = stripLegacyQuorumFields(
    typeof config === "object" && config !== null ? (config as Record<string, unknown>) : {},
  )
  return quorumConfigSchema.parse(stripped)
}

function migrateInteractiveEnhancerToGraphical(store: ConfigStore, profileId: number) {
  const ts = nowIso()
  const oldBinding = store.db
    .query<RoleProviderBindingRow, [number, string]>(`
SELECT profile_id, role, provider, provider_agent, model, variant, output_mode, options_json
FROM role_provider_bindings
WHERE profile_id = ? AND role = ?
    `)
    .get(profileId, LEGACY_INTERACTIVE_ENHANCER_ROLE)
  const newBinding = store.db
    .query<RoleProviderBindingRow, [number, string]>(`
SELECT profile_id, role, provider, provider_agent, model, variant, output_mode, options_json
FROM role_provider_bindings
WHERE profile_id = ? AND role = ?
    `)
    .get(profileId, GRAPHICAL_ENHANCER_ROLE)

  if (oldBinding && !newBinding) {
    const nextAgent = oldBinding.provider_agent === LEGACY_INTERACTIVE_ENHANCER_ROLE
      ? GRAPHICAL_ENHANCER_ROLE
      : oldBinding.provider_agent
    store.db.query(`
UPDATE role_provider_bindings
SET role = ?, provider_agent = ?, updated_at = ?
WHERE profile_id = ? AND role = ?
    `).run(GRAPHICAL_ENHANCER_ROLE, nextAgent, ts, profileId, LEGACY_INTERACTIVE_ENHANCER_ROLE)
    writeAudit(store, {
      profileId,
      source: "migration",
      action: "rename",
      subject: `binding:${LEGACY_INTERACTIVE_ENHANCER_ROLE}->${GRAPHICAL_ENHANCER_ROLE}`,
      before: JSON.stringify(oldBinding),
      after: JSON.stringify({ ...oldBinding, role: GRAPHICAL_ENHANCER_ROLE, provider_agent: nextAgent }),
    })
  } else if (oldBinding && newBinding) {
    store.db.query("DELETE FROM role_provider_bindings WHERE profile_id = ? AND role = ?")
      .run(profileId, LEGACY_INTERACTIVE_ENHANCER_ROLE)
    writeAudit(store, {
      profileId,
      source: "migration",
      action: "prune",
      subject: `binding:${LEGACY_INTERACTIVE_ENHANCER_ROLE}`,
      before: JSON.stringify(oldBinding),
    })
  }

  const oldPrompt = store.db
    .query<{ content: string }, [number, string]>("SELECT content FROM prompt_assets WHERE profile_id = ? AND key = ?")
    .get(profileId, LEGACY_INTERACTIVE_ENHANCER_PROMPT_KEY)
  if (oldPrompt) {
    store.db.query("DELETE FROM prompt_assets WHERE profile_id = ? AND key = ?")
      .run(profileId, LEGACY_INTERACTIVE_ENHANCER_PROMPT_KEY)
    writeAudit(store, {
      profileId,
      source: "migration",
      action: "prune",
      subject: `prompt:${LEGACY_INTERACTIVE_ENHANCER_PROMPT_KEY}`,
      before: oldPrompt.content,
    })
  }
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
  migrateInteractiveEnhancerToGraphical(store, profile.id)
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
  migrateInteractiveEnhancerToGraphical(store, profile.id)
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
    return liveBindingsFromRows(listLiveBindingRows(store, profile.id))
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

function listLiveBindingRows(store: ConfigStore, profileId: number): RoleProviderBindingRow[] {
  return store.db
    .query<RoleProviderBindingRow, [number]>(`
SELECT profile_id, role, provider, provider_agent, model, variant, output_mode, options_json
FROM role_provider_bindings
WHERE profile_id = ?
ORDER BY role
    `)
    .all(profileId)
    .filter((row) => !isLegacyBindingRole(row.role))
}

function liveBindingsFromRows(rows: RoleProviderBindingRow[]): Record<string, RoleBinding> {
  const bindings: Record<string, RoleBinding> = {}
  for (const row of rows) {
    bindings[row.role] = bindingRowToRoleBinding(row)
  }
  return bindings
}

function loadPresetBindingRows(store: ConfigStore, presetId: number) {
  return store.db
    .query<Pick<RoleProviderBindingRow, "role" | "provider" | "provider_agent" | "model" | "variant" | "output_mode" | "options_json">, [number]>(`
SELECT role, provider, provider_agent, model, variant, output_mode, options_json
FROM role_binding_preset_roles
WHERE preset_id = ?
ORDER BY role
    `)
    .all(presetId)
}

function lastUsedPresetId(store: ConfigStore, profileId: number): number | undefined {
  return store.db
    .query<{ last_used_preset_id: number | null }, [number]>(
      "SELECT last_used_preset_id FROM role_binding_preset_state WHERE profile_id = ?",
    )
    .get(profileId)?.last_used_preset_id ?? undefined
}

function setLastUsedPreset(store: ConfigStore, profileId: number, presetId: number | null) {
  const ts = nowIso()
  store.db
    .query(`
INSERT INTO role_binding_preset_state (profile_id, last_used_preset_id, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(profile_id) DO UPDATE SET
  last_used_preset_id = excluded.last_used_preset_id,
  updated_at = excluded.updated_at
    `)
    .run(profileId, presetId, ts)
}

function getPresetRow(store: ConfigStore, profileId: number, presetId: number): RoleBindingSnapshotRow {
  const row = store.db
    .query<RoleBindingSnapshotRow, [number, number]>(`
SELECT id, name, created_at, updated_at
FROM role_binding_presets
WHERE profile_id = ? AND id = ?
    `)
    .get(profileId, presetId)
  if (!row) throw new Error(`Unknown snapshot ${presetId}`)
  return row
}

function replacePresetRoles(store: ConfigStore, presetId: number, rows: RoleProviderBindingRow[]) {
  store.db.query("DELETE FROM role_binding_preset_roles WHERE preset_id = ?").run(presetId)
  const insert = store.db.query(`
INSERT INTO role_binding_preset_roles (preset_id, role, provider, provider_agent, model, variant, output_mode, options_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const row of rows) {
    const binding = bindingRowToRoleBinding(row)
    insert.run(
      presetId,
      row.role,
      binding.provider ?? null,
      binding.providerAgent ?? null,
      binding.model ?? null,
      binding.variant ?? null,
      binding.outputMode ?? null,
      JSON.stringify(binding.options ?? {}),
    )
  }
}

function snapshotMatchesLive(
  snapshotRows: Array<Pick<RoleProviderBindingRow, "role" | "provider" | "provider_agent" | "model" | "variant" | "output_mode" | "options_json">>,
  live: Record<string, RoleBinding>,
) {
  return snapshotRows.every((row) =>
    canonicalRoleBindingJson(live[row.role]) === canonicalRoleBindingJson(bindingRowToRoleBinding(row)),
  )
}

function writeRoleBinding(
  store: ConfigStore,
  profileId: number,
  role: string,
  input: RoleBinding,
  source: string,
) {
  if (role === LEGACY_BROWSER_QA_ROLE) {
    pruneLegacyBrowserQaRows(store, profileId)
    return
  }
  if (role === LEGACY_INTERACTIVE_ENHANCER_ROLE) {
    role = GRAPHICAL_ENHANCER_ROLE
  }
  if (input.providerAgent === LEGACY_INTERACTIVE_ENHANCER_ROLE) {
    input = { ...input, providerAgent: GRAPHICAL_ENHANCER_ROLE }
  }
  const before = store.db
    .query<RoleProviderBindingRow, [number, string]>(`
SELECT profile_id, role, provider, provider_agent, model, variant, output_mode, options_json
FROM role_provider_bindings
WHERE profile_id = ? AND role = ?
    `)
    .get(profileId, role)
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
      profileId,
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
    profileId,
    source,
    action: "update",
    subject: `binding:${role}`,
    before: before ? JSON.stringify(before) : undefined,
    after: JSON.stringify(input),
  })
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
    writeRoleBinding(store, profile.id, role, {
      provider: input.provider,
      providerAgent: input.providerAgent,
      model: input.model,
      variant: input.variant,
      outputMode: input.outputMode,
      options: input.options ?? {},
    }, "view")
  } finally {
    store.close()
  }
}

export async function listRoleBindingSnapshots(env: RuntimeEnv): Promise<RoleBindingSnapshotSummary[]> {
  const store = getConfigStore(env)
  try {
    const profile = await ensureActiveProfile(store, env)
    const live = liveBindingsFromRows(listLiveBindingRows(store, profile.id))
    const lastUsedId = lastUsedPresetId(store, profile.id)
    const presets = store.db
      .query<RoleBindingSnapshotRow, [number]>(`
SELECT id, name, created_at, updated_at
FROM role_binding_presets
WHERE profile_id = ?
ORDER BY updated_at DESC, name COLLATE NOCASE
      `)
      .all(profile.id)
    return presets.map((preset) => {
      const roles = loadPresetBindingRows(store, preset.id)
      return {
        id: preset.id,
        name: preset.name,
        roleCount: roles.length,
        createdAt: preset.created_at,
        updatedAt: preset.updated_at,
        matchesLive: snapshotMatchesLive(roles, live),
        isLastUsed: lastUsedId === preset.id,
      }
    })
  } finally {
    store.close()
  }
}

export async function saveRoleBindingSnapshot(env: RuntimeEnv, name: string) {
  const snapshotName = normalizeRoleBindingSnapshotName(name)
  const store = getConfigStore(env)
  try {
    const profile = await ensureActiveProfile(store, env)
    const liveRows = listLiveBindingRows(store, profile.id)
    const ts = nowIso()
    try {
      store.db.transaction(() => {
        const inserted = store.db
          .query("INSERT INTO role_binding_presets (profile_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
          .run(profile.id, snapshotName, ts, ts)
        const presetId = Number(inserted.lastInsertRowid)
        if (!Number.isInteger(presetId) || presetId <= 0) throw new Error("Failed to create snapshot")
        replacePresetRoles(store, presetId, liveRows)
        setLastUsedPreset(store, profile.id, presetId)
        writeAudit(store, {
          profileId: profile.id,
          source: "view",
          action: "create",
          subject: `binding-snapshot:${snapshotName}`,
          after: JSON.stringify({ name: snapshotName, roles: liveRows.map((row) => row.role) }),
        })
      })()
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new Error(snapshotNameConflictMessage(snapshotName))
      throw error
    }
  } finally {
    store.close()
  }
}

export async function overwriteRoleBindingSnapshot(env: RuntimeEnv, snapshotId: number) {
  const store = getConfigStore(env)
  try {
    const profile = await ensureActiveProfile(store, env)
    const preset = getPresetRow(store, profile.id, snapshotId)
    const liveRows = listLiveBindingRows(store, profile.id)
    const ts = nowIso()
    store.db.transaction(() => {
      replacePresetRoles(store, preset.id, liveRows)
      store.db
        .query("UPDATE role_binding_presets SET updated_at = ? WHERE id = ?")
        .run(ts, preset.id)
      setLastUsedPreset(store, profile.id, preset.id)
      writeAudit(store, {
        profileId: profile.id,
        source: "view",
        action: "update",
        subject: `binding-snapshot:${preset.name}`,
        after: JSON.stringify({ name: preset.name, roles: liveRows.map((row) => row.role) }),
      })
    })()
  } finally {
    store.close()
  }
}

export async function applyRoleBindingSnapshot(env: RuntimeEnv, snapshotId: number) {
  const store = getConfigStore(env)
  try {
    const profile = await ensureActiveProfile(store, env)
    const preset = getPresetRow(store, profile.id, snapshotId)
    const rows = loadPresetBindingRows(store, preset.id)
    store.db.transaction(() => {
      for (const row of rows) {
        writeRoleBinding(store, profile.id, row.role, bindingRowToRoleBinding(row), "view")
      }
      setLastUsedPreset(store, profile.id, preset.id)
      writeAudit(store, {
        profileId: profile.id,
        source: "view",
        action: "apply",
        subject: `binding-snapshot:${preset.name}`,
        after: JSON.stringify({ name: preset.name, roles: rows.map((row) => row.role) }),
      })
    })()
  } finally {
    store.close()
  }
}

export async function renameRoleBindingSnapshot(env: RuntimeEnv, snapshotId: number, name: string) {
  const snapshotName = normalizeRoleBindingSnapshotName(name)
  const store = getConfigStore(env)
  try {
    const profile = await ensureActiveProfile(store, env)
    const preset = getPresetRow(store, profile.id, snapshotId)
    if (preset.name === snapshotName) return
    const ts = nowIso()
    try {
      store.db
        .query("UPDATE role_binding_presets SET name = ?, updated_at = ? WHERE id = ?")
        .run(snapshotName, ts, preset.id)
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new Error(snapshotNameConflictMessage(snapshotName))
      throw error
    }
    writeAudit(store, {
      profileId: profile.id,
      source: "view",
      action: "rename",
      subject: `binding-snapshot:${preset.name}->${snapshotName}`,
    })
  } finally {
    store.close()
  }
}

export async function deleteRoleBindingSnapshot(env: RuntimeEnv, snapshotId: number) {
  const store = getConfigStore(env)
  try {
    const profile = await ensureActiveProfile(store, env)
    const preset = getPresetRow(store, profile.id, snapshotId)
    store.db.transaction(() => {
      store.db.query("DELETE FROM role_binding_preset_roles WHERE preset_id = ?").run(preset.id)
      store.db.query("DELETE FROM role_binding_presets WHERE id = ?").run(preset.id)
      if (lastUsedPresetId(store, profile.id) === preset.id) {
        setLastUsedPreset(store, profile.id, null)
      }
      writeAudit(store, {
        profileId: profile.id,
        source: "view",
        action: "delete",
        subject: `binding-snapshot:${preset.name}`,
      })
    })()
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
