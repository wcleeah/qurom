import type { RuntimeConfig } from "../config"
import { opencodeProvider } from "./opencode"
import type { AgentProvider, AgentProviderId, AgentRole } from "./types"

const providers: Record<string, AgentProvider> = {
  opencode: opencodeProvider,
}

export function getProvider(id: AgentProviderId): AgentProvider {
  const provider = providers[id]
  if (!provider) {
    throw new Error(`Unknown agent provider ${JSON.stringify(id)}`)
  }
  return provider
}

export function providerForRole(config: RuntimeConfig, role: AgentRole): AgentProvider {
  const roleProvider = config.quorumConfig.agentRuntime.roles[role]?.provider
  return getProvider(roleProvider ?? config.quorumConfig.agentRuntime.defaultProvider)
}

export function configuredAgentRoles(config: RuntimeConfig): AgentRole[] {
  const roles = [
    "reader-interviewer",
    config.quorumConfig.designatedDrafter,
    ...config.quorumConfig.auditors,
    config.quorumConfig.summarizerAgent,
    "json-fixer",
  ]

  if (config.quorumConfig.designQuorum?.enabled) {
    roles.push(
      config.quorumConfig.designQuorum.designatedDesigner,
      ...config.quorumConfig.designQuorum.auditors,
      "interactive-enhancer",
    )
  }

  return [...new Set(roles)]
}

export async function validateProviderPrerequisites(config: RuntimeConfig) {
  const roles = configuredAgentRoles(config)
  const rolesByProvider = new Map<AgentProvider, AgentRole[]>()

  for (const role of roles) {
    const provider = providerForRole(config, role)
    rolesByProvider.set(provider, [...(rolesByProvider.get(provider) ?? []), role])
  }

  const validations = []
  for (const [provider, providerRoles] of rolesByProvider) {
    if (!provider.validate) continue
    validations.push(await provider.validate({ config, roles: providerRoles }))
  }

  return {
    providers: validations,
  }
}
