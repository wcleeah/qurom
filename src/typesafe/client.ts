import { TypeSafeClient, type Fetch, type SystemOneRequest, type SystemOneResult } from "@typesafe-ai/sdk"

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
