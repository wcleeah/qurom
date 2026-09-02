import {
  Agent,
  AgentBusyError,
  Cursor,
  CursorAgentError,
  CursorSdkError,
  type CloudAgentOptions,
  type SettingSource,
} from "@cursor/sdk"
import { toJsonSchema } from "@langchain/core/utils/json_schema"
import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { basename, dirname } from "node:path"

import { runProviderStructuredPrompt } from "../agent-runtime/provider-structured-output"
import { awaitCursorRunCompletion } from "./cursor-run-wait"
import type { RuntimeConfig } from "../config"
import type { EventBus } from "../runner"
import { estimateCursorCostUsd, resolveCursorPricingModelId } from "../cursor-pricing"
import { foldCursorUsage, hasUsage, type UsageTotals } from "../usage"
import { toCostDetails, toUsageDetails, type TraceObservation } from "../telemetry"
import { toCursorMcpServers } from "../mcp-config"
import type {
  AgentProvider,
  AgentRunHandle,
  AgentRole,
  ProviderCapability,
  ProviderConfigFormDescriptor,
  ProviderConfigFormParameter,
} from "./types"

const capabilities = new Set<ProviderCapability>(["inlineInputContext", "fileOutput", "jsonFileOutput", "plainTextOutput"])

type CursorAgentHandle = Awaited<ReturnType<typeof Agent.create>>
type CursorRunHandle = Awaited<ReturnType<CursorAgentHandle["send"]>>
type CursorModel = Awaited<ReturnType<typeof Cursor.models.list>>[number]

const activeAgents = new Map<string, {
  agent: CursorAgentHandle
  run?: CursorRunHandle
  requestedModel?: string
  modelParams?: Array<{ id: string; value: string }>
}>()
let cachedModels: { apiKey: string; models: CursorModel[] } | undefined
const cursorTransportRetryAttempts = 2
const cursorAgentNameMaxLength = 100

export function clampCursorAgentName(name: string): string {
  if (name.length <= cursorAgentNameMaxLength) return name
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 8)
  const prefixLength = cursorAgentNameMaxLength - hash.length - 1
  return `${name.slice(0, prefixLength)}-${hash}`
}

class CursorRunStatusError extends Error {
  constructor(
    readonly runId: string,
    readonly status: string,
    readonly result: unknown,
  ) {
    super(`Cursor run ${runId} ended with status ${status}: ${stringifyForError(result)}`)
    this.name = "CursorRunStatusError"
  }
}

function roleConfig(config: RuntimeConfig, role: AgentRole) {
  return config.roleBindings[role]
}

function cursorApiKey(config: RuntimeConfig) {
  return config.env.CURSOR_API_KEY ?? process.env.CURSOR_API_KEY
}

function cursorModelForRole(config: RuntimeConfig, role: AgentRole) {
  const model = roleConfig(config, role)?.model
  if (!model) {
    throw new Error(`Cursor provider requires roleBindings[${JSON.stringify(role)}].model`)
  }
  return model
}

function cursorOptionsForRole(config: RuntimeConfig, role: AgentRole) {
  return roleConfig(config, role)?.options as
    | {
        runtime?: "local" | "cloud"
        settingSources?: string[]
        modelParams?: Array<{ id: string; value: string }>
        cloud?: CloudAgentOptions
      }
    | undefined
}

function modelVariantParams(model: CursorModel): Array<{ id: string; value: string }> {
  const record = model as unknown as Record<string, unknown>
  const variants = Array.isArray(record.variants) ? variantsFromRecord(record.variants) : []
  const defaultVariant = variants.find((variant) => variant.isDefault) ?? variants[0]
  return defaultVariant?.params ?? []
}

function variantsFromRecord(variants: unknown[]): Array<{ isDefault?: boolean; params: Array<{ id: string; value: string }> }> {
  return variants.flatMap((variant) => {
    if (!variant || typeof variant !== "object") return []
    const record = variant as Record<string, unknown>
    const rawParams = Array.isArray(record.params) ? record.params : []
    const params = rawParams.flatMap((param) => {
      if (!param || typeof param !== "object") return []
      const item = param as Record<string, unknown>
      return typeof item.id === "string" && typeof item.value === "string"
        ? [{ id: item.id, value: item.value }]
        : []
    })
    return params.length > 0 ? [{ isDefault: record.isDefault === true, params }] : []
  })
}

function cursorModelParamsForRole(config: RuntimeConfig, role: AgentRole, model: CursorModel | undefined) {
  const params = cursorOptionsForRole(config, role)?.modelParams
  const saved = Array.isArray(params)
    ? params
      .filter((entry) => entry && typeof entry.id === "string" && typeof entry.value === "string")
      .map((entry) => ({ id: entry.id, value: entry.value }))
    : []
  const defaults = model ? modelVariantParams(model) : []
  const allowed = new Set(model ? cursorParameters(model).map((parameter) => parameter.id) : [])
  const merged = new Map(defaults.map((entry) => [entry.id, entry.value]))
  for (const entry of saved) {
    if (allowed.size === 0 || allowed.has(entry.id)) merged.set(entry.id, entry.value)
  }
  const valid = [...merged.entries()].map(([id, value]) => ({ id, value }))
  return valid.length > 0 ? valid : undefined
}

