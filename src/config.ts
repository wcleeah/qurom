import { config as loadEnv } from "dotenv"
import { z } from "zod"

import { quorumDataPaths } from "./data-paths"

loadEnv()

const envSchema = z.object({
  OPENCODE_BASE_URL: z.string().url().default("http://127.0.0.1:4096"),
  OPENCODE_DIRECTORY: z.string().min(1).default(process.cwd()),
  QUORUM_WORKSPACE_DIRECTORY: z.string().min(1).default(process.cwd()),
  QUORUM_DATA_DIR: z.string().min(1).optional(),
  QUORUM_CAPTURE_OPENCODE_EVENTS: z.enum(["0", "1"]).default("0"),
  QUORUM_CAPTURE_SYNC_HISTORY: z.enum(["0", "1"]).default("0"),
  CURSOR_API_KEY: z.string().min(1).optional(),
  CONTEXT7_API_KEY: z.string().min(1).optional(),
  EXA_API_KEY: z.string().min(1).optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().url().optional(),
  TURSO_DATABASE_URL: z.string().min(1).optional(),
  TURSO_AUTH_TOKEN: z.string().min(1).optional(),
})

export const quorumConfigSchema = z.object({
  maxRounds: z.number().int().positive(),
  maxRebuttalTurnsPerFinding: z.number().int().positive(),
  recursionLimit: z.number().int().positive().default(80),
  requireUnanimousApproval: z.boolean(),
  researchTools: z.object({
    prefer: z.array(z.string().min(1)).min(1),
    webSearchProvider: z.string().min(1),
  }),
  designQuorum: z
    .object({
      enabled: z.boolean(),
    })
    .optional(),
  auditRestart: z
    .object({
      maxRestarts: z.number().int().nonnegative().default(1),
    })
    .default({ maxRestarts: 1 }),
  readerDiscovery: z
    .object({
      maxTurns: z.number().int().positive().default(6),
      enabled: z.boolean().default(true),
    })
    .default({ maxTurns: 6, enabled: true }),
})

export type QuorumConfig = z.infer<typeof quorumConfigSchema>

export type RoleBinding = {
  provider?: string
  providerAgent?: string
  model?: string
  variant?: string
  outputMode?: string
  options: Record<string, unknown>
}

export type RuntimeEnv = z.infer<typeof envSchema> & {
  QUORUM_DATA_DIR: string
  QUORUM_CONFIG_DB_PATH: string
  QUORUM_CHECKPOINT_PATH: string
  QUORUM_RUNS_DIR: string
}

export async function loadRuntimeConfig() {
  const parsed = envSchema.parse(process.env)
  const paths = quorumDataPaths(parsed.QUORUM_DATA_DIR)
  const env: RuntimeEnv = {
    ...parsed,
    QUORUM_DATA_DIR: paths.root,
    QUORUM_CONFIG_DB_PATH: paths.configDb,
    QUORUM_CHECKPOINT_PATH: paths.checkpointDb,
    QUORUM_RUNS_DIR: paths.runsDir,
  }
  const {
    ensureConfigInitialized,
    loadQuorumConfigFromStore,
    loadRoleBindingsFromStore,
  } = await import("./config-store")
  await ensureConfigInitialized(env)
  const [quorumConfig, roleBindings] = await Promise.all([
    loadQuorumConfigFromStore(env),
    loadRoleBindingsFromStore(env),
  ])

  return {
    env,
    quorumConfig,
    roleBindings,
  }
}

export type RuntimeConfig = Awaited<ReturnType<typeof loadRuntimeConfig>>
