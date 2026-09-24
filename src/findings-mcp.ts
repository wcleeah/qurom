import { mkdir, readdir, unlink } from "node:fs/promises"
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

export async function lookupFindingsMcpGrantByRequestId(
  requestId: string,
  dataDir?: string,
): Promise<FindingsMcpGrant | undefined> {
  const remembered = grantsByRequestId.get(requestId)
  if (remembered) return remembered

  const root = dataDir ?? quorumDataPaths().root
  let names: string[]
  try {
    names = await readdir(grantsDir(root))
  } catch {
    return undefined
  }
  for (const name of names) {
    try {
      const grant = await Bun.file(grantPath(root, name)).json() as FindingsMcpGrant
      if (grant?.requestId === requestId && typeof grant.token === "string" && grant.outputPath) {
        remember({ ...grant, dataDir: grant.dataDir || root })
        return grantsByToken.get(grant.token)
      }
    } catch {
      // skip invalid grant files
    }
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

export type UnresolvedFindingsSource = {
  findings: unknown
  sourceFile: string
  round: number | null
}

async function latestUnresolvedRound(outputPath: string): Promise<number | null> {
  for (let round = 32; round >= 0; round--) {
    if (await Bun.file(join(outputPath, unresolvedFindingsFilename(round))).exists()) return round
  }
  return null
}

export async function inspectUnresolvedFindings(outputPath: string): Promise<UnresolvedFindingsSource> {
  const working = Bun.file(join(outputPath, FINDINGS_WORKING_FILENAME))
  if (await working.exists()) {
    try {
      return {
        findings: await working.json(),
        sourceFile: FINDINGS_WORKING_FILENAME,
        round: await latestUnresolvedRound(outputPath),
      }
    } catch {
      // fall through to round snapshots
    }
  }

  for (let round = 32; round >= 0; round--) {
    const filename = unresolvedFindingsFilename(round)
    const snapshot = Bun.file(join(outputPath, filename))
    if (!(await snapshot.exists())) continue
    try {
      return {
        findings: await snapshot.json(),
        sourceFile: filename,
        round,
      }
    } catch {
      continue
    }
  }
  return { findings: [], sourceFile: "none", round: null }
}

export async function readUnresolvedFindings(outputPath: string): Promise<unknown> {
  return (await inspectUnresolvedFindings(outputPath)).findings
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

export async function invokeFindingsMcp(token: string, message: unknown): Promise<{ status: number; json: unknown }> {
  const response = await handleFindingsMcpHttp(new Request(`http://127.0.0.1${FINDINGS_MCP_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(message),
  }), FINDINGS_MCP_PATH)
  if (!response) return { status: 500, json: { error: "Findings MCP did not handle the request" } }
  const text = await response.text()
  let json: unknown = null
  if (text.trim()) {
    try {
      json = JSON.parse(text)
    } catch {
      json = { error: text }
    }
  }
  return { status: response.status, json }
}

export type FindingsMcpGrantSource = "live-session" | "issued-for-check"

export type FindingsMcpCheckResult = {
  ok: boolean
  error?: string
  endpoint: string
  grantSource: FindingsMcpGrantSource
  protocol: {
    initialize: boolean
    toolsList: boolean
    toolsCall: boolean
  }
  advertised: {
    reachable: boolean | null
    error?: string
  }
  originNote?: string
  round: number | null
  sourceFile: string
  findingCount: number
  findings: unknown
  diskFindings?: unknown
  findingsMatch: boolean
}

function jsonEqual(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function findingCount(findings: unknown) {
  return Array.isArray(findings) ? findings.length : findings == null ? 0 : 1
}

function parseToolFindings(payload: unknown): { findings?: unknown; error?: string } {
  if (!payload || typeof payload !== "object") return { error: "Empty MCP response" }
  const body = payload as {
    error?: { message?: string }
    result?: { isError?: boolean; content?: Array<{ text?: string }> }
  }
  if (body.error?.message) return { error: body.error.message }
  const text = body.result?.content?.[0]?.text
  if (typeof text !== "string") return { error: "MCP tool returned no text" }
  if (body.result?.isError) return { error: text }
  try {
    return { findings: JSON.parse(text) }
  } catch {
    return { error: "MCP tool returned non-JSON text" }
  }
}

export function advertisedOriginNote(endpoint: string, requestOrigin?: string): string | undefined {
  let advertised: URL
  try {
    advertised = new URL(endpoint)
  } catch {
    return undefined
  }
  const advertisedLoopback = advertised.hostname === "127.0.0.1" || advertised.hostname === "localhost"
  if (!requestOrigin) {
    if (advertisedLoopback) {
      return "This process advertises a loopback MCP URL. Cursor cloud needs QUORUM_MCP_BASE_URL set to this dashboard's public origin."
    }
    return undefined
  }
  let origin: URL
  try {
    origin = new URL(requestOrigin)
  } catch {
    return undefined
  }
  if (advertised.origin !== origin.origin) {
    return `Advertised MCP origin (${advertised.origin}) differs from this dashboard (${origin.origin}). Set QUORUM_MCP_BASE_URL to ${origin.origin} so Cursor cloud hits this process.`
  }
  return undefined
}

function shouldProbeAdvertised(endpoint: string) {
  try {
    const url = new URL(endpoint)
    return url.hostname !== "127.0.0.1" && url.hostname !== "localhost"
  } catch {
    return false
  }
}

async function probeAdvertisedFindingsMcp(
  token: string,
  endpoint: string,
): Promise<{ reachable: boolean; error?: string }> {
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "qurom-dashboard", version: "0.1.0" },
        },
      }),
      signal: AbortSignal.timeout(4000),
    })
    if (!resp.ok) return { reachable: false, error: `HTTP ${resp.status}` }
    const json = await resp.json() as { result?: { serverInfo?: { name?: string } } }
    if (json?.result?.serverInfo?.name !== FINDINGS_MCP_SERVER_NAME) {
      return { reachable: false, error: "Unexpected MCP server info" }
    }
    return { reachable: true }
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function checkFindingsMcpForRun(input: {
  requestId: string
  outputPath: string
  dataDir: string
  requestOrigin?: string
  probeAdvertised?: boolean
}): Promise<FindingsMcpCheckResult> {
  const expected = await inspectUnresolvedFindings(input.outputPath)
  const existing = await lookupFindingsMcpGrantByRequestId(input.requestId, input.dataDir)
  const grantSource: FindingsMcpGrantSource = existing ? "live-session" : "issued-for-check"
  const token = await issueFindingsMcpGrant({
    requestId: input.requestId,
    outputPath: input.outputPath,
    dataDir: input.dataDir,
  })
  const endpoint = findingsMcpEndpointUrl()
  const originNote = advertisedOriginNote(endpoint, input.requestOrigin)

  const protocol = { initialize: false, toolsList: false, toolsCall: false }
  let findings: unknown = expected.findings
  let error: string | undefined
  let findingsMatch = false
  let advertised: FindingsMcpCheckResult["advertised"] = { reachable: null }

  try {
    const init = await invokeFindingsMcp(token, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "qurom-dashboard", version: "0.1.0" },
      },
    })
    protocol.initialize = init.status === 200
      && Boolean((init.json as { result?: { serverInfo?: { name?: string } } })?.result?.serverInfo?.name === FINDINGS_MCP_SERVER_NAME)
    if (!protocol.initialize) {
      error = init.status === 401 ? "Unauthorized — findings MCP grant was rejected" : "initialize failed"
    }

    const listed = await invokeFindingsMcp(token, { jsonrpc: "2.0", id: 2, method: "tools/list" })
    const toolNames = ((listed.json as { result?: { tools?: Array<{ name?: string }> } })?.result?.tools ?? [])
      .map((tool) => tool.name)
    protocol.toolsList = listed.status === 200 && toolNames.includes(GET_UNRESOLVED_FINDINGS_TOOL)
    if (protocol.initialize && !protocol.toolsList) {
      error = "tools/list did not include get_unresolved_findings"
    }

    const called = await invokeFindingsMcp(token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: GET_UNRESOLVED_FINDINGS_TOOL, arguments: {} },
    })
    const parsed = parseToolFindings(called.json)
    protocol.toolsCall = called.status === 200 && parsed.findings !== undefined
    if (parsed.error && !error) error = parsed.error
    if (parsed.findings !== undefined) findings = parsed.findings
    findingsMatch = protocol.toolsCall && jsonEqual(findings, expected.findings)
    if (protocol.toolsCall && !findingsMatch && !error) {
      error = "MCP payload does not match on-disk round findings"
    }

    const probeAdvertised = input.probeAdvertised ?? shouldProbeAdvertised(endpoint)
    advertised = probeAdvertised
      ? await probeAdvertisedFindingsMcp(token, endpoint)
      : { reachable: null }
  } finally {
    if (grantSource === "issued-for-check") {
      await revokeFindingsMcpGrant(input.requestId)
    }
  }

  const ok = protocol.initialize && protocol.toolsList && protocol.toolsCall && findingsMatch
  return {
    ok,
    error: ok ? undefined : error,
    endpoint,
    grantSource,
    protocol,
    advertised,
    originNote,
    round: expected.round,
    sourceFile: expected.sourceFile,
    findingCount: findingCount(findings),
    findings,
    diskFindings: findingsMatch ? undefined : expected.findings,
    findingsMatch,
  }
}