async function listCursorModels(apiKey: string, requiredModelId?: string) {
  if (
    cachedModels?.apiKey === apiKey
    && (!requiredModelId || cachedModels.models.some((model) => model.id === requiredModelId))
  ) {
    return cachedModels.models
  }
  const models = await Cursor.models.list({ apiKey })
  cachedModels = { apiKey, models }
  return models
}

function modelLabel(model: CursorModel) {
  const record = model as unknown as Record<string, unknown>
  return String(record.name ?? record.displayName ?? record.id)
}

function cursorParameters(model: CursorModel): ProviderConfigFormParameter[] {
  const record = model as unknown as Record<string, unknown>
  const parameters = Array.isArray(record.parameters) ? record.parameters : []
  return parameters.flatMap((parameter) => {
    if (!parameter || typeof parameter !== "object") return []
    const p = parameter as Record<string, unknown>
    const id = typeof p.id === "string" ? p.id : undefined
    if (!id) return []
    const values = Array.isArray(p.values) ? p.values : []
    return [{
      id,
      label: String(p.displayName ?? p.name ?? id),
      values: values.flatMap((value) => {
        if (typeof value === "string") return [{ value, label: value }]
        if (!value || typeof value !== "object") return []
        const v = value as Record<string, unknown>
        const raw = v.value
        if (typeof raw !== "string") return []
        return [{ value: raw, label: String(v.displayName ?? v.name ?? raw) }]
      }),
    }]
  })
}

async function disposeAgent(handleId: string) {
  const active = activeAgents.get(handleId)
  if (!active) return
  activeAgents.delete(handleId)
  const disposable = active.agent as CursorAgentHandle & {
    [Symbol.asyncDispose]?: () => Promise<void>
    close?: () => Promise<void>
  }
  if (disposable[Symbol.asyncDispose]) {
    await disposable[Symbol.asyncDispose]()
  } else if (disposable.close) {
    await disposable.close()
  }
}

function extractRunText(result: unknown) {
  if (typeof result === "string") return result
  if (!result || typeof result !== "object") return ""
  const record = result as Record<string, unknown>
  if (typeof record.result === "string") return record.result
  if (typeof record.text === "string") return record.text
  return ""
}

function stringifyForError(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isCursorTransportError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("NGHTTP2_") || message.includes("ConnectError") || message.includes("Stream closed")
}

function shouldRetryCursorPrompt(error: unknown) {
  if (error instanceof CursorRunStatusError) return error.status.toLowerCase() === "error"
  return error instanceof CursorSdkError
    ? error.isRetryable || isCursorTransportError(error)
    : isCursorTransportError(error)
}

async function cancelCursorRun(run: CursorRunHandle | undefined) {
  if (!run?.supports("cancel")) return
  try {
    await run.cancel()
  } catch {
    // Best-effort: a failed cancel should not mask the original prompt error.
  }
}

async function completeCursorRun(input: {
  run: CursorRunHandle
  config: RuntimeConfig
  handleId: string
  debugLog?: { write: (type: string, data?: Record<string, unknown>) => void }
}) {
  const apiKey = cursorApiKey(input.config)
  if (!apiKey) throw new Error("Cursor provider requires CURSOR_API_KEY")
  return awaitCursorRunCompletion({
    run: input.run,
    apiKey,
    agentId: input.run.agentId,
    isCloudAgent: input.handleId.startsWith("bc-"),
    debugLog: input.debugLog,
  })
}

async function sendCursorRun(input: {
  active: { agent: CursorAgentHandle; run?: CursorRunHandle }
  prompt: string
  onDelta?: (args: { update: unknown }) => void
}): Promise<CursorRunHandle> {
  try {
    const run = await input.active.agent.send(input.prompt, {
      onDelta: input.onDelta,
    })
    input.active.run = run
    return run
  } catch (error) {
    if (error instanceof AgentBusyError && input.active.run) {
      return input.active.run
    }
    throw error
  }
}

function logCursorPromptComplete(input: {
  debugLog?: { write: (type: string, data?: Record<string, unknown>) => void }
  role: AgentRole
  handleId: string
  runId: string
  callIndex: number
  requestedModel?: string
  modelParams?: Array<{ id: string; value: string }>
  resolvedModel?: string
  durationMs?: number
}) {
  const { debugLog, ...data } = input
  debugLog?.write("cursor.prompt.complete", data)
}

function logCursorPromptError(input: {
  debugLog?: { write: (type: string, data?: Record<string, unknown>) => void }
  role: AgentRole
  handleId: string
  attempt: number
  willRetry: boolean
  error: unknown
}) {
  const { debugLog, role, handleId, attempt, willRetry, error } = input
  if (!debugLog) return

  debugLog.write("cursor.prompt.error", {
    role,
    agentId: handleId,
    attempt,
    willRetry,
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : String(error),
    retryable: error instanceof CursorSdkError ? error.isRetryable : shouldRetryCursorPrompt(error),
    runId: error instanceof CursorRunStatusError ? error.runId : undefined,
    status: error instanceof CursorRunStatusError ? error.status : undefined,
    result: error instanceof CursorRunStatusError ? error.result : undefined,
  })
}

