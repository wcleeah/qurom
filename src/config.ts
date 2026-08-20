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
  OPENCODE_DB: z.string().min(1).optional(),
})

export const quorumConfigSchema = z.object({
  maxRounds: z.number().int().positive(),
  maxRebuttalTurnsPerFinding: z.number().int().positive(),
  maxConcurrentRuns: z.number().int().positive().max(8).default(1),
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
  tagging: z
    .object({
      enabled: z.boolean().default(true),
      maxArticleTags: z.number().int().positive().max(32).default(8),
      maxNoteTags: z.number().int().positive().max(32).default(8),
      predefinedTags: z
        .array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))
        .default([]),
    })
    .default({
      enabled: true,
      maxArticleTags: 8,
      maxNoteTags: 8,
      predefinedTags: [],
    }),
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
    loadMcpRegistryFromStore,
  } = await import("./config-store")
  await ensureConfigInitialized(env)
  const [quorumConfig, roleBindings, mcpRegistry] = await Promise.all([
    loadQuorumConfigFromStore(env),
    loadRoleBindingsFromStore(env),
    loadMcpRegistryFromStore(env),
  ])

  return {
    env,
    quorumConfig,
    roleBindings,
    mcpRegistry,
  }
}

export type RuntimeConfig = Awaited<ReturnType<typeof loadRuntimeConfig>>
