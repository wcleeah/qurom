import { LangfuseSpanProcessor } from "@langfuse/otel"
import {
  type LangfuseAgent,
  type LangfuseChain,
  type LangfuseEvaluator,
  type LangfuseGeneration,
  type LangfuseObservation,
  type LangfuseSpan,
  type LangfuseTool,
  propagateAttributes,
  setLangfuseTracerProvider,
  startActiveObservation,
  startObservation,
} from "@langfuse/tracing"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions"
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"

import type { RuntimeConfig } from "./config"
import type { UsageTotals } from "./usage"
import { hasCost, hasUsage } from "./usage"

export type TraceObservation = {
  id: string
  traceId: string
  type: "Span" | "Agent" | "Generation" | "Tool" | "Chain" | "Evaluator"
  observation: LangfuseObservation
}

export type LangfuseUsageDetails = {
  input: number
  output: number
  total: number
}

type ObservationInput = {
  traceId: string
  parentObservationId?: string
  name: string
  type?: TraceObservation["type"]
  input?: unknown
  metadata?: Record<string, unknown>
}

type ObservationEnd = {
  output?: unknown
  metadata?: Record<string, unknown>
  level?: "DEBUG" | "DEFAULT" | "WARNING" | "ERROR"
  statusMessage?: string
  model?: string
  usageDetails?: LangfuseUsageDetails
  costDetails?: { total?: number }
}

export type TelemetryRun = {
  readonly enabled: boolean
  readonly warning?: string
  traceId?: string
  rootObservation?: TraceObservation
  runWithRootObservation: <T>(fn: () => Promise<T>) => Promise<T>
  startObservation: (input: ObservationInput) => Promise<TraceObservation | undefined>
  updateObservation: (
    observation: TraceObservation | undefined,
    input?: ObservationEnd,
  ) => Promise<void>
  endObservation: (
    observation: TraceObservation | undefined,
    input?: ObservationEnd,
  ) => Promise<void>
  updateTrace: (input: {
    output?: unknown
    metadata?: Record<string, unknown>
    tags?: string[]
  }) => Promise<void>
  shutdown: () => Promise<void>
}

/** Map Qurom usage totals into Langfuse generation usageDetails. */
export function toUsageDetails(usage: UsageTotals | undefined): LangfuseUsageDetails | undefined {
  if (!usage || !hasUsage(usage)) return undefined
  return {
    input: usage.tokensIn,
    output: usage.tokensOut,
    total: usage.tokensIn + usage.tokensOut,
  }
}

export function toCostDetails(usage: UsageTotals | undefined): { total: number } | undefined {
  if (!usage || !hasCost(usage) || usage.costUsd == null) return undefined
  return { total: usage.costUsd }
}

function traceNameForInput(input: {
  inputMode: "topic" | "document"
  topic?: string
  documentPath?: string
}) {
  if (input.inputMode === "topic") return `research topic: ${input.topic ?? ""}`
  return `research document: ${input.documentPath ?? ""}`
}

function langfuseKeysPresent(env?: {
  LANGFUSE_PUBLIC_KEY?: string
  LANGFUSE_SECRET_KEY?: string
  LANGFUSE_BASE_URL?: string
}) {
  const publicKey = env?.LANGFUSE_PUBLIC_KEY ?? process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = env?.LANGFUSE_SECRET_KEY ?? process.env.LANGFUSE_SECRET_KEY
  const baseUrl = env?.LANGFUSE_BASE_URL ?? process.env.LANGFUSE_BASE_URL
  return Boolean(publicKey && secretKey && baseUrl)
}

function resolveTracingEnvironment() {
  return (
    process.env.LANGFUSE_TRACING_ENVIRONMENT?.trim() ||
    process.env.RAILWAY_ENVIRONMENT_NAME?.trim() ||
    "default"
  )
}

function resolveTracingRelease() {
  return process.env.LANGFUSE_RELEASE?.trim() || process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || undefined
}

let sharedProvider: NodeTracerProvider | undefined
let sharedProcessor: LangfuseSpanProcessor | undefined
let providerInitFailed: string | undefined

function disabledTelemetry(warning?: string): TelemetryRun {
  return {
    enabled: false,
    warning,
    runWithRootObservation: async (fn) => fn(),
    startObservation: async () => undefined,
    updateObservation: async () => {},
    endObservation: async () => {},
    updateTrace: async () => {},
    shutdown: async () => {},
  }
}

function traceMetadata(input: { requestId: string; inputMode: "topic" | "document" }) {
  return {
    sessionId: input.requestId,
    inputMode: input.inputMode,
  }
}

