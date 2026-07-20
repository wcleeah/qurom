import { mkdirSync } from "node:fs"
import { cp, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import type { RuntimeEnv, RuntimeConfig } from "../src/config"
import { quorumConfigSchema } from "../src/config"
import { quorumDataPaths } from "../src/data-paths"

export function unitTestDataDir(name: string) {
  return join(tmpdir(), `qurom-${name}`)
}

function ensureDataDirsSync(dataDir: string) {
  const paths = quorumDataPaths(dataDir)
  mkdirSync(dirname(paths.configDb), { recursive: true })
  mkdirSync(dirname(paths.checkpointDb), { recursive: true })
  mkdirSync(paths.runsDir, { recursive: true })
  mkdirSync(paths.archiveDir, { recursive: true })
}

export function testRuntimeEnv(input: {
  dataDir: string
  workspaceDir?: string
}): RuntimeEnv {
  ensureDataDirsSync(input.dataDir)
  const workspaceDir = input.workspaceDir ?? input.dataDir
  const paths = quorumDataPaths(input.dataDir)
  return {
    OPENCODE_BASE_URL: "http://127.0.0.1:4096",
    OPENCODE_DIRECTORY: workspaceDir,
    QUORUM_WORKSPACE_DIRECTORY: workspaceDir,
    QUORUM_DATA_DIR: paths.root,
    QUORUM_CONFIG_DB_PATH: paths.configDb,
    QUORUM_CHECKPOINT_PATH: paths.checkpointDb,
    QUORUM_RUNS_DIR: paths.runsDir,
    QUORUM_CAPTURE_OPENCODE_EVENTS: "0",
    QUORUM_CAPTURE_SYNC_HISTORY: "0",
  }
}

export function testQuorumConfig(overrides: Record<string, unknown> = {}) {
  return quorumConfigSchema.parse({
    maxRounds: 2,
    maxRebuttalTurnsPerFinding: 1,
    requireUnanimousApproval: true,
    researchTools: { prefer: ["exa"], webSearchProvider: "exa" },
    auditRestart: { maxRestarts: 1 },
    readerDiscovery: { maxTurns: 2, enabled: true },
    ...overrides,
  })
}

export function testRuntimeConfig(input: {
  dataDir: string
  workspaceDir?: string
  quorumOverrides?: Record<string, unknown>
  roleBindings?: RuntimeConfig["roleBindings"]
}): RuntimeConfig {
  const env = testRuntimeEnv(input)
  return {
    env,
    quorumConfig: testQuorumConfig(input.quorumOverrides),
    roleBindings: input.roleBindings ?? {},
  }
}

export async function installDefaultsFixtures(workspaceDir: string) {
  const repoDefaults = join(import.meta.dirname, "..", "defaults")
  await cp(repoDefaults, join(workspaceDir, "defaults"), { recursive: true })
}

export async function prepareTestDataDir(baseDir: string) {
  const dataDir = join(baseDir, "data")
  await mkdir(dataDir, { recursive: true })
  await installDefaultsFixtures(baseDir)
  return dataDir
}
