import {
  Agent,
  Cursor,
  CursorAgentError,
  CursorSdkError,
  type CloudAgentOptions,
  type McpServerConfig,
  type SettingSource,
} from "@cursor/sdk"
import { toJsonSchema } from "@langchain/core/utils/json_schema"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"

import { runProviderStructuredPrompt } from "../agent-runtime/provider-structured-output"
import { browserQaMcpServer, type RuntimeConfig } from "../config"
import type {
  AgentProvider,
  AgentRunHandle,
  AgentRole,
  ProviderCapability,
  ProviderConfigFormDescriptor,
  ProviderConfigFormParameter,
} from "./types"

const capabilities = new Set<ProviderCapability>(["roleInstructions", "inlineInputContext", "fileOutput", "jsonFileOutput"])

type CursorAgentHandle = Awaited<ReturnType<typeof Agent.create>>
type CursorRunHandle = Awaited<ReturnType<CursorAgentHandle["send"]>>
type CursorModel = Awaited<ReturnType<typeof Cursor.models.list>>[number]

const activeAgents = new Map<string, { agent: CursorAgentHandle; run?: CursorRunHandle }>()
let cachedModels: { apiKey: string; models: CursorModel[] } | undefined
const cursorTransportRetryAttempts = 2

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
  return config.quorumConfig.agentRuntime.roles[role]
}

function cursorApiKey(config: RuntimeConfig) {
  return config.env.CURSOR_API_KEY ?? process.env.CURSOR_API_KEY
}

function cursorModelForRole(config: RuntimeConfig, role: AgentRole) {
  const model = roleConfig(config, role)?.model
  if (!model) {
    throw new Error(`Cursor provider requires agentRuntime.roles[${JSON.stringify(role)}].model`)
  }
  return model
}

function cursorOptionsForRole(config: RuntimeConfig, role: AgentRole) {
  return roleConfig(config, role)?.options as
    | {
        runtime?: "local" | "cloud"
        settingSources?: string[]
        mcpServers?: Record<string, McpServerConfig>
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
  const merged = new Map((model ? modelVariantParams(model) : []).map((entry) => [entry.id, entry.value]))
  for (const entry of saved) {
    merged.set(entry.id, entry.value)
  }
  const valid = [...merged.entries()].map(([id, value]) => ({ id, value }))
  return valid.length > 0 ? valid : undefined
}

async function loadCursorMcpServers(): Promise<Record<string, McpServerConfig>> {
  const path = process.env.CURSOR_MCP_CONFIG_PATH || join(homedir(), ".cursor", "mcp.json")
  try {
    const raw = await readFile(path, "utf8")
    const parsed = JSON.parse(raw) as { mcpServers?: unknown }
    if (!parsed.mcpServers || typeof parsed.mcpServers !== "object" || Array.isArray(parsed.mcpServers)) {
      return {}
    }
    return parsed.mcpServers as Record<string, McpServerConfig>
  } catch {
    return {}
  }
}

function interpolateEnvString(value: string, env: RuntimeConfig["env"]) {
  const runtimeEnv = env as Record<string, string | undefined>
  return value.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}|\$\{ENV:([A-Za-z_][A-Za-z0-9_]*)\}|\{env:([A-Za-z_][A-Za-z0-9_]*)\}|\{ENV:([A-Za-z_][A-Za-z0-9_]*)\}|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, shellLowerEnvName: string | undefined, shellUpperEnvName: string | undefined, lowerEnvName: string | undefined, upperEnvName: string | undefined, shellName: string | undefined) => {
    const envName = shellLowerEnvName ?? shellUpperEnvName ?? lowerEnvName ?? upperEnvName
    const name = envName ?? shellName
    if (!name) return _match
    const resolved = runtimeEnv[name] ?? process.env[name]
    if (resolved === undefined) {
      throw new Error(`Cursor MCP config references missing environment variable ${name}`)
    }
    return resolved
  })
}

export function interpolateMcpConfigEnv<T>(value: T, env: RuntimeConfig["env"]): T {
  if (typeof value === "string") {
    return interpolateEnvString(value, env) as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateMcpConfigEnv(item, env)) as T
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolateMcpConfigEnv(item, env)]),
    ) as T
  }
  return value
}

