import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  FINDINGS_MCP_PATH,
  GET_UNRESOLVED_FINDINGS_TOOL,
  advertisedOriginNote,
  checkFindingsMcpForRun,
  handleFindingsMcpHttp,
  inspectUnresolvedFindings,
  issueFindingsMcpGrant,
  lookupFindingsMcpGrantByRequestId,
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

  test("inspectUnresolvedFindings prefers findings.json and reports the latest round snapshot", async () => {
    await withDir(async (dir) => {
      await Bun.write(join(dir, "unresolved-findings-round-1.json"), JSON.stringify([{ findingId: "old" }]))
      await Bun.write(join(dir, "unresolved-findings-round-2.json"), JSON.stringify([{ findingId: "round-2" }]))
      await Bun.write(join(dir, "findings.json"), JSON.stringify([{ findingId: "working" }]))
      expect(await inspectUnresolvedFindings(dir)).toEqual({
        findings: [{ findingId: "working" }],
        sourceFile: "findings.json",
        round: 2,
      })
    })
  })

  test("checkFindingsMcpForRun calls get_unresolved_findings and matches round files", async () => {
    await withDir(async (dir) => {
      const dataDir = join(dir, "data")
      const outputPath = join(dir, "run")
      await mkdir(outputPath, { recursive: true })
      await Bun.write(join(outputPath, "unresolved-findings-round-2.json"), `${JSON.stringify([
        { findingId: "req:2:source-auditor:1", agent: "source-auditor", severity: "major", issue: "Contradiction in section 2" },
      ], null, 2)}\n`)

      const issued = await checkFindingsMcpForRun({
        requestId: "req-check",
        outputPath,
        dataDir,
        probeAdvertised: false,
      })
      expect(issued.ok).toBe(true)
      expect(issued.grantSource).toBe("issued-for-check")
      expect(issued.round).toBe(2)
      expect(issued.sourceFile).toBe("unresolved-findings-round-2.json")
      expect(issued.findingsMatch).toBe(true)
      expect(issued.findings).toEqual([
        { findingId: "req:2:source-auditor:1", agent: "source-auditor", severity: "major", issue: "Contradiction in section 2" },
      ])
      expect(await lookupFindingsMcpGrantByRequestId("req-check", dataDir)).toBeUndefined()

      const token = await issueFindingsMcpGrant({
        requestId: "req-check",
        outputPath,
        dataDir,
      })
      const live = await checkFindingsMcpForRun({
        requestId: "req-check",
        outputPath,
        dataDir,
        probeAdvertised: false,
      })
      expect(live.ok).toBe(true)
      expect(live.grantSource).toBe("live-session")
      expect(await lookupFindingsMcpGrantByRequestId("req-check", dataDir)).toMatchObject({ token, requestId: "req-check" })
    })
  })

  test("advertisedOriginNote warns when the MCP URL is not this dashboard", () => {
    expect(advertisedOriginNote("http://127.0.0.1:3000/mcp/findings", "https://app.example.com")).toContain("QUORUM_MCP_BASE_URL")
    expect(advertisedOriginNote("https://app.example.com/mcp/findings", "https://app.example.com")).toBeUndefined()
  })
})
