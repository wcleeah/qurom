import { config as loadEnv } from "dotenv"
import { z } from "zod"

loadEnv()

const envSchema = z.object({
  OPENCODE_BASE_URL: z.string().url().default("http://127.0.0.1:4096"),
  OPENCODE_DIRECTORY: z.string().min(1).default(process.cwd()),
  QUORUM_CHECKPOINT_PATH: z.string().min(1).default("runs/checkpoints.sqlite"),
  QUORUM_CAPTURE_OPENCODE_EVENTS: z.enum(["0", "1"]).default("0"),
  QUORUM_CAPTURE_SYNC_HISTORY: z.enum(["0", "1"]).default("0"),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().url().optional(),
})

const quorumConfigSchema = z.object({
  designatedDrafter: z.string().min(1),
  auditors: z.array(z.string().min(1)).min(1),
  maxRounds: z.number().int().positive(),
  maxRebuttalTurnsPerFinding: z.number().int().positive(),
  requireUnanimousApproval: z.boolean(),
  artifactDir: z.string().min(1),
  researchTools: z.object({
    prefer: z.array(z.string().min(1)).min(1),
    webSearchProvider: z.string().min(1),
  }),
})

export async function loadRuntimeConfig() {
  const env = envSchema.parse(process.env)
  const quorumConfig = quorumConfigSchema.parse(
    JSON.parse(await Bun.file(new URL("../quorum.config.json", import.meta.url)).text()),
  )

  return {
    env,
    quorumConfig,
  }
}

export type RuntimeConfig = Awaited<ReturnType<typeof loadRuntimeConfig>>