function cursorRuntimeOptions(
  config: RuntimeConfig,
  options: ReturnType<typeof cursorOptionsForRole>,
): { local: { cwd: string; settingSources: SettingSource[] } } | { cloud: CloudAgentOptions } {
  if (options?.runtime === "local") {
    return {
      local: {
        cwd: config.env.QUORUM_WORKSPACE_DIRECTORY,
        settingSources: (options.settingSources ?? []) as SettingSource[],
      },
    }
  }

  return {
    // Omitting repos creates a cloud agent with an empty workspace, which is
    // enough for quorum roles that operate on prompt text and explicit files.
    cloud: options?.cloud ?? {},
  }
}

function cursorErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return String(error)
  if (!(error instanceof CursorSdkError)) return error.message

  const details = [
    error.code ? `code=${error.code}` : undefined,
    error.status ? `status=${error.status}` : undefined,
    error.requestId ? `requestId=${error.requestId}` : undefined,
    error.isRetryable ? "retryable=true" : undefined,
  ].filter(Boolean)
  return details.length > 0 ? `${error.message} (${details.join(", ")})` : error.message
}

function cursorToolName(toolCall: unknown) {
  if (!toolCall || typeof toolCall !== "object") return "tool"
  const record = toolCall as Record<string, unknown>
  return String(record.name ?? record.type ?? "tool")
}

function cursorArtifactPath(outputFile: string) {
  return basename(outputFile)
}

function cursorArtifactMatchesPath(actual: string, expected: string) {
  return actual === expected || actual.endsWith(`/${expected}`)
}

function safeJson(value: unknown) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return item.toString()
    if (item instanceof Error) {
      return {
        name: item.name,
        message: item.message,
        stack: item.stack,
      }
    }
    return item
  }, 2)
}

function safeDebugSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "cursor"
}

async function writeJsonFile(path: string, data: unknown) {
  await writeFile(path, safeJson(data) + "\n", "utf8")
}

async function saveCursorDebugFiles(input: {
  outputFile: string
  role: AgentRole
  agentId: string
  runId: string
  callIndex: number
  attempt: number
  result: unknown
  text: string
  artifacts?: unknown
  conversation?: unknown
  requestedModel?: string
  modelParams?: Array<{ id: string; value: string }>
  resolvedModel?: string
  completedAt?: string
}) {
  await mkdir(dirname(input.outputFile), { recursive: true })
  const runSegment = safeDebugSegment(input.runId)
  const roleSegment = safeDebugSegment(input.role)
  const base = `${dirname(input.outputFile)}/cursor-${roleSegment}-call-${input.callIndex}-attempt-${input.attempt}-${runSegment}`
  const metadata = {
    agentId: input.agentId,
    runId: input.runId,
    role: input.role,
    callIndex: input.callIndex,
    attempt: input.attempt,
    outputFile: input.outputFile,
    requestedArtifact: cursorArtifactPath(input.outputFile),
    requestedModel: input.requestedModel,
    modelParams: input.modelParams,
    resolvedModel: input.resolvedModel,
    completedAt: input.completedAt,
  }

  const paths = {
    metadata: `${base}-metadata.json`,
    result: `${base}-result.json`,
    response: `${base}-response.txt`,
    artifacts: `${base}-artifacts.json`,
    conversation: input.conversation === undefined ? undefined : `${base}-conversation.json`,
  }

  await writeJsonFile(paths.metadata, metadata)
  await writeJsonFile(paths.result, input.result)
  await writeFile(paths.response, input.text, "utf8")
  await writeJsonFile(paths.artifacts, input.artifacts ?? [])
  if (paths.conversation) {
    await writeJsonFile(paths.conversation, input.conversation)
  }

  return paths
}

async function downloadCursorArtifact(input: {
  agent: CursorAgentHandle
  handle: AgentRunHandle
  outputFile: string
  artifacts?: Awaited<ReturnType<CursorAgentHandle["listArtifacts"]>>
  artifactsFile?: string
}) {
  if (!input.handle.id.startsWith("bc-")) {
    throw new Error("Cursor local agents do not support artifact download; use Cursor cloud for file output")
  }

  const artifactPath = cursorArtifactPath(input.outputFile)
  const artifacts = input.artifacts ?? await input.agent.listArtifacts()
  const found = artifacts.find((artifact) => cursorArtifactMatchesPath(artifact.path, artifactPath))
  if (!found) {
    const available = artifacts.map((artifact) => artifact.path).join(", ") || "(none)"
    const diagnostic = input.artifactsFile ? `; artifact list saved to ${input.artifactsFile}` : ""
    throw new Error(`Cursor cloud agent did not produce required artifact ${artifactPath}; available artifacts: ${available}${diagnostic}`)
  }

  const buffer = await input.agent.downloadArtifact(found.path)
  await mkdir(dirname(input.outputFile), { recursive: true })
  await writeFile(input.outputFile, buffer)
}

