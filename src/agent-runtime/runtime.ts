import type { z } from "zod"

import type { RuntimeConfig } from "../config"
import type { EventBus } from "../runner"
import { providerForRole } from "../providers/registry"
import type {
  AgentProvider,
  AgentRole,
  AgentRunHandle,
  ProviderPromptInput,
  ProviderPromptResult,
} from "../providers/types"
import type { PromptFileInput } from "../opencode"

export type RuntimePromptInput<T> = {
  role: AgentRole
  handle: AgentRunHandle
  prompt: string
  schema?: z.ZodType<T>
  variant?: string
  inputFiles?: PromptFileInput[]
  outputFile?: string
  telemetry?: ProviderPromptInput<T>["telemetry"]
}

export type AgentRuntime = {
  createHandle: (role: AgentRole, title: string, parentId?: string) => Promise<AgentRunHandle>
  prompt: <T>(input: RuntimePromptInput<T>) => Promise<ProviderPromptResult<T>>
  abort: (handle: AgentRunHandle) => Promise<void>
  providerForRole: (role: AgentRole) => AgentProvider
}

export function createAgentRuntime(
  config: RuntimeConfig,
  bus?: EventBus,
  options: { providerForRole?: (role: AgentRole) => AgentProvider } = {},
): AgentRuntime {
  void bus

  function resolveProvider(role: AgentRole) {
    return options.providerForRole?.(role) ?? providerForRole(config, role)
  }

  return {
    async createHandle(role, title, parentId) {
      const provider = resolveProvider(role)
      const handle = await provider.createRunHandle({ config, role, title, parentId })
      if (!provider.capabilities.has("streamingEvents")) {
        bus?.emit({ kind: "session.created", sessionID: handle.id, role })
      }
      return handle
    },
    async prompt(input) {
      const provider = resolveProvider(input.role)
      if (!provider.capabilities.has("streamingEvents")) {
        bus?.emit({ kind: "session.status", sessionID: input.handle.id, status: "running" })
      }
      try {
        const result = await provider.prompt({
          config,
          handle: input.handle,
          role: input.role,
          prompt: input.prompt,
          schema: input.schema,
          variant: input.variant,
          inputFiles: input.inputFiles,
          outputFile: input.outputFile,
          structuredOutput: input.schema ? { preferred: ["json_file", "plain_json"] } : undefined,
          telemetry: input.telemetry,
        })
        if (!provider.capabilities.has("streamingEvents")) {
          bus?.emit({ kind: "session.status", sessionID: input.handle.id, status: "completed" })
        }
        return result
      } catch (error) {
        if (!provider.capabilities.has("streamingEvents")) {
          bus?.emit({
            kind: "session.error",
            sessionID: input.handle.id,
            name: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message : String(error),
          })
          bus?.emit({ kind: "session.status", sessionID: input.handle.id, status: "error" })
        }
        throw error
      } finally {
        await input.handle.dispose?.()
      }
    },
    async abort(handle) {
      const provider = resolveProvider(handle.role)
      await provider.abort?.(config, handle.id)
    },
    providerForRole: resolveProvider,
  }
}
