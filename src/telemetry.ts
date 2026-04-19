import { randomUUID } from "node:crypto"
import { LangfuseAPIClient, ObservationType, type IngestionEvent } from "@langfuse/core"

import type { RuntimeConfig } from "./config"

export type TraceObservation = {
  id: string
  traceId: string
  type: (typeof ObservationType)[keyof typeof ObservationType]
}

type ObservationInput = {
  traceId: string
  parentObservationId?: string
  name: string
  type?: keyof typeof ObservationType
  input?: unknown
  metadata?: unknown
}

type ObservationEnd = {
  output?: unknown
  metadata?: unknown
  level?: "DEBUG" | "DEFAULT" | "WARNING" | "ERROR"
  statusMessage?: string
}

export type TelemetryRun = {
  readonly enabled: boolean
  readonly warning?: string
  traceId?: string
  rootObservation?: TraceObservation
  startObservation: (input: ObservationInput) => Promise<TraceObservation | undefined>
  endObservation: (observation: TraceObservation | undefined, input?: ObservationEnd) => Promise<void>
  updateTrace: (input: { output?: unknown; metadata?: unknown; tags?: string[] }) => Promise<void>
  shutdown: () => Promise<void>
}

function nowIso() {
  return new Date().toISOString()
}

function traceNameForInput(input: { inputMode: "topic" | "document"; topic?: string; documentPath?: string }) {
  if (input.inputMode === "topic") return `research topic: ${input.topic ?? ""}`
  return `research document: ${input.documentPath ?? ""}`
}

function langfuseEnabled(config: RuntimeConfig) {
  return Boolean(config.env.LANGFUSE_PUBLIC_KEY && config.env.LANGFUSE_SECRET_KEY && config.env.LANGFUSE_BASE_URL)
}

function buildClient(config: RuntimeConfig) {
  if (!langfuseEnabled(config)) return undefined

  return new LangfuseAPIClient({
    environment: "default",
    baseUrl: config.env.LANGFUSE_BASE_URL,
    username: config.env.LANGFUSE_PUBLIC_KEY,
    password: config.env.LANGFUSE_SECRET_KEY,
    xLangfusePublicKey: config.env.LANGFUSE_PUBLIC_KEY,
    xLangfuseSdkName: "research-qurom",
    xLangfuseSdkVersion: "0.1.0",
  })
}

function disabledTelemetry(warning?: string): TelemetryRun {
  return {
    enabled: false,
    warning,
    startObservation: async () => undefined,
    endObservation: async () => {},
    updateTrace: async () => {},
    shutdown: async () => {},
  }
}

async function ingest(client: LangfuseAPIClient, batch: IngestionEvent[]) {
  const response = await client.ingestion.batch({ batch })
  if (response.errors.length === 0) return
  throw new Error(`Langfuse ingestion failed: ${JSON.stringify(response.errors)}`)
}

export async function createTelemetry(
  config: RuntimeConfig,
  input: { requestId: string; inputMode: "topic" | "document"; topic?: string; documentPath?: string },
): Promise<TelemetryRun> {
  const client = buildClient(config)

  if (!client) return disabledTelemetry()
  const langfuse = client

  const traceId = randomUUID()
  const rootObservation = {
    id: randomUUID(),
    traceId,
    type: ObservationType.Span,
  } satisfies TraceObservation
  const traceName = traceNameForInput(input)

  try {
    await ingest(client, [
      {
        type: "trace-create",
        id: randomUUID(),
        timestamp: nowIso(),
        body: {
          id: traceId,
          timestamp: nowIso(),
          name: traceName,
          input,
          sessionId: input.requestId,
          metadata: {
            requestId: input.requestId,
            inputMode: input.inputMode,
          },
          environment: "default",
        },
      },
      {
        type: "observation-create",
        id: randomUUID(),
        timestamp: nowIso(),
        body: {
          id: rootObservation.id,
          traceId,
          type: rootObservation.type,
          name: "workflow.run",
          startTime: nowIso(),
          input,
          metadata: {
            requestId: input.requestId,
          },
          environment: "default",
        },
      },
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return disabledTelemetry(`disabled Langfuse tracing: ${message}`)
  }

  let active = true

  async function safeIngest(batch: IngestionEvent[]) {
    if (!active) return

    try {
      await ingest(langfuse, batch)
    } catch (error) {
      active = false
      const message = error instanceof Error ? error.message : String(error)
      console.log(`[telemetry] disabled Langfuse tracing: ${message}`)
    }
  }

  return {
    get enabled() {
      return active
    },
    traceId,
    rootObservation,
    async startObservation(observation) {
      const next = {
        id: randomUUID(),
        traceId: observation.traceId,
        type: ObservationType[observation.type ?? "Span"],
      }

      await safeIngest([
        {
          type: "observation-create",
          id: randomUUID(),
          timestamp: nowIso(),
          body: {
            id: next.id,
            traceId: observation.traceId,
            type: next.type,
            name: observation.name,
            startTime: nowIso(),
            input: observation.input,
            metadata: observation.metadata,
            parentObservationId: observation.parentObservationId,
            environment: "default",
          },
        },
      ])

      return next
    },
    async endObservation(observation, update) {
      if (!observation) return

      await safeIngest([
        {
          type: "observation-update",
          id: randomUUID(),
          timestamp: nowIso(),
          body: {
            id: observation.id,
            traceId: observation.traceId,
            type: observation.type,
            endTime: nowIso(),
            output: update?.output,
            metadata: update?.metadata,
            level: update?.level,
            statusMessage: update?.statusMessage,
            environment: "default",
          },
        },
      ])
    },
    async updateTrace(update) {
      await safeIngest([
        {
          type: "trace-create",
          id: randomUUID(),
          timestamp: nowIso(),
          body: {
            id: traceId,
            output: update.output,
            metadata: update.metadata,
            tags: update.tags,
            environment: "default",
          },
        },
      ])
    },
    async shutdown() {},
  }
}
