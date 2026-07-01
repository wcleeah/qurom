import { Agent, Cursor, CursorAgentError, type McpServerConfig, type SettingSource } from "@cursor/sdk"

import { runProviderStructuredPrompt } from "../agent-runtime/provider-structured-output"
import type { RuntimeConfig } from "../config"
import type {
  AgentProvider,
  AgentRunHandle,
  AgentRole,
  ProviderCapability,
  ProviderConfigFormDescriptor,
  ProviderConfigFormParameter,
} from "./types"

const capabilities = new Set<ProviderCapability>(["plainJsonOutput"])

type CursorAgentHandle = Awaited<ReturnType<typeof Agent.create>>
type CursorRunHandle = Awaited<ReturnType<CursorAgentHandle["send"]>>
type CursorModel = Awaited<ReturnType<typeof Cursor.models.list>>[number]

const activeAgents = new Map<string, { agent: CursorAgentHandle; run?: CursorRunHandle }>()
let cachedModels: { apiKey: string; models: CursorModel[] } | undefined

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
        settingSources?: string[]
        mcpServers?: Record<string, McpServerConfig>
        modelParams?: Array<{ id: string; value: string }>
      }
    | undefined
}

function cursorModelParamsForRole(config: RuntimeConfig, role: AgentRole) {
  const params = cursorOptionsForRole(config, role)?.modelParams
  if (!Array.isArray(params)) return undefined
  const valid = params
    .filter((entry) => entry && typeof entry.id === "string" && typeof entry.value === "string")
    .map((entry) => ({ id: entry.id, value: entry.value }))
  return valid.length > 0 ? valid : undefined
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

export const cursorProvider: AgentProvider = {
  id: "cursor",
  capabilities,
  async createRunHandle(input): Promise<AgentRunHandle> {
    const apiKey = cursorApiKey(input.config)
    if (!apiKey) throw new Error("Cursor provider requires CURSOR_API_KEY")

    const model = cursorModelForRole(input.config, input.role)
    const options = cursorOptionsForRole(input.config, input.role)
    const modelParams = cursorModelParamsForRole(input.config, input.role)
    const agent = await Agent.create({
      apiKey,
      name: input.title,
      model: {
        id: model,
        ...(modelParams?.length ? { params: modelParams } : {}),
      },
      local: {
        cwd: input.config.env.QUORUM_WORKSPACE_DIRECTORY,
        settingSources: (options?.settingSources ?? []) as SettingSource[],
      },
      ...(options?.mcpServers ? { mcpServers: options.mcpServers } : {}),
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
    if (input.inputFiles && input.inputFiles.length > 0) {
      throw new Error("Cursor provider does not yet support file attachments in quorum prompts")
    }

    const active = activeAgents.get(input.handle.id)
    if (!active) {
      throw new Error(`Cursor agent handle ${input.handle.id} is not active`)
    }

    const roleRuntime = roleConfig(input.config, input.role)
    const providerAgent = input.handle.providerAgent ?? roleRuntime?.providerAgent ?? input.role
    const promptPrefix = [
      `You are acting as the quorum role: ${input.role}.`,
      providerAgent !== input.role ? `Provider role label: ${providerAgent}.` : undefined,
      roleRuntime?.variant ? `Role variant: ${roleRuntime.variant}.` : undefined,
    ].filter(Boolean).join("\n")

    return runProviderStructuredPrompt({
      prompt: `${promptPrefix}\n\n${input.prompt}`,
      schema: input.schema,
      outputFile: input.outputFile,
      async sendPrompt(prompt) {
        try {
          const run = await active.agent.send(prompt)
          active.run = run
          const result = await run.wait()
          const status = (result as { status?: string }).status
          if (status && status !== "finished" && status !== "completed") {
            throw new Error(`Cursor run ${run.id} ended with status ${status}`)
          }
          return {
            text: extractRunText(result),
            model: roleRuntime?.model,
            provider: "cursor",
            variant: input.variant ?? roleRuntime?.variant,
            raw: { agentId: input.handle.id, runId: run.id, result },
          }
        } catch (error) {
          if (error instanceof CursorAgentError) {
            throw new Error(`Cursor agent startup failed: ${error.message}`)
          }
          throw error
        }
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