function cursorRawUsageFromRun(run: CursorRunHandle, result: unknown) {
  const raw = (run as { usage?: Record<string, number> }).usage
    ?? (result as { usage?: Record<string, number> })?.usage
  if (!raw) return undefined
  return {
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    cacheReadTokens: raw.cacheReadTokens,
    cacheWriteTokens: raw.cacheWriteTokens,
  }
}

function cursorUsageTotalsFromRun(
  run: CursorRunHandle,
  result: unknown,
  model: string | undefined,
): UsageTotals | undefined {
  const raw = cursorRawUsageFromRun(run, result)
  const folded = raw ? foldCursorUsage(raw) : undefined
  if (!folded || !hasUsage(folded)) return undefined
  const cost = raw ? estimateCursorCostUsd(resolveCursorPricingModelId(model), raw) : { costUsd: 0, costAvailable: false, costEstimated: true }
  return {
    tokensIn: folded.tokensIn,
    tokensOut: folded.tokensOut,
    ...(cost.costAvailable
      ? { costUsd: cost.costUsd, costAvailable: true, costEstimated: cost.costEstimated }
      : {}),
  }
}

function cursorResolvedModel(result: unknown, requestedModel: string | undefined) {
  const resultModel = (result as { model?: { id?: string } })?.model?.id
  if (resultModel && resultModel !== "default") return resultModel
  if (!requestedModel || requestedModel === "default") return "auto"
  return requestedModel
}

function emitCursorSessionTelemetry(input: {
  bus?: EventBus
  role: AgentRole
  handleId: string
  roleRuntime: ReturnType<typeof roleConfig> | undefined
  modelParams?: Array<{ id: string; value: string }>
  runId: string
  callIndex: number
  durationMs?: number
  result: unknown
  usage?: UsageTotals
}) {
  if (!input.bus) return
  input.bus.emit({
    kind: "session.telemetry",
    sessionID: input.handleId,
    role: input.role,
    provider: "cursor",
    phase: "completed",
    requestedModel: input.roleRuntime?.model,
    modelParams: input.modelParams,
    variant: input.roleRuntime?.variant,
    cursorRunId: input.runId,
    callIndex: input.callIndex,
    durationMs: input.durationMs,
    completedAt: Date.now(),
    resolvedModel: cursorResolvedModel(input.result, input.roleRuntime?.model),
    usage: input.usage,
    usageSource: input.usage ? "sdk" : undefined,
  })
}

function emitCursorRunUsage(
  bus: EventBus | undefined,
  sessionID: string,
  run: CursorRunHandle,
  result: unknown,
  model: string | undefined,
) {
  if (!bus) return
  const raw = cursorRawUsageFromRun(run, result)
  const folded = raw ? foldCursorUsage(raw) : undefined
  if (!folded || !hasUsage(folded)) return
  const cost = raw ? estimateCursorCostUsd(resolveCursorPricingModelId(model), raw) : { costUsd: 0, costAvailable: false, costEstimated: true }
  bus.emit({
    kind: "agent.usage",
    sessionID,
    runID: run.id,
    tokensIn: folded.tokensIn,
    tokensOut: folded.tokensOut,
    source: "cursor",
    cumulative: true,
    ...(cost.costAvailable
      ? { costUsd: cost.costUsd, costAvailable: true, costEstimated: true }
      : {}),
  })
}

function emitCursorDelta(input: {
  event: unknown
  providerInput: Parameters<AgentProvider["prompt"]>[0]
  messageID: string
}) {
  const { event, providerInput, messageID } = input
  if (!providerInput.bus || !event || typeof event !== "object") return
  const update = event as Record<string, unknown>
  const type = update.type
  const sessionID = providerInput.handle.id

  if (type === "thinking-delta" && typeof update.text === "string") {
    providerInput.bus.emit({
      kind: "agent.reasoning",
      sessionID,
      key: "cursor-thinking",
      text: update.text,
      done: false,
    })
    return
  }

  if (type === "thinking-completed") {
    providerInput.bus.emit({
      kind: "agent.reasoning",
      sessionID,
      key: "cursor-thinking",
      text: "",
      done: true,
    })
    return
  }

  if (type === "text-delta" && typeof update.text === "string") {
    providerInput.bus.emit({
      kind: "agent.message.text",
      sessionID,
      key: "cursor-text",
      text: update.text,
      done: false,
    })
    return
  }

  if (type === "tool-call-started" && typeof update.callId === "string") {
    const toolCall = update.toolCall
    providerInput.bus.emit({
      kind: "agent.tool",
      tool: cursorToolName(toolCall),
      status: "running",
      callID: update.callId,
      sessionID,
      messageID,
      partID: update.callId,
      input: toolCall,
    })
    return
  }

  if (type === "tool-call-completed" && typeof update.callId === "string") {
    const toolCall = update.toolCall as Record<string, unknown> | undefined
    const result = toolCall && typeof toolCall === "object" ? toolCall.result : undefined
    const isError = typeof result === "object" && result !== null && (result as Record<string, unknown>).status === "error"
    providerInput.bus.emit({
      kind: "agent.tool",
      tool: cursorToolName(toolCall),
      status: isError ? "error" : "completed",
      callID: update.callId,
      sessionID,
      messageID,
      partID: update.callId,
      output: result,
      error: isError ? stringifyForError(result) : undefined,
    })
  }
}

