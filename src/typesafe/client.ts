import { TypeSafeClient, type Fetch, type SystemOneRequest, type SystemOneResult } from "@typesafe-ai/sdk"

import type { RuntimeConfig } from "../config"

export function createTypeSafeClient(input: {
  apiKey: string
  fetch?: Fetch
  defaultModel?: string
}) {
  return new TypeSafeClient({
    apiKey: input.apiKey,
    fetch: input.fetch,
    defaultModel: input.defaultModel ?? "jev-latest",
    logLevel: "error",
  })
}

export type ReadabilitySystemOne = <Q extends SystemOneRequest["questions"]>(
  request: SystemOneRequest<Q>,
) => Promise<SystemOneResult<Q>>

export function systemOneFromClient(client: TypeSafeClient): ReadabilitySystemOne {
  return (request) => client.systemOne(request)
}

export function resolveReadabilitySystemOne(
  config: RuntimeConfig,
  deps?: { systemOne?: ReadabilitySystemOne },
): { systemOne?: ReadabilitySystemOne; skipReason?: "disabled" | "no_api_key" } {
  if (deps?.systemOne) return { systemOne: deps.systemOne }
  if (!config.quorumConfig.readability.enabled) return { skipReason: "disabled" }
  const apiKey = config.env.TYPESAFE_API_KEY?.trim()
  if (!apiKey) return { skipReason: "no_api_key" }
  const client = createTypeSafeClient({
    apiKey,
    defaultModel: config.quorumConfig.readability.model,
  })
  return { systemOne: systemOneFromClient(client) }
}
