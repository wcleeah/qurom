import { mkdir, readdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import { normalizeQuorumConfig, openConfigStore } from "./config-store"
import { defaultsConfigDbPath, opencodeAgentsDir, repoDefaultsDir } from "./data-paths"
import { promptAssetFiles, type PromptAssetKey } from "./prompt-asset-defs"

export type DefaultsPromptSummary = {
  key: PromptAssetKey
  filename: string
  content: string
}

export type DefaultsOpencodeAgentSummary = {
  role: string
  content: string
}

export type DefaultsRoleBindingSummary = {
  role: string
  provider: string | null
  provider_agent: string | null
  model: string | null
  variant: string | null
  output_mode: string | null
  options_json: string
}

function nowIso() {
  return new Date().toISOString()
}

function defaultsActiveProfileId(store: ReturnType<typeof openConfigStore>) {
  const profile = store.db
    .query<{ id: number }, []>("SELECT id FROM config_profiles WHERE active = 1 LIMIT 1")
    .get()
  return profile?.id
}

function createDefaultsProfile(store: ReturnType<typeof openConfigStore>) {
  const ts = nowIso()
  store.db.run("UPDATE config_profiles SET active = 0 WHERE active = 1")
  store.db
    .query("INSERT INTO config_profiles (name, active, created_at, updated_at) VALUES ('default', 1, ?, ?)")
    .run(ts, ts)
  const profileId = defaultsActiveProfileId(store)
  if (!profileId) throw new Error("Failed to create defaults config profile")
  return profileId
}

export async function ensureDefaultsConfigDb(workspaceDir: string) {
  const dbPath = defaultsConfigDbPath(workspaceDir)
  if (await Bun.file(dbPath).exists()) return dbPath

  const store = openConfigStore(dbPath)
  try {
    const profileId = createDefaultsProfile(store)
    const ts = nowIso()
    const agents = await listDefaultsOpencodeAgents(workspaceDir)
    for (const agent of agents) {
      store.db
        .query(`
INSERT INTO role_provider_bindings (profile_id, role, provider, provider_agent, model, variant, output_mode, options_json, created_at, updated_at)
VALUES (?, ?, 'opencode', ?, NULL, NULL, NULL, '{}', ?, ?)
        `)
        .run(profileId, agent.role, agent.role, ts, ts)
    }
  } finally {
    store.close()
  }
  return dbPath
}

export async function listDefaultsRoleBindings(workspaceDir: string): Promise<DefaultsRoleBindingSummary[]> {
  await ensureDefaultsConfigDb(workspaceDir)
  const store = openConfigStore(defaultsConfigDbPath(workspaceDir))
  try {
    const profileId = defaultsActiveProfileId(store)
    if (!profileId) return []
    return store.db
      .query<DefaultsRoleBindingSummary, [number]>(`
SELECT role, provider, provider_agent, model, variant, output_mode, options_json
FROM role_provider_bindings
WHERE profile_id = ?
ORDER BY role
      `)
      .all(profileId)
  } finally {
    store.close()
  }
}

export async function updateDefaultsRoleBinding(
  workspaceDir: string,
  role: string,
  input: {
    provider?: string
    providerAgent?: string
    model?: string
    variant?: string
    outputMode?: string
    options?: Record<string, unknown>
  },
) {
  await ensureDefaultsConfigDb(workspaceDir)
  const store = openConfigStore(defaultsConfigDbPath(workspaceDir))
  try {
    const profileId = defaultsActiveProfileId(store) ?? createDefaultsProfile(store)
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
  } finally {
    store.close()
  }
}

function safeDefaultsPath(workspaceDir: string, relativePath: string): string {
  const root = resolve(repoDefaultsDir(workspaceDir))
  const target = resolve(root, relativePath)
  if (target !== root && !target.startsWith(root + "/")) {
    throw new Error("Path traversal blocked")
  }
  return target
}

async function readText(path: string) {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    throw new Error(`Missing defaults resource at ${path}`)
  }
  const content = (await file.text()).trim()
  if (!content) throw new Error(`Defaults resource is empty at ${path}`)
  return content
}