type CursorPromptTelemetry = NonNullable<Parameters<AgentProvider["prompt"]>[0]["telemetry"]>

async function startCursorAgentObservation(
  telemetry: CursorPromptTelemetry | undefined,
  input: { handleId: string; role: AgentRole; name: string; promptPreview: string },
): Promise<TraceObservation | undefined> {
  const run = telemetry?.run
  if (!run?.traceId || !run.rootObservation) return undefined
  const observation = await run.startObservation({
    traceId: run.traceId,
    parentObservationId: telemetry?.parentObservation?.id ?? run.rootObservation.id,
    name: input.name,
    type: "Agent",
    input: {
      agentName: input.role,
      sessionId: input.handleId,
      promptPreview: input.promptPreview.slice(0, 500),
    },
    metadata: {
      agentName: input.role,
      sessionId: input.handleId,
      provider: "cursor",
    },
  })
  telemetry?.trackSessionObservation?.(input.handleId, observation)
  return observation
}

async function startCursorGenerationObservation(
  telemetry: CursorPromptTelemetry | undefined,
  input: {
    handleId: string
    agent: TraceObservation | undefined
    name: string
    model?: string
    promptPreview: string
  },
): Promise<TraceObservation | undefined> {
  const run = telemetry?.run
  if (!run?.traceId || !input.agent) return undefined
  const observation = await run.startObservation({
    traceId: run.traceId,
    parentObservationId: input.agent.id,
    name: input.name,
    type: "Generation",
    input: {
      promptPreview: input.promptPreview.slice(0, 500),
      model: input.model,
    },
    metadata: {
      sessionId: input.handleId,
      provider: "cursor",
      model: input.model,
    },
  })
  telemetry?.trackGenerationObservation?.(input.handleId, observation)
  return observation
}

async function endCursorGenerationObservation(
  telemetry: CursorPromptTelemetry | undefined,
  handleId: string,
  generation: TraceObservation | undefined,
  update: {
    usage?: UsageTotals
    model?: string
    output?: unknown
    level?: "ERROR"
    statusMessage?: string
  },
) {
  await telemetry?.run.endObservation(generation, {
    output: update.output,
    model: update.model,
    usageDetails: toUsageDetails(update.usage),
    costDetails: toCostDetails(update.usage),
    level: update.level,
    statusMessage: update.statusMessage,
    metadata: {
      sessionId: handleId,
      provider: "cursor",
      model: update.model,
    },
  })
  telemetry?.trackGenerationObservation?.(handleId, undefined)
}

async function endCursorAgentObservation(
  telemetry: CursorPromptTelemetry | undefined,
  agent: TraceObservation | undefined,
  update: {
    usage?: UsageTotals
    model?: string
    output?: unknown
    level?: "ERROR"
    statusMessage?: string
  },
) {
  await telemetry?.run.endObservation(agent, {
    output: update.output,
    usageDetails: toUsageDetails(update.usage),
    costDetails: toCostDetails(update.usage),
    level: update.level,
    statusMessage: update.statusMessage,
    metadata: {
      provider: "cursor",
      model: update.model,
    },
  })
}

