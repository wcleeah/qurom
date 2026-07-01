import { createOpencodeEventBridge } from "../opencode-event-bridge"
import { abortSession, createSession, listAgents, promptAgent } from "../opencode"
import type { AgentProvider, AgentRunHandle, AgentRole, ProviderCapability } from "./types"

const capabilities = new Set<ProviderCapability>([
  "streamingEvents",
  "toolEvents",
  "permissionEvents",
  "fileAttachments",
  "providerManagedAgents",
  "jsonFileOutput",
  "plainJsonOutput",
])

function roleConfig(config: Parameters<AgentProvider["createRunHandle"]>[0]["config"], role: AgentRole) {
  return config.quorumConfig.agentRuntime.roles[role]
}

function providerAgentForRole(config: Parameters<AgentProvider["createRunHandle"]>[0]["config"], role: AgentRole) {
  return roleConfig(config, role)?.providerAgent ?? role
}

export const opencodeProvider: AgentProvider = {
  id: "opencode",
  capabilities,
  async createRunHandle(input): Promise<AgentRunHandle> {
    const session = await createSession(input.config, input.title, input.parentId)
    return {
      id: session.id,
      providerId: "opencode",
      role: input.role,
      title: input.title,
      providerAgent: providerAgentForRole(input.config, input.role),
    }
  },
  async prompt(input) {
    const roleRuntime = roleConfig(input.config, input.role)
    const providerAgent = input.handle.providerAgent ?? providerAgentForRole(input.config, input.role)
    return promptAgent({
      config: input.config,
      sessionID: input.handle.id,
      agent: providerAgent,
      prompt: input.prompt,
      schema: input.schema,
      variant: input.variant ?? roleRuntime?.variant,
      inputFiles: input.inputFiles,
      outputFile: input.outputFile,
      telemetry: input.telemetry,
    })
  },
  async abort(config, handleId) {
    await abortSession(config, handleId)
  },
  createEventBridge(input) {
    return createOpencodeEventBridge(input.config, {
      bus: input.bus,
      getRunDir: input.getRunDir,
      onStreamError: input.onStreamError,
    })
  },
  async validate(input) {
    const agents = await listAgents(input.config)
    const names = new Set(agents.map((entry) => entry.name))
    const missing = input.roles
      .map((role) => providerAgentForRole(input.config, role))
      .filter((agent) => !names.has(agent))

    if (missing.length > 0) {
      throw new Error(`Missing required OpenCode agents: ${missing.join(", ")}`)
    }

    return {
      providerId: "opencode",
      agents,
    }
  },
}