async function resolveMcpServers(
  config: RuntimeConfig,
  role: AgentRole,
  options: ReturnType<typeof cursorOptionsForRole>,
): Promise<Record<string, McpServerConfig> | undefined> {
  const configured = await loadCursorMcpServers()
  const preferred = role === "browser-qa-enhancer"
    ? [browserQaMcpServer(config)].filter((name): name is string => Boolean(name))
    : config.quorumConfig.researchTools.prefer
  const selected = Object.fromEntries(
    preferred
      .filter((name) => configured[name])
      .map((name) => [name, configured[name]!]),
  ) as Record<string, McpServerConfig>
  const merged = { ...selected, ...(options?.mcpServers ?? {}) }
  return Object.keys(merged).length > 0 ? interpolateMcpConfigEnv(merged, config.env) : undefined
}

async function listCursorModels(apiKey: string) {
  if (cachedModels?.apiKey === apiKey) return cachedModels.models
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

export const cursorProvider: AgentProvider = {
  id: "cursor",
  capabilities,
  outputInstructions(input) {
    const name = basename(input.outputFile)
    if (input.schema) {
      const schema = JSON.stringify(toJsonSchema(input.schema), null, 2)
      return [
        "## Output instructions",
        `Create a downloadable Cursor Cloud artifact named \`${name}\` using the correct Cursor Cloud artifact location.`,
        "The artifact content must be exactly one JSON object matching this schema:",
        schema,
        "Respond with only `OK` after the artifact is created.",
        "Do not include the JSON in your response.",
      ].join("\n")
    }
    return [
      "## Output instructions",
      `Create a downloadable Cursor Cloud artifact named \`${name}\` using the correct Cursor Cloud artifact location.`,
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
    const catalogModel = (await listCursorModels(apiKey)).find((entry) => entry.id === model)
    const modelParams = cursorModelParamsForRole(input.config, input.role, catalogModel)
    const mcpServers = await resolveMcpServers(input.config, input.role, options)
    const agent = await Agent.create({
      apiKey,
      name: input.title,
      model: {
        id: model,
        ...(modelParams?.length ? { params: modelParams } : {}),
      },
      ...cursorRuntimeOptions(input.config, options),
      ...(mcpServers ? { mcpServers } : {}),
    })
    const agentId = agent.agentId
    activeAgents.set(agentId, { agent })
    return {
      id: agentId,
      providerId: "cursor",
      role: input.role,
      title: input.title,
      providerAgent: input.config.quorumConfig.agentRuntime.roles[input.role]?.providerAgent,
      dispose: () => disposeAgent(agentId),
    }
  },
  async prompt(input) {
    if (!input.outputFile) {
      throw new Error("Cursor provider requires outputFile; inline output is disabled")
    }
    if (input.inputFiles && input.inputFiles.length > 0) {
      throw new Error("Cursor provider does not yet support file attachments in quorum prompts")
    }
    const outputFile = input.outputFile

    const active = activeAgents.get(input.handle.id)
    if (!active) {
      throw new Error(`Cursor agent handle ${input.handle.id} is not active`)
    }

    const roleRuntime = roleConfig(input.config, input.role)
    let callIndex = 0

    return runProviderStructuredPrompt({
      prompt: input.prompt,
      providerOutputFile: input.outputFile,
      schema: input.schema,
      artifactFile: input.outputFile,
      async sendPrompt(prompt) {
        callIndex += 1
        const currentCallIndex = callIndex
        for (let attempt = 1; attempt <= cursorTransportRetryAttempts; attempt++) {
          try {
            const messageID = `cursor:${input.handle.id}:${attempt}:${Date.now()}`
            input.bus?.emit({ kind: "agent.message.start", sessionID: input.handle.id, messageID })
            const run = await active.agent.send(prompt, {
              onDelta: ({ update }) => emitCursorDelta({ event: update, providerInput: input, messageID }),
            })
            active.run = run
            const result = await run.wait()
            const status = (result as { status?: string }).status
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
            })
            if (status && status !== "finished" && status !== "completed") {
              throw new CursorRunStatusError(run.id, status, result)
            }
            await downloadCursorArtifact({
              agent: active.agent,
              handle: input.handle,
              outputFile,
              artifacts,
              artifactsFile: debugPaths.artifacts,
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
            if (willRetry) {
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