type ObservationAttributes = {
  input?: unknown
  metadata?: Record<string, unknown>
}

function wrapObservation(
  observation: LangfuseObservation,
  type: TraceObservation["type"],
): TraceObservation {
  return {
    id: observation.id,
    traceId: observation.traceId,
    type,
    observation,
  }
}

function updateTypedObservation(observation: LangfuseObservation, update: ObservationEnd | undefined) {
  const attributes = {
    output: update?.output,
    metadata: update?.metadata,
    level: update?.level,
    statusMessage: update?.statusMessage,
  }

  if (observation.type === "agent") {
    ;(observation as LangfuseAgent).update({
      ...attributes,
      metadata: {
        ...update?.metadata,
        ...(update?.usageDetails ? { usageDetails: update.usageDetails } : {}),
        ...(update?.costDetails ? { costDetails: update.costDetails } : {}),
      },
    })
    return
  }

  if (observation.type === "generation") {
    ;(observation as LangfuseGeneration).update({
      ...attributes,
      model: update?.model,
      usageDetails: update?.usageDetails,
      costDetails: update?.costDetails,
    })
    return
  }

  if (observation.type === "tool") {
    ;(observation as LangfuseTool).update(attributes)
    return
  }

  if (observation.type === "chain") {
    ;(observation as LangfuseChain).update(attributes)
    return
  }

  if (observation.type === "evaluator") {
    ;(observation as LangfuseEvaluator).update(attributes)
    return
  }

  ;(observation as LangfuseSpan).update(attributes)
}

function startTypedObservation(
  parent: LangfuseObservation | undefined,
  name: string,
  type: TraceObservation["type"],
  attributes: ObservationAttributes,
) {
  if (parent) {
    if (type === "Agent") return parent.startObservation(name, attributes, { asType: "agent" })
    if (type === "Generation") return parent.startObservation(name, attributes, { asType: "generation" })
    if (type === "Tool") return parent.startObservation(name, attributes, { asType: "tool" })
    if (type === "Chain") return parent.startObservation(name, attributes, { asType: "chain" })
    if (type === "Evaluator") return parent.startObservation(name, attributes, { asType: "evaluator" })
    return parent.startObservation(name, attributes)
  }

  if (type === "Agent") return startObservation(name, attributes, { asType: "agent" })
  if (type === "Generation") return startObservation(name, attributes, { asType: "generation" })
  if (type === "Tool") return startObservation(name, attributes, { asType: "tool" })
  if (type === "Chain") return startObservation(name, attributes, { asType: "chain" })
  if (type === "Evaluator") return startObservation(name, attributes, { asType: "evaluator" })
  return startObservation(name, attributes)
}

function defaultObservationType(type: ObservationInput["type"]) {
  return type ?? "Span"
}

/**
 * Create a process-wide Langfuse OTEL provider once. Safe to call repeatedly.
 * Returns false when keys are missing or init fails.
 */
export function ensureLangfuseProvider(config?: RuntimeConfig): boolean {
  if (sharedProvider) return true
  if (providerInitFailed) return false
  if (!langfuseKeysPresent(config?.env)) return false

  const publicKey = config?.env.LANGFUSE_PUBLIC_KEY ?? process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = config?.env.LANGFUSE_SECRET_KEY ?? process.env.LANGFUSE_SECRET_KEY
  const baseUrl = config?.env.LANGFUSE_BASE_URL ?? process.env.LANGFUSE_BASE_URL
  if (!publicKey || !secretKey || !baseUrl) return false

  try {
    const release = resolveTracingRelease()
    sharedProcessor = new LangfuseSpanProcessor({
      publicKey,
      secretKey,
      baseUrl,
      environment: resolveTracingEnvironment(),
      ...(release ? { release } : {}),
      exportMode: "batched",
    })
    sharedProvider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: "research-qurom",
      }),
      spanProcessors: [sharedProcessor],
    })
    setLangfuseTracerProvider(sharedProvider)
    return true
  } catch (error) {
    providerInitFailed = error instanceof Error ? error.message : String(error)
    console.log(`[telemetry] disabled Langfuse tracing: ${providerInitFailed}`)
    sharedProvider = undefined
    sharedProcessor = undefined
    return false
  }
}

