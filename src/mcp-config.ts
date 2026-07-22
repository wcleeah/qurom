import type { McpServerConfig as CursorMcpServerConfig } from "@cursor/sdk"
import type { Config as OpenCodeConfig } from "@opencode-ai/sdk"
import { z } from "zod"

const nameSchema = z.string().trim().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use letters, numbers, dots, underscores, or hyphens")
const stringMap = z.record(z.string())
const oauthSchema = z.object({
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  scopes: z.array(z.string().min(1)).optional(),
}).strict()

const localSchema = z.object({
  name: nameSchema,
  type: z.literal("local"),
  command: z.string().trim().min(1),
  args: z.array(z.string()).default([]),
  env: stringMap.default({}),
  cwd: z.string().trim().min(1).optional(),
}).strict()

const remoteSchema = z.object({
  name: nameSchema,
  type: z.literal("remote"),
  url: z.string().url(),
  headers: stringMap.default({}),
  oauth: z.union([oauthSchema, z.literal(false)]).optional(),
}).strict()

export const mcpServerSchema = z.discriminatedUnion("type", [localSchema, remoteSchema])
export type McpServer = z.infer<typeof mcpServerSchema>
export type McpRegistry = { servers: McpServer[]; enabled: string[] }

export function validateMcpRegistry(input: McpRegistry): McpRegistry {
  const servers = input.servers.map((server) => mcpServerSchema.parse(server))
  const names = new Set<string>()
  for (const server of servers) {
    if (names.has(server.name)) throw new Error(`Duplicate MCP server name ${JSON.stringify(server.name)}`)
    names.add(server.name)
  }
  const enabled = [...new Set(input.enabled)]
  for (const name of enabled) {
    if (!names.has(name)) throw new Error(`Enabled MCP server ${JSON.stringify(name)} does not exist`)
  }
  return { servers, enabled }
}

function interpolateString(value: string, env: Record<string, string | undefined>) {
  return value.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}|\$\{ENV:([A-Za-z_][A-Za-z0-9_]*)\}|\{env:([A-Za-z_][A-Za-z0-9_]*)\}|\{ENV:([A-Za-z_][A-Za-z0-9_]*)\}|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_match, a: string | undefined, b: string | undefined, c: string | undefined, d: string | undefined, e: string | undefined) => {
      const name = a ?? b ?? c ?? d ?? e
      const resolved = name ? env[name] ?? process.env[name] : undefined
      if (resolved === undefined) throw new Error(`MCP config references missing environment variable ${name}`)
      return resolved
    })
}

export function interpolateMcpEnv<T>(value: T, env: Record<string, string | undefined>): T {
  if (typeof value === "string") return interpolateString(value, env) as T
  if (Array.isArray(value)) return value.map((item) => interpolateMcpEnv(item, env)) as T
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolateMcpEnv(item, env)])) as T
  }
  return value
}

function enabledServers(registry: McpRegistry, env: Record<string, string | undefined>) {
  const enabled = new Set(registry.enabled)
  return registry.servers.filter((server) => enabled.has(server.name)).map((server) => interpolateMcpEnv(server, env))
}

export function toCursorMcpServers(registry: McpRegistry, env: Record<string, string | undefined>): Record<string, CursorMcpServerConfig> | undefined {
  const entries = enabledServers(validateMcpRegistry(registry), env).map((server): [string, CursorMcpServerConfig] => {
    if (server.type === "local") {
      return [server.name, {
        command: server.command,
        ...(server.args.length ? { args: server.args } : {}),
        ...(Object.keys(server.env).length ? { env: server.env } : {}),
        ...(server.cwd ? { cwd: server.cwd } : {}),
      }]
    }
    const auth = server.oauth && typeof server.oauth === "object" && server.oauth.clientId
      ? {
          CLIENT_ID: server.oauth.clientId,
          ...(server.oauth.clientSecret ? { CLIENT_SECRET: server.oauth.clientSecret } : {}),
          ...(server.oauth.scopes?.length ? { scopes: server.oauth.scopes } : {}),
        }
      : undefined
    return [server.name, {
      url: server.url,
      ...(Object.keys(server.headers).length ? { headers: server.headers } : {}),
      ...(auth ? { auth } : {}),
    }]
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}

export function toOpenCodeMcp(registry: McpRegistry, env: Record<string, string | undefined>): NonNullable<OpenCodeConfig["mcp"]> {
  return Object.fromEntries(enabledServers(validateMcpRegistry(registry), env).map((server) => {
    if (server.type === "local") {
      return [server.name, {
        type: "local" as const,
        command: [server.command, ...server.args],
        ...(Object.keys(server.env).length ? { environment: server.env } : {}),
        enabled: true,
      }]
    }
    const oauth = server.oauth === false
      ? false
      : server.oauth
        ? {
            clientId: server.oauth.clientId,
            clientSecret: server.oauth.clientSecret,
            scope: server.oauth.scopes?.join(" "),
          }
        : undefined
    return [server.name, {
      type: "remote" as const,
      url: server.url,
      ...(Object.keys(server.headers).length ? { headers: server.headers } : {}),
      ...(oauth !== undefined ? { oauth } : {}),
      enabled: true,
    }]
  }))
}