export async function listDefaultsPrompts(workspaceDir: string): Promise<DefaultsPromptSummary[]> {
  const prompts: DefaultsPromptSummary[] = []
  for (const [key, filename] of Object.entries(promptAssetFiles) as Array<[PromptAssetKey, string]>) {
    const content = await readText(safeDefaultsPath(workspaceDir, join("prompts", filename)))
    prompts.push({ key, filename, content })
  }
  return prompts
}

export async function listDefaultsOpencodeAgents(workspaceDir: string): Promise<DefaultsOpencodeAgentSummary[]> {
  const agentsDir = safeDefaultsPath(workspaceDir, join("opencode", "agents"))
  const agents: DefaultsOpencodeAgentSummary[] = []
  try {
    const entries = await readdir(agentsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue
      const role = entry.name.replace(/\.md$/, "")
      agents.push({
        role,
        content: await readText(join(agentsDir, entry.name)),
      })
    }
  } catch {
    // No shipped OpenCode defaults.
  }
  return agents.sort((a, b) => a.role.localeCompare(b.role))
}

export async function readDefaultsQuorumConfig(workspaceDir: string): Promise<string> {
  return await readText(safeDefaultsPath(workspaceDir, "quorum.config.json"))
}

export async function loadDefaultsQuorumConfig(workspaceDir: string) {
  return normalizeQuorumConfig(JSON.parse(await readDefaultsQuorumConfig(workspaceDir)))
}

export async function updateDefaultsQuorumConfig(workspaceDir: string, content: string) {
  const parsed = normalizeQuorumConfig(JSON.parse(content))
  const normalized = JSON.stringify(parsed, null, 2) + "\n"
  await writeFile(safeDefaultsPath(workspaceDir, "quorum.config.json"), normalized, "utf8")
}

export async function applyDefaultsOpencodeAgent(workspaceDir: string, role: string) {
  const agents = await listDefaultsOpencodeAgents(workspaceDir)
  const agent = agents.find((entry) => entry.role === role)
  if (!agent) throw new Error(`Unknown defaults OpenCode agent ${JSON.stringify(role)}`)
  const targetDir = opencodeAgentsDir(workspaceDir)
  await mkdir(targetDir, { recursive: true })
  await writeFile(join(targetDir, `${role}.md`), agent.content.trim() + "\n", "utf8")
}

export async function updateDefaultsPrompt(workspaceDir: string, key: string, content: string) {
  if (!(key in promptAssetFiles)) throw new Error(`Unknown prompt asset ${JSON.stringify(key)}`)
  if (!content.trim()) throw new Error("Prompt content cannot be empty")
  const filename = promptAssetFiles[key as PromptAssetKey]
  await writeFile(safeDefaultsPath(workspaceDir, join("prompts", filename)), content.trim() + "\n", "utf8")
}

export async function updateDefaultsOpencodeAgent(workspaceDir: string, role: string, content: string) {
  if (!/^[a-z0-9-]+$/.test(role)) throw new Error(`Invalid role name ${JSON.stringify(role)}`)
  if (!content.trim()) throw new Error("OpenCode agent content cannot be empty")
  await writeFile(safeDefaultsPath(workspaceDir, join("opencode", "agents", `${role}.md`)), content.trim() + "\n", "utf8")
}

export async function listDefaultsSummary(workspaceDir: string) {
  const [prompts, opencodeAgents, quorumConfig] = await Promise.all([
    listDefaultsPrompts(workspaceDir),
    listDefaultsOpencodeAgents(workspaceDir),
    readDefaultsQuorumConfig(workspaceDir),
  ])
  return {
    root: repoDefaultsDir(workspaceDir),
    quorumConfig,
    prompts,
    opencodeAgents,
  }
}
