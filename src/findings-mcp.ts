import { mkdir, unlink } from "node:fs/promises"
import { join } from "node:path"
import { randomBytes } from "node:crypto"

import { FINDINGS_WORKING_FILENAME, unresolvedFindingsFilename } from "./draft-artifacts"
import { quorumDataPaths } from "./data-paths"

export const FINDINGS_MCP_PATH = "/mcp/findings"
export const FINDINGS_MCP_SERVER_NAME = "qurom-findings"
export const GET_UNRESOLVED_FINDINGS_TOOL = "get_unresolved_findings"
export const FINDINGS_MCP_TOKEN_OPTION = "findingsMcpToken"

const PROTOCOL_VERSION = "2025-03-26"
const GRANTS_DIRNAME = "findings-mcp"

export type FindingsMcpGrant = {
  token: string
  requestId: string
  outputPath: string
  dataDir: string
}

const grantsByToken = new Map<string, FindingsMcpGrant>()
const grantsByRequestId = new Map<string, FindingsMcpGrant>()

function grantsDir(dataDir: string) {
  return join(dataDir, GRANTS_DIRNAME)
}

function grantPath(dataDir: string, token: string) {
  return join(grantsDir(dataDir), token)
}

function remember(grant: FindingsMcpGrant) {
  grantsByToken.set(grant.token, grant)
  grantsByRequestId.set(grant.requestId, grant)
}

function forget(grant: FindingsMcpGrant) {
  grantsByToken.delete(grant.token)
  grantsByRequestId.delete(grant.requestId)
}

export function findingsMcpEndpointUrl(baseUrl?: string) {
  const base = (baseUrl?.trim() || process.env.QUORUM_MCP_BASE_URL?.trim() || `http://127.0.0.1:${process.env.VIEW_PORT ?? "3000"}`)
    .replace(/\/$/, "")
  return `${base}${FINDINGS_MCP_PATH}`
}

export function findingsMcpCursorServer(token: string, baseUrl?: string) {
  return {
    url: findingsMcpEndpointUrl(baseUrl),
    headers: { Authorization: `Bearer ${token}` },
  }
}

export function extractFindingsMcpToken(providerOptions: Record<string, unknown> | undefined): string | undefined {
  const token = providerOptions?.[FINDINGS_MCP_TOKEN_OPTION]
  return typeof token === "string" && token.trim() ? token.trim() : undefined
}

export async function issueFindingsMcpGrant(input: {
  requestId: string
  outputPath: string
  dataDir: string
}): Promise<string> {
  const existing = grantsByRequestId.get(input.requestId)
  if (existing) {
    existing.outputPath = input.outputPath
    existing.dataDir = input.dataDir
    await persistGrant(existing)
    return existing.token
  }

  const token = randomBytes(32).toString("base64url")
  const grant: FindingsMcpGrant = {
    token,
    requestId: input.requestId,
    outputPath: input.outputPath,
    dataDir: input.dataDir,
  }
  remember(grant)
  await persistGrant(grant)
  return token
}

export async function revokeFindingsMcpGrant(requestId: string) {
  const grant = grantsByRequestId.get(requestId)
  if (!grant) return
  forget(grant)
  await unlink(grantPath(grant.dataDir, grant.token)).catch(() => {})
}

export async function lookupFindingsMcpGrant(token: string): Promise<FindingsMcpGrant | undefined> {
  const remembered = grantsByToken.get(token)
  if (remembered) return remembered

  const dataDir = quorumDataPaths().root
  try {
    const grant = await Bun.file(grantPath(dataDir, token)).json() as FindingsMcpGrant
    if (grant?.token === token && grant.requestId && grant.outputPath) {
      remember({ ...grant, dataDir: grant.dataDir || dataDir })
      return grantsByToken.get(token)
    }
  } catch {
    // missing or invalid
  }
  return undefined
}

export function resetFindingsMcpGrantsForTests() {
  grantsByToken.clear()
  grantsByRequestId.clear()
}

