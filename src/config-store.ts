import { Database } from "bun:sqlite"
import { mkdir, readdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { createHash } from "node:crypto"

import { quorumConfigSchema } from "./config"
import { promptAssetFiles, type PromptAssetKey } from "./prompt-asset-defs"

type EnvBootstrap = {
  OPENCODE_DIRECTORY: string
  QUORUM_WORKSPACE_DIRECTORY?: string
  QUORUM_CONFIG_DB_PATH?: string
}

function workspaceDirectory(env: EnvBootstrap) {
  return env.QUORUM_WORKSPACE_DIRECTORY ?? env.OPENCODE_DIRECTORY
}

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

type PromptAssetRow = {
  profile_id: number
  key: string
  content: string
  version: number
  active: number
}

type RoleDefinitionRow = {
  profile_id: number
  role: string
  content: string
  description: string | null
  capabilities_json: string
  enabled: number
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

async function ensureParentDir(path: string) {
  await mkdir(dirname(path), { recursive: true })
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

CREATE TABLE IF NOT EXISTS role_definitions (
  profile_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, role),
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
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, key),
  FOREIGN KEY (profile_id) REFERENCES config_profiles(id) ON DELETE CASCADE
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

  return {
    db,
    close() {
      db.close()
    },
  }
}

export async function getConfigStore(env: EnvBootstrap): Promise<ConfigStore> {
  const dbPath = env.QUORUM_CONFIG_DB_PATH ?? join(workspaceDirectory(env), "runs", "quorum-config.sqlite")
  await ensureParentDir(dbPath)
  return openConfigStore(dbPath)
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

export function getActiveConfigProfile(store: ConfigStore): ConfigProfileRow | undefined {
  return activeProfile(store)
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

async function readJsonFile(path: string) {
  return JSON.parse(await Bun.file(path).text())
}

async function readTextIfExists(path: string) {
  const file = Bun.file(path)
  if (!(await file.exists())) return undefined
  return (await file.text()).trim()
}

function mergeRoleBindingsIntoConfig(config: unknown, bindings: RoleProviderBindingRow[]) {
  const parsed = quorumConfigSchema.parse(config)
  const roles = { ...parsed.agentRuntime.roles }
  for (const binding of bindings) {
    roles[binding.role] = {
      provider: binding.provider ?? undefined,
      providerAgent: binding.provider_agent ?? undefined,
      model: binding.model ?? undefined,
      variant: binding.variant ?? undefined,
      options: parseJson<Record<string, unknown>>(binding.options_json, {}),
    }
  }
  return quorumConfigSchema.parse({
    ...parsed,
    agentRuntime: {
      ...parsed.agentRuntime,
      roles,
    },
  })
}

async function readOpencodeRoleDefinitions(env: EnvBootstrap, profileId: number): Promise<RoleDefinitionRow[]> {
  const agentsDir = join(workspaceDirectory(env), ".opencode", "agents")
  const roles: RoleDefinitionRow[] = []
  try {
    const entries = await readdir(agentsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue
      const role = entry.name.replace(/\.md$/, "")
      const content = await readTextIfExists(join(agentsDir, entry.name))
      if (!content) continue
      roles.push({
        profile_id: profileId,
        role,
        content,
        description: role,
        capabilities_json: "[]",
        enabled: 1,
      })
    }
  } catch {
    // OpenCode files are only relevant when the OpenCode provider is used.
  }
  return roles.sort((a, b) => a.role.localeCompare(b.role))
}

export async function seedConfigStoreFromFiles(env: EnvBootstrap, store?: ConfigStore) {
  const ownedStore = store ?? await getConfigStore(env)
  const shouldClose = !store
  store = ownedStore
  try {
  const existing = activeProfile(store)
  if (existing) return existing

  const profile = createProfile(store, "default")
  const configPath = join(workspaceDirectory(env), "quorum.config.json")
  const rawConfig = await readJsonFile(configPath)
  const quorumConfig = quorumConfigSchema.parse(rawConfig)
  const configJson = JSON.stringify(quorumConfig, null, 2)
  const ts = nowIso()

  store.db
    .query("INSERT INTO config_values (profile_id, domain, version, value_json, created_at, updated_at) VALUES (?, 'quorum', 1, ?, ?, ?)")
    .run(profile.id, configJson, ts, ts)
  writeAudit(store, {
    profileId: profile.id,
    source: "seed-files",
    action: "seed",
    subject: "config:quorum",
    after: configJson,
  })

  const promptDir = join(workspaceDirectory(env), quorumConfig.promptAssetsDir)
  for (const [key, filename] of Object.entries(promptAssetFiles)) {
    const content = await readTextIfExists(join(promptDir, filename))
    if (!content) continue
    store.db
      .query("INSERT INTO prompt_assets (profile_id, key, content, version, active, created_at, updated_at) VALUES (?, ?, ?, 1, 1, ?, ?)")
      .run(profile.id, key, content, ts, ts)
    writeAudit(store, {
      profileId: profile.id,
      source: "seed-files",
      action: "seed",
      subject: `prompt:${key}`,
      after: content,
    })
  }

  const agentsDir = join(workspaceDirectory(env), ".opencode", "agents")
  try {
    const entries = await readdir(agentsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue
      const role = entry.name.replace(/\.md$/, "")
      const content = await readTextIfExists(join(agentsDir, entry.name))
      if (!content) continue
      store.db
        .query(`
INSERT INTO role_definitions (profile_id, role, description, content, capabilities_json, enabled, created_at, updated_at)
VALUES (?, ?, ?, ?, '[]', 1, ?, ?)
        `)
        .run(profile.id, role, role, content, ts, ts)
      store.db
        .query(`
INSERT INTO role_provider_bindings (profile_id, role, provider, provider_agent, options_json, created_at, updated_at)
VALUES (?, ?, 'opencode', ?, '{}', ?, ?)
        `)
        .run(profile.id, role, role, ts, ts)
      writeAudit(store, {
        profileId: profile.id,
        source: "seed-files",
        action: "seed",
        subject: `role:${role}`,
        after: content,
      })
    }
  } catch {
    // OpenCode agent files are compatibility input only; missing files should not
    // block config DB creation for other providers.
  }

  return profile
  } finally {
    if (shouldClose) store.close()
  }
}

export async function loadQuorumConfigFromStore(env: EnvBootstrap) {
  const store = await getConfigStore(env)
  try {
    const profile = await seedConfigStoreFromFiles(env, store)
    const row = store.db
      .query<ConfigValueRow, [number, string]>("SELECT profile_id, domain, version, value_json FROM config_values WHERE profile_id = ? AND domain = ?")
      .get(profile.id, "quorum")
    if (!row) throw new Error("Missing quorum config in active config profile")

    const bindings = store.db
      .query<RoleProviderBindingRow, [number]>(`
SELECT profile_id, role, provider, provider_agent, model, variant, output_mode, options_json
FROM role_provider_bindings
WHERE profile_id = ?
      `)
      .all(profile.id)
    return mergeRoleBindingsIntoConfig(JSON.parse(row.value_json), bindings)
  } finally {
    store.close()
  }
}

export async function loadPromptAssetsFromStore(env: EnvBootstrap): Promise<Record<PromptAssetKey, string>> {
  const store = await getConfigStore(env)
  try {
    const profile = await seedConfigStoreFromFiles(env, store)
    const rows = store.db
      .query<PromptAssetRow, [number]>("SELECT profile_id, key, content, version, active FROM prompt_assets WHERE profile_id = ? AND active = 1")
      .all(profile.id)
    const assets = {} as Record<PromptAssetKey, string>
    for (const [key] of Object.entries(promptAssetFiles)) {
      const row = rows.find((r) => r.key === key)
      if (!row?.content.trim()) {
        throw new Error(`Missing required prompt asset ${JSON.stringify(key)} in config store`)
      }
      assets[key as PromptAssetKey] = row.content.trim()
    }
    return assets
  } finally {
    store.close()
  }
}

export async function listConfigSummary(env: EnvBootstrap) {
  const store = await getConfigStore(env)
  try {
    const profile = await seedConfigStoreFromFiles(env, store)
    const configRow = store.db
      .query<ConfigValueRow, [number, string]>("SELECT profile_id, domain, version, value_json FROM config_values WHERE profile_id = ? AND domain = ?")
      .get(profile.id, "quorum")
    const prompts = store.db
      .query<PromptAssetRow, [number]>("SELECT profile_id, key, content, version, active FROM prompt_assets WHERE profile_id = ? ORDER BY key")
      .all(profile.id)
    const roles = await readOpencodeRoleDefinitions(env, profile.id)
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
      config: configRow ? quorumConfigSchema.parse(JSON.parse(configRow.value_json)) : undefined,
      prompts,
      roles,
      bindings,
    }
  } finally {
    store.close()
  }
}

export async function updateRoleBinding(env: EnvBootstrap, role: string, input: {
  provider?: string
  providerAgent?: string
  model?: string
  variant?: string
  outputMode?: string
  options?: Record<string, unknown>
}) {
  const store = await getConfigStore(env)
  try {
    const profile = await seedConfigStoreFromFiles(env, store)
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

export async function updatePromptAsset(env: EnvBootstrap, key: string, content: string) {
  if (!(key in promptAssetFiles)) throw new Error(`Unknown prompt asset ${JSON.stringify(key)}`)
  if (!content.trim()) throw new Error("Prompt content cannot be empty")
  const store = await getConfigStore(env)
  try {
    const profile = await seedConfigStoreFromFiles(env, store)
    const before = store.db
      .query<PromptAssetRow, [number, string]>("SELECT profile_id, key, content, version, active FROM prompt_assets WHERE profile_id = ? AND key = ?")
      .get(profile.id, key)
    const ts = nowIso()
    store.db
      .query(`
INSERT INTO prompt_assets (profile_id, key, content, version, active, created_at, updated_at)
VALUES (?, ?, ?, 1, 1, ?, ?)
ON CONFLICT(profile_id, key) DO UPDATE SET
  content = excluded.content,
  version = prompt_assets.version + 1,
  active = 1,
  updated_at = excluded.updated_at
      `)
      .run(profile.id, key, content.trim(), ts, ts)
    writeAudit(store, {
      profileId: profile.id,
      source: "view",
      action: "update",
      subject: `prompt:${key}`,
      before: before?.content,
      after: content.trim(),
    })
  } finally {
    store.close()
  }
}

export async function listRoleDefinitions(env: EnvBootstrap) {
  const store = await getConfigStore(env)
  try {
    const profile = await seedConfigStoreFromFiles(env, store)
    return await readOpencodeRoleDefinitions(env, profile.id)
  } finally {
    store.close()
  }
}

export async function syncOpencodeAgentsFromStore(env: EnvBootstrap) {
  const store = await getConfigStore(env)
  try {
    const profile = await seedConfigStoreFromFiles(env, store)
    writeAudit(store, {
      profileId: profile.id,
      source: "provider:opencode",
      action: "use-files",
      subject: "opencode-agents",
    })
  } finally {
    store.close()
  }
}