export const cursorProvider: AgentProvider = {
  id: "cursor",
  capabilities,
  outputInstructions(input) {
    const name = basename(input.outputFile)
    if (input.schema) {
      const schema = JSON.stringify(toJsonSchema(input.schema), null, 2)
      return [
        "## Output instructions",
        `Write the downloadable Cursor Cloud artifact to \`/opt/cursor/artifacts/${name}\`.`,
        `The artifact must be named exactly \`${name}\`.`,
        "The artifact content must be exactly one JSON object matching this schema:",
        schema,
        "Respond with only `OK` after the artifact is created.",
        "Do not include the JSON in your response.",
      ].join("\n")
    }
    return [
      "## Output instructions",
      `Write the downloadable Cursor Cloud artifact to \`/opt/cursor/artifacts/${name}\`.`,
      `The artifact must be named exactly \`${name}\`.`,
      "Write the complete output content into that downloadable artifact.",
      "Respond with only `OK` after the artifact is created.",
      "Do not include the output content in your response.",
    ].join("\n")
  },
  async createRunHandle(input): Promise<AgentRunHandle> {
    const apiKey = cursorApiKey(input.config)
    if (!apiKey) throw new Error("Cursor provider requires CURSOR_API_KEY")

    const model = cursorModelForRole(input.config, input.role)
    const options = cursorOptionsForRole(input.config, input.role)
    const catalogModel = (await listCursorModels(apiKey, model)).find((entry) => entry.id === model)
    const modelParams = cursorModelParamsForRole(input.config, input.role, catalogModel)
    const mcpServers = toCursorMcpServers(input.config.mcpRegistry, input.config.env)
    const agent = await Agent.create({
      apiKey,
      name: clampCursorAgentName(input.title),
      model: {
        id: model,
        ...(modelParams?.length ? { params: modelParams } : {}),
      },
      ...cursorRuntimeOptions(input.config, options),
      ...(mcpServers ? { mcpServers } : {}),
    })
    const agentId = agent.agentId
    activeAgents.set(agentId, { agent, requestedModel: model, modelParams })
    return {
      id: agentId,
      providerId: "cursor",
      role: input.role,
      title: input.title,
      providerAgent: input.config.roleBindings[input.role]?.providerAgent,
      sessionBootstrap: {
        requestedModel: model,
        modelParams,
        variant: input.config.roleBindings[input.role]?.variant,
      },
      dispose: () => disposeAgent(agentId),
    }
  },
  async resumeRunHandle(input): Promise<AgentRunHandle> {
    const apiKey = cursorApiKey(input.config)
    if (!apiKey) throw new Error("Cursor provider requires CURSOR_API_KEY")

    const existing = activeAgents.get(input.handleId)
    if (existing) {
      return {
        id: input.handleId,
        providerId: "cursor",
        role: input.role,
        title: input.title,
        providerAgent: input.config.roleBindings[input.role]?.providerAgent,
        sessionBootstrap: {
          requestedModel: existing.requestedModel,
          modelParams: existing.modelParams,
          variant: input.config.roleBindings[input.role]?.variant,
        },
        dispose: () => disposeAgent(input.handleId),
      }
    }

    const model = cursorModelForRole(input.config, input.role)
    const options = cursorOptionsForRole(input.config, input.role)
    const catalogModel = (await listCursorModels(apiKey, model)).find((entry) => entry.id === model)
    const modelParams = cursorModelParamsForRole(input.config, input.role, catalogModel)
    const mcpServers = toCursorMcpServers(input.config.mcpRegistry, input.config.env)
    // Inline MCP servers are not persisted across resume; pass them again.
    const agent = await Agent.resume(input.handleId, {
      apiKey,
      ...cursorRuntimeOptions(input.config, options),
      ...(mcpServers ? { mcpServers } : {}),
    })
    const agentId = agent.agentId || input.handleId
    activeAgents.set(agentId, { agent, requestedModel: model, modelParams })
    return {
      id: agentId,
      providerId: "cursor",
      role: input.role,
      title: input.title,
      providerAgent: input.config.roleBindings[input.role]?.providerAgent,
      sessionBootstrap: {
        requestedModel: model,
        modelParams,
        variant: input.config.roleBindings[input.role]?.variant,
      },
      dispose: () => disposeAgent(agentId),
    }
  },
  async prompt(input) {
    const active = activeAgents.get(input.handle.id)
    if (!active) {
      throw new Error(`Cursor agent handle ${input.handle.id} is not active`)
    }

    const roleRuntime = roleConfig(input.config, input.role)
    const telemetryName = input.telemetry?.name ?? `cursor.${input.role}`
    const agentObservation = await startCursorAgentObservation(input.telemetry, {
      handleId: input.handle.id,
      role: input.role,
      name: telemetryName,
      promptPreview: input.prompt,
    })

    if (!input.outputFile && !input.schema) {
      if (input.inputFiles && input.inputFiles.length > 0) {
        throw new Error("Cursor provider expects input files to be inlined by the agent runtime")
      }
      for (let attempt = 1; attempt <= cursorTransportRetryAttempts; attempt++) {
        const generationObservation = await startCursorGenerationObservation(input.telemetry, {
          handleId: input.handle.id,
          agent: agentObservation,
          name: `${telemetryName}.generation`,
          model: roleRuntime?.model,
          promptPreview: input.prompt,
        })
        try {
          const messageID = `cursor:${input.handle.id}:${attempt}:${Date.now()}`
          input.bus?.emit({ kind: "agent.message.start", sessionID: input.handle.id, messageID })
          input.bus?.emit({ kind: "session.status", sessionID: input.handle.id, status: "running" })
          const run = await sendCursorRun({
            active,
            prompt: input.prompt,
            onDelta: ({ update }) => emitCursorDelta({ event: update, providerInput: input, messageID }),
          })
          const { result } = await completeCursorRun({
            run,
            config: input.config,
            handleId: input.handle.id,
            debugLog: input.telemetry?.debugLog,
          })
          const status = result.status
          const text = extractRunText(result)
          if (status && status !== "finished") {
            throw new CursorRunStatusError(run.id, status, result)
          }
          const usage = cursorUsageTotalsFromRun(run, result, roleRuntime?.model)
          emitCursorRunUsage(input.bus, input.handle.id, run, result, roleRuntime?.model)
          const resolvedModel = cursorResolvedModel(result, roleRuntime?.model)
          const durationMs = result.durationMs
          emitCursorSessionTelemetry({
            bus: input.bus,
            role: input.role,
            handleId: input.handle.id,
            roleRuntime,
            modelParams: active.modelParams,
            runId: run.id,
            callIndex: 1,
            durationMs,
            result,
            usage,
          })
          logCursorPromptComplete({
            debugLog: input.telemetry?.debugLog,
            role: input.role,
            handleId: input.handle.id,
            runId: run.id,
            callIndex: 1,
            requestedModel: active.requestedModel,
            modelParams: active.modelParams,
            resolvedModel,
            durationMs,
          })
          input.bus?.emit({
            kind: "agent.message.text",
            sessionID: input.handle.id,
            key: "cursor-text",
            text: "",
            done: true,
          })
          input.bus?.emit({ kind: "session.status", sessionID: input.handle.id, status: "completed" })
          await endCursorGenerationObservation(input.telemetry, input.handle.id, generationObservation, {
            usage,
            model: resolvedModel ?? roleRuntime?.model,
            output: { response: text, runId: run.id },
          })
          await endCursorAgentObservation(input.telemetry, agentObservation, {
            usage,
            model: resolvedModel ?? roleRuntime?.model,
            output: { response: text, runId: run.id },
          })
          return {
            text,
            model: roleRuntime?.model,
            provider: "cursor",
            variant: input.variant ?? roleRuntime?.variant,
            raw: { agentId: input.handle.id, runId: run.id, result },
          }
        } catch (error) {
          const willRetry = attempt < cursorTransportRetryAttempts && shouldRetryCursorPrompt(error)
          logCursorPromptError({
            debugLog: input.telemetry?.debugLog,
            role: input.role,
            handleId: input.handle.id,
            attempt,
            willRetry,
            error,
          })
          await endCursorGenerationObservation(input.telemetry, input.handle.id, generationObservation, {
            level: "ERROR",
            statusMessage: error instanceof Error ? error.message : String(error),
            model: roleRuntime?.model,
          })
          if (willRetry) {
            await cancelCursorRun(active.run)
            continue
          }
          await endCursorAgentObservation(input.telemetry, agentObservation, {
            level: "ERROR",
            statusMessage: error instanceof Error ? error.message : String(error),
            model: roleRuntime?.model,
          })
          input.bus?.emit({
            kind: "session.error",
            sessionID: input.handle.id,
            name: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message : String(error),
          })
          input.bus?.emit({ kind: "session.status", sessionID: input.handle.id, status: "error" })
          if (error instanceof CursorAgentError) {
            throw new Error(`Cursor agent prompt failed: ${cursorErrorMessage(error)}`)
          }
          throw error
        }
      }
      await endCursorAgentObservation(input.telemetry, agentObservation, {
        level: "ERROR",
        statusMessage: "Cursor agent chat prompt failed after retry budget was exhausted",
        model: roleRuntime?.model,
      })
      throw new Error("Cursor agent chat prompt failed after retry budget was exhausted")
    }

    if (!input.outputFile) {
      throw new Error("Cursor provider requires outputFile for structured prompts")
    }
    if (input.inputFiles && input.inputFiles.length > 0) {
      throw new Error("Cursor provider does not yet support file attachments in quorum prompts")
    }
    const outputFile = input.outputFile

    let callIndex = 0
    let lastUsage: UsageTotals | undefined
    let lastModel: string | undefined

    try {
      const result = await runProviderStructuredPrompt({
        prompt: input.prompt,
        providerOutputFile: input.outputFile,
        schema: input.schema,
        artifactFile: input.outputFile,
        async sendPrompt(prompt) {
          callIndex += 1
          const currentCallIndex = callIndex
          for (let attempt = 1; attempt <= cursorTransportRetryAttempts; attempt++) {
            const generationObservation = await startCursorGenerationObservation(input.telemetry, {
              handleId: input.handle.id,
              agent: agentObservation,
              name: `${telemetryName}.generation`,
              model: roleRuntime?.model,
              promptPreview: prompt,
            })
            try {
              const messageID = `cursor:${input.handle.id}:${attempt}:${Date.now()}`
              input.bus?.emit({ kind: "agent.message.start", sessionID: input.handle.id, messageID })
              const run = await sendCursorRun({
                active,
                prompt,
                onDelta: ({ update }) => emitCursorDelta({ event: update, providerInput: input, messageID }),
              })
              const { result } = await completeCursorRun({
                run,
                config: input.config,
                handleId: input.handle.id,
                debugLog: input.telemetry?.debugLog,
              })
              const status = result.status
              const text = extractRunText(result)
              let artifacts: Awaited<ReturnType<CursorAgentHandle["listArtifacts"]>> = []
              let artifactsPayload: unknown = artifacts
              try {
                artifacts = await active.agent.listArtifacts()
                artifactsPayload = artifacts
              } catch (error) {
                artifactsPayload = { error: cursorErrorMessage(error) }
              }
              let conversation: unknown
              if (run.supports("conversation")) {
                try {
                  conversation = await run.conversation()
                } catch (error) {
                  conversation = { error: cursorErrorMessage(error) }
                }
              }
              const resolvedModel = cursorResolvedModel(result, roleRuntime?.model)
              const durationMs = result.durationMs
              const completedAt = new Date().toISOString()
              const debugPaths = await saveCursorDebugFiles({
                outputFile,
                role: input.role,
                agentId: input.handle.id,
                runId: run.id,
                callIndex: currentCallIndex,
                attempt,
                result,
                text,
                artifacts: artifactsPayload,
                conversation,
                requestedModel: active.requestedModel,
                modelParams: active.modelParams,
                resolvedModel,
                completedAt,
              })
              if (status && status !== "finished") {
                throw new CursorRunStatusError(run.id, status, result)
              }
              const usage = cursorUsageTotalsFromRun(run, result, roleRuntime?.model)
              lastUsage = usage
              lastModel = resolvedModel ?? roleRuntime?.model
              emitCursorRunUsage(input.bus, input.handle.id, run, result, roleRuntime?.model)
              emitCursorSessionTelemetry({
                bus: input.bus,
                role: input.role,
                handleId: input.handle.id,
                roleRuntime,
                modelParams: active.modelParams,
                runId: run.id,
                callIndex: currentCallIndex,
                durationMs,
                result,
                usage,
              })
              logCursorPromptComplete({
                debugLog: input.telemetry?.debugLog,
                role: input.role,
                handleId: input.handle.id,
                runId: run.id,
                callIndex: currentCallIndex,
                requestedModel: active.requestedModel,
                modelParams: active.modelParams,
                resolvedModel,
                durationMs,
              })
              await downloadCursorArtifact({
                agent: active.agent,
                handle: input.handle,
                outputFile,
                artifacts,
                artifactsFile: debugPaths.artifacts,
              })
              await endCursorGenerationObservation(input.telemetry, input.handle.id, generationObservation, {
                usage,
                model: lastModel,
                output: { response: text, runId: run.id, callIndex: currentCallIndex },
              })
              return {
                text,
                model: roleRuntime?.model,
                provider: "cursor",
                variant: input.variant ?? roleRuntime?.variant,
                raw: { agentId: input.handle.id, runId: run.id, result },
              }
            } catch (error) {
              const willRetry = attempt < cursorTransportRetryAttempts && shouldRetryCursorPrompt(error)
              logCursorPromptError({
                debugLog: input.telemetry?.debugLog,
                role: input.role,
                handleId: input.handle.id,
                attempt,
                willRetry,
                error,
              })
              await endCursorGenerationObservation(input.telemetry, input.handle.id, generationObservation, {
                level: "ERROR",
                statusMessage: error instanceof Error ? error.message : String(error),
                model: roleRuntime?.model,
              })
              if (willRetry) {
                await cancelCursorRun(active.run)
                continue
              }
              if (error instanceof CursorAgentError) {
                throw new Error(`Cursor agent prompt failed: ${cursorErrorMessage(error)}`)
              }
              throw error
            }
          }
          throw new Error("Cursor agent prompt failed after retry budget was exhausted")
        },
      })
      await endCursorAgentObservation(input.telemetry, agentObservation, {
        usage: lastUsage,
        model: lastModel ?? roleRuntime?.model,
        output: {
          structured: Boolean(result.structured),
          outputSource: result.outputSource,
        },
      })
      return result
    } catch (error) {
      await endCursorAgentObservation(input.telemetry, agentObservation, {
        level: "ERROR",
        statusMessage: error instanceof Error ? error.message : String(error),
        model: lastModel ?? roleRuntime?.model,
        usage: lastUsage,
      })
      throw error
    }
  },
  async abort(_config, handleId) {
    const active = activeAgents.get(handleId)
    if (active?.run?.supports("cancel")) {
      await active.run.cancel()
    }
    await disposeAgent(handleId)
  },
  async validate(input) {
    const apiKey = cursorApiKey(input.config)
    if (!apiKey) throw new Error("Cursor provider requires CURSOR_API_KEY")

    const missingModels = input.roles.filter((role) => !roleConfig(input.config, role)?.model)
    if (missingModels.length > 0) {
      throw new Error(`Cursor roles require per-role model values: ${missingModels.join(", ")}`)
    }
    toCursorMcpServers(input.config.mcpRegistry, input.config.env)

    const warnings: string[] = []
    try {
      await Cursor.models.list({ apiKey })
    } catch (error) {
      warnings.push(`Could not verify Cursor model access: ${error instanceof Error ? error.message : String(error)}`)
    }

    return {
      providerId: "cursor",
      warnings,
    }
  },
  async configForm(input): Promise<ProviderConfigFormDescriptor> {
    const apiKey = cursorApiKey(input.config)
    if (!apiKey) {
      return {
        providerId: "cursor",
        warnings: ["CURSOR_API_KEY is not set; enter a model id manually or configure the key to load available models."],
        fields: { providerAgent: false, model: "text", variant: false, outputMode: false },
      }
    }

    try {
      const models = await listCursorModels(apiKey)
      return {
        providerId: "cursor",
        modelOptions: models.map((model) => ({ id: model.id, label: modelLabel(model) })),
        parametersByModel: Object.fromEntries(models.map((model) => [model.id, cursorParameters(model)])),
        fields: { providerAgent: false, model: "select", variant: false, outputMode: false },
      }
    } catch (error) {
      return {
        providerId: "cursor",
        warnings: [`Could not load Cursor models: ${error instanceof Error ? error.message : String(error)}`],
        fields: { providerAgent: false, model: "text", variant: false, outputMode: false },
      }
    }
  },
}