async function persistGrant(grant: FindingsMcpGrant) {
  await mkdir(grantsDir(grant.dataDir), { recursive: true })
  await Bun.write(grantPath(grant.dataDir, grant.token), `${JSON.stringify(grant, null, 2)}\n`)
}

export async function readUnresolvedFindings(outputPath: string): Promise<unknown> {
  const working = Bun.file(join(outputPath, FINDINGS_WORKING_FILENAME))
  if (await working.exists()) {
    try {
      return await working.json()
    } catch {
      // fall through to round snapshots
    }
  }

  for (let round = 32; round >= 0; round--) {
    const snapshot = Bun.file(join(outputPath, unresolvedFindingsFilename(round)))
    if (!(await snapshot.exists())) continue
    try {
      return await snapshot.json()
    } catch {
      continue
    }
  }
  return []
}

function bearerToken(req: Request): string | undefined {
  const header = req.headers.get("authorization")
  if (!header) return undefined
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || undefined
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }
}

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result }
}

const TOOLS = [
  {
    name: GET_UNRESOLVED_FINDINGS_TOOL,
    description:
      "Return the current unresolved revision findings for this writing session. Call this if the conversation was compacted or the findings are not in view. Do not guess findings.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
]

async function handleJsonRpc(message: unknown, grant: FindingsMcpGrant): Promise<unknown | undefined> {
  if (!message || typeof message !== "object") {
    return jsonRpcError(null, -32600, "Invalid request")
  }
  const body = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
  const id = "id" in body ? body.id : undefined
  const method = typeof body.method === "string" ? body.method : ""
  const isNotification = !("id" in body)

  if (method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: FINDINGS_MCP_SERVER_NAME, version: "0.1.0" },
    })
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return isNotification ? undefined : jsonRpcResult(id, {})
  }
  if (method === "ping") {
    return jsonRpcResult(id, {})
  }
  if (method === "tools/list") {
    return jsonRpcResult(id, { tools: TOOLS })
  }
  if (method === "tools/call") {
    const params = body.params && typeof body.params === "object" ? body.params as { name?: unknown } : {}
    const name = typeof params.name === "string" ? params.name : ""
    if (name !== GET_UNRESOLVED_FINDINGS_TOOL) {
      return jsonRpcResult(id, {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      })
    }
    const findings = await readUnresolvedFindings(grant.outputPath)
    return jsonRpcResult(id, {
      content: [{ type: "text", text: JSON.stringify(findings, null, 2) }],
    })
  }
  if (isNotification) return undefined
  return jsonRpcError(id, -32601, `Method not found: ${method}`)
}

function encodeJsonRpc(payload: unknown, accept: string | null): Response {
  const body = JSON.stringify(payload)
  const preferSse = Boolean(accept?.includes("text/event-stream") && !accept.includes("application/json"))
  if (preferSse) {
    return new Response(`event: message\ndata: ${body}\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" },
    })
  }
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}

export async function handleFindingsMcpHttp(req: Request, path: string): Promise<Response | undefined> {
  if (path !== FINDINGS_MCP_PATH && !path.startsWith("/mcp/")) return undefined
  if (path !== FINDINGS_MCP_PATH) return new Response("Not found", { status: 404 })
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { Allow: "POST, GET, OPTIONS" } })
  }
  if (req.method === "GET") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } })
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } })
  }

  const token = bearerToken(req)
  if (!token) return new Response("Unauthorized", { status: 401 })
  const grant = await lookupFindingsMcpGrant(token)
  if (!grant) return new Response("Unauthorized", { status: 401 })

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return encodeJsonRpc(jsonRpcError(null, -32700, "Parse error"), req.headers.get("accept"))
  }

  const accept = req.headers.get("accept")
  if (Array.isArray(payload)) {
    const results = []
    for (const message of payload) {
      const result = await handleJsonRpc(message, grant)
      if (result !== undefined) results.push(result)
    }
    return encodeJsonRpc(results, accept)
  }

  const result = await handleJsonRpc(payload, grant)
  if (result === undefined) return new Response(null, { status: 202 })
  return encodeJsonRpc(result, accept)
}
