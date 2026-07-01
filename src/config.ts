import { config as loadEnv } from "dotenv"
import { z } from "zod"

loadEnv()

const envSchema = z.object({
  OPENCODE_BASE_URL: z.string().url().default("http://127.0.0.1:4096"),
  OPENCODE_DIRECTORY: z.string().min(1).default(process.cwd()),
  QUORUM_WORKSPACE_DIRECTORY: z.string().min(1).default(process.cwd()),
  QUORUM_CHECKPOINT_PATH: z.string().min(1).default("runs/checkpoints.sqlite"),
  QUORUM_CONFIG_DB_PATH: z.string().min(1).default("runs/quorum-config.sqlite"),
  QUORUM_CAPTURE_OPENCODE_EVENTS: z.enum(["0", "1"]).default("0"),
  QUORUM_CAPTURE_SYNC_HISTORY: z.enum(["0", "1"]).default("0"),
  CURSOR_API_KEY: z.string().min(1).optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().url().optional(),
})

export const agentRuntimeRoleSchema = z.object({
  provider: z.string().min(1).optional(),
  providerAgent: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  variant: z.string().min(1).optional(),
  options: z.record(z.unknown()).default({}),
})

export const agentRuntimeSchema = z
  .object({
    defaultProvider: z.string().min(1).default("opencode"),
    roles: z.record(agentRuntimeRoleSchema).default({}),
  })
  .default({ defaultProvider: "opencode", roles: {} })

export const quorumConfigSchema = z.object({
  designatedDrafter: z.string().min(1),
  auditors: z.array(z.string().min(1)).min(1),
  summarizerAgent: z.string().min(1),
  maxRounds: z.number().int().positive(),
  maxRebuttalTurnsPerFinding: z.number().int().positive(),
  recursionLimit: z.number().int().positive().default(80),
  requireUnanimousApproval: z.boolean(),
  artifactDir: z.string().min(1),
  promptAssetsDir: z.string().min(1).default("assets/prompts"),
  promptManagement: z
    .object({
      source: z.enum(["local", "langfuse"]).default("local"),
      label: z.string().min(1).default("production"),
    })
    .default({ source: "local", label: "production" }),
  researchTools: z.object({
    prefer: z.array(z.string().min(1)).min(1),
    webSearchProvider: z.string().min(1),
  }),
  designQuorum: z
    .object({
      enabled: z.boolean(),
      designatedDesigner: z.string().min(1),
      auditors: z.array(z.string().min(1)).min(1),
      maxRounds: z.number().int().positive(),
    })
    .optional(),
  /**
   * Phase 3.5 — outer fresh-session restart for auditors.
   * When promptAgent's in-session RecoveryRouter exhausts its budget and throws
   * a StructuredRecoveryError, the audit caller tears down the session and re-runs
   * the identical audit prompt on a brand-new session, up to `maxRestarts` times.
   * Default 1 restart; set to 0 as the runtime kill-switch (Phase 6). Audit-only.
   */
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
  agentRuntime: agentRuntimeSchema,
})

export async function loadRuntimeConfig() {
  const env = envSchema.parse(process.env)
  const { loadQuorumConfigFromStore } = await import("./config-store")
  const quorumConfig = await loadQuorumConfigFromStore(env)

  return {
    env,
    quorumConfig,
  }
}

export type RuntimeConfig = Awaited<ReturnType<typeof loadRuntimeConfig>>