/** Flush and shut down the process-wide provider (call on SIGTERM). */
export async function shutdownLangfuseProvider() {
  const provider = sharedProvider
  const processor = sharedProcessor
  sharedProvider = undefined
  sharedProcessor = undefined
  providerInitFailed = undefined
  if (!provider) return
  try {
    await processor?.forceFlush()
    await provider.forceFlush()
    await provider.shutdown()
  } catch (error) {
    console.log(
      `[telemetry] Langfuse provider shutdown issue: ${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    setLangfuseTracerProvider(null)
  }
}

export async function createTelemetry(
  config: RuntimeConfig,
  input: {
    requestId: string
    inputMode: "topic" | "document"
    topic?: string
    documentPath?: string
  },
): Promise<TelemetryRun> {
  if (!langfuseKeysPresent(config.env)) return disabledTelemetry()
  if (!ensureLangfuseProvider(config)) {
    return disabledTelemetry(providerInitFailed ? `disabled Langfuse tracing: ${providerInitFailed}` : undefined)
  }

  let active = true
  const observationsById = new Map<string, LangfuseObservation>()
  let rootObservation: TraceObservation | undefined
  let rootObservationEnded = false
  const appliedTags = new Set<string>(["qurom", input.inputMode])

  const traceName = traceNameForInput(input)

  return {
    get enabled() {
      return active
    },
    get traceId() {
      return rootObservation?.traceId
    },
    get rootObservation() {
      return rootObservation
    },
    async runWithRootObservation(fn) {
      return startActiveObservation(
        traceName,
        async (observation) => {
          observation.update({
            input,
            metadata: traceMetadata(input),
          })

          rootObservation = wrapObservation(observation, "Span")
          observationsById.set(rootObservation.id, rootObservation.observation)

          try {
            return await propagateAttributes(
              {
                sessionId: input.requestId,
                tags: [...appliedTags],
              },
              fn,
            )
          } finally {
            if (rootObservation && !rootObservationEnded) {
              rootObservationEnded = true
              observationsById.delete(rootObservation.id)
            }
          }
        },
        { endOnExit: true },
      )
    },
    async startObservation(next) {
      if (!active) return undefined

      try {
        const attributes: ObservationAttributes = {
          input: next.input,
          metadata: {
            sessionId: input.requestId,
            ...next.metadata,
          },
        }

        const type = defaultObservationType(next.type)
        const parent = next.parentObservationId ? observationsById.get(next.parentObservationId) : undefined
        const observation = startTypedObservation(parent, next.name, type, attributes)
        const wrapped = wrapObservation(observation, type)
        observationsById.set(wrapped.id, observation)

        return wrapped
      } catch (error) {
        active = false
        const message = error instanceof Error ? error.message : String(error)
        console.log(`[telemetry] disabled Langfuse tracing: ${message}`)
        return undefined
      }
    },
    async updateObservation(observation, update) {
      if (!observation || !active) return
      try {
        updateTypedObservation(observation.observation, update)
      } catch (error) {
        active = false
        const message = error instanceof Error ? error.message : String(error)
        console.log(`[telemetry] disabled Langfuse tracing: ${message}`)
      }
    },
    async endObservation(observation, update) {
      if (!observation || !active) return

      try {
        updateTypedObservation(observation.observation, update)
        observation.observation.end()
        observationsById.delete(observation.id)
      } catch (error) {
        active = false
        const message = error instanceof Error ? error.message : String(error)
        console.log(`[telemetry] disabled Langfuse tracing: ${message}`)
      }
    },
    async updateTrace(update) {
      if (!active || !rootObservation || rootObservationEnded) return

      try {
        const currentRootObservation = rootObservation
        if (!currentRootObservation) return

        const apply = () => {
          ;(currentRootObservation.observation as LangfuseSpan).update({
            output: update.output,
            metadata: {
              ...traceMetadata(input),
              ...update.metadata,
              ...(update.tags?.length ? { tags: update.tags } : {}),
            },
          })
        }

        if (update.tags?.length) {
          for (const tag of update.tags) appliedTags.add(tag)
          await propagateAttributes(
            {
              sessionId: input.requestId,
              tags: [...appliedTags],
            },
            async () => {
              apply()
            },
          )
        } else {
          apply()
        }
      } catch (error) {
        active = false
        const message = error instanceof Error ? error.message : String(error)
        console.log(`[telemetry] disabled Langfuse tracing: ${message}`)
      }
    },
    async shutdown() {
      if (!active) return

      try {
        if (rootObservation && !rootObservationEnded) {
          rootObservation.observation.end()
          rootObservationEnded = true
        }
        observationsById.clear()
        // Flush the shared processor for this run; do not tear down the process provider.
        await sharedProcessor?.forceFlush()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.log(`[telemetry] Langfuse shutdown issue: ${message}`)
      } finally {
        active = false
      }
    },
  }
}
