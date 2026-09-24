import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  FINDINGS_MCP_PATH,
  GET_UNRESOLVED_FINDINGS_TOOL,
  handleFindingsMcpHttp,
  issueFindingsMcpGrant,
  resetFindingsMcpGrantsForTests,
  revokeFindingsMcpGrant,
} from "../src/findings-mcp"

describe("findings MCP", () => {
  afterEach(() => {
    resetFindingsMcpGrantsForTests()
  })

  async function withDir<T>(fn: (dir: string) => Promise<T>) {
    const dir = await mkdtemp(join(tmpdir(), "qurom-findings-mcp-"))
    try {
      return await fn(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  function rpc(token: string, body: unknown) {
    return handleFindingsMcpHttp(new Request(`http://127.0.0.1${FINDINGS_MCP_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }), FINDINGS_MCP_PATH)
  }

  test("rejects unknown /mcp paths and missing tokens", async () => {
    const missing = await handleFindingsMcpHttp(
      new Request("http://127.0.0.1/mcp/findings", { method: "POST", body: "{}" }),
      FINDINGS_MCP_PATH,
    )
    expect(missing?.status).toBe(401)

    const unknown = await handleFindingsMcpHttp(
      new Request("http://127.0.0.1/mcp/other", { method: "POST", body: "{}" }),
      "/mcp/other",
    )
    expect(unknown?.status).toBe(404)
  })

  test("returns current unresolved findings for a valid session token", async () => {
    await withDir(async (dir) => {
      const dataDir = join(dir, "data")
      const token = await issueFindingsMcpGrant({
        requestId: "req-1",
        outputPath: dir,
        dataDir,
      })
      await Bun.write(join(dir, "findings.json"), JSON.stringify([{ findingId: "finding-1", issue: "Contradiction" }]))

      const init = await rpc(token, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      })
      expect(init?.status).toBe(200)
      expect(await init!.json()).toMatchObject({
        result: { serverInfo: { name: "qurom-findings" } },
      })

      const listed = await rpc(token, { jsonrpc: "2.0", id: 2, method: "tools/list" })
      expect(await listed!.json()).toMatchObject({
        result: { tools: [{ name: GET_UNRESOLVED_FINDINGS_TOOL }] },
      })

      const called = await rpc(token, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: GET_UNRESOLVED_FINDINGS_TOOL, arguments: {} },
      })
      const payload = await called!.json() as { result: { content: Array<{ text: string }> } }
      expect(JSON.parse(payload.result.content[0]!.text)).toEqual([
        { findingId: "finding-1", issue: "Contradiction" },
      ])

      await revokeFindingsMcpGrant("req-1")
      const revoked = await rpc(token, { jsonrpc: "2.0", id: 4, method: "tools/list" })
      expect(revoked?.status).toBe(401)
    })
  })
})
