import { homedir } from "node:os"
import { join } from "node:path"

export type QuorumDataPaths = {
  root: string
  configDb: string
  checkpointDb: string
  runsDir: string
  archiveDir: string
}

export function resolveQuorumDataDir(explicit?: string): string {
  if (explicit?.trim()) return explicit.trim()
  const xdg = process.env.XDG_DATA_HOME?.trim()
  const base = xdg || join(homedir(), ".local", "share")
  return join(base, "qurom")
}

export function quorumDataPaths(explicitDataDir?: string): QuorumDataPaths {
  const root = resolveQuorumDataDir(explicitDataDir ?? process.env.QUORUM_DATA_DIR)
  return {
    root,
    configDb: join(root, "quorum-config.sqlite"),
    checkpointDb: join(root, "checkpoints.sqlite"),
    runsDir: join(root, "runs"),
    archiveDir: join(root, "archive"),
  }
}

export async function ensureQuorumDataDirs(paths: QuorumDataPaths) {
  const { mkdir } = await import("node:fs/promises")
  const { dirname } = await import("node:path")
  await mkdir(dirname(paths.configDb), { recursive: true })
  await mkdir(dirname(paths.checkpointDb), { recursive: true })
  await mkdir(paths.runsDir, { recursive: true })
  await mkdir(paths.archiveDir, { recursive: true })
}

export function repoDefaultsDir(workspaceDir?: string): string {
  return join(workspaceDir ?? process.env.OPENCODE_DIRECTORY ?? process.cwd(), "defaults")
}

export function defaultsConfigDbPath(workspaceDir?: string): string {
  return join(repoDefaultsDir(workspaceDir), "quorum-config.sqlite")
}

export function opencodeAgentsDir(workspaceDir?: string): string {
  return join(workspaceDir ?? process.env.OPENCODE_DIRECTORY ?? process.cwd(), ".opencode", "agents")
}

export function defaultsOpencodeAgentsDir(workspaceDir?: string): string {
  return join(repoDefaultsDir(workspaceDir), "opencode", "agents")
}

export function opencodeSkillsDir(workspaceDir?: string): string {
  return join(workspaceDir ?? process.env.OPENCODE_DIRECTORY ?? process.cwd(), ".opencode", "skills")
}

export function defaultsOpencodeSkillsDir(workspaceDir?: string): string {
  return join(repoDefaultsDir(workspaceDir), "opencode", "skills")
}

export function defaultOpenCodeDbPath(): string {
  const explicit = process.env.OPENCODE_DB?.trim()
  if (explicit) return explicit
  const xdg = process.env.XDG_DATA_HOME?.trim()
  const base = xdg || join(homedir(), ".local", "share")
  return join(base, "opencode", "opencode.db")
}

export async function isOpenCodeDbAvailable(dbPath = defaultOpenCodeDbPath()): Promise<boolean> {
  return Bun.file(dbPath).exists()
}
