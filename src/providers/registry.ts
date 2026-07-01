import type { RuntimeConfig } from "../config"
import { cursorProvider } from "./cursor"
import { opencodeProvider } from "./opencode"
import type { AgentProvider, AgentProviderId, AgentRole, ProviderConfigFormDescriptor } from "./types"

const providers: Record<string, AgentProvider> = {
  cursor: cursorProvider,
  opencode: opencodeProvider,
}

export function availableProviderIds(): string[] {
  return Object.keys(providers)
}

export function getProvider(id: AgentProviderId): AgentProvider {
  const provider = providers[id]
  if (!provider) {
    throw new Error(`Unknown agent provider ${JSON.stringify(id)}`)
  }
  return provider
}

export async function providerConfigForm(
  config: RuntimeConfig,
  id: AgentProviderId,
): Promise<ProviderConfigFormDescriptor> {
  const provider = getProvider(id)
  return provider.configForm?.({ config }) ?? {
    providerId: provider.id,
    fields: {
      providerAgent: true,
      model: "text",
      variant: true,
      outputMode: true,
    },
  }
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

export async function prepareConfiguredProviders(config: RuntimeConfig): Promise<() => Promise<void>> {
  const uniqueProviders = new Set<AgentProvider>()
  for (const role of configuredAgentRoles(config)) {
    uniqueProviders.add(providerForRole(config, role))
  }

  const cleanups: Array<() => Promise<void>> = []
  for (const provider of uniqueProviders) {
    const prepared = await provider.prepare?.({ config })
    if (prepared?.cleanup) cleanups.push(prepared.cleanup)
  }

  return async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup().catch(() => {})
    }
  }
}
