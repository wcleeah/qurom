import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { POLLING_SCRIPT } from "../src/view/client-script.ts"
import { FINDINGS_MCP_CHECK_SCRIPT, renderFindingsMcpCheckPanel } from "../src/view/findings-mcp-check.ts"
import { renderRun } from "../src/view/pages.ts"
import { handleRunApi } from "../src/view/run-api.ts"
import { resetFindingsMcpGrantsForTests } from "../src/findings-mcp.ts"

let dir: string
let originalDataDir: string | undefined
let originalRunsDir: string | undefined
let originalWorkspace: string | undefined
let originalOpencodeDir: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-findings-mcp-check-"))
  await mkdir(join(dir, "runs", "sample-run"), { recursive: true })
  await writeFile(join(dir, "runs", "sample-run", "request.json"), JSON.stringify({
    requestId: "req-sample",
    topic: "Sample",
  }))
  await writeFile(join(dir, "runs", "sample-run", "findings.json"), JSON.stringify([
    {
      findingId: "req-sample:1:source-auditor:1",
      agent: "source-auditor",
      severity: "major",
      category: "accuracy",
      issue: "The draft contradicts the cited source",
      evidence: ["Source says 2019"],
      required_fix: "Correct the year",
    },
  ]))
  await writeFile(join(dir, "runs", "sample-run", "unresolved-findings-round-1.json"), JSON.stringify([
    {
      findingId: "req-sample:1:source-auditor:1",
      agent: "source-auditor",
      severity: "major",
      category: "accuracy",
      issue: "The draft contradicts the cited source",
      evidence: ["Source says 2019"],
      required_fix: "Correct the year",
    },
  ]))

  originalDataDir = process.env.QUORUM_DATA_DIR
  originalRunsDir = process.env.QUORUM_RUNS_DIR
  originalWorkspace = process.env.QUORUM_WORKSPACE_DIRECTORY
  originalOpencodeDir = process.env.OPENCODE_DIRECTORY
  process.env.QUORUM_DATA_DIR = dir
  process.env.QUORUM_RUNS_DIR = join(dir, "runs")
  process.env.QUORUM_WORKSPACE_DIRECTORY = dir
  process.env.OPENCODE_DIRECTORY = dir
  resetFindingsMcpGrantsForTests()
})

afterEach(async () => {
  resetFindingsMcpGrantsForTests()
  if (originalDataDir === undefined) delete process.env.QUORUM_DATA_DIR
  else process.env.QUORUM_DATA_DIR = originalDataDir
  if (originalRunsDir === undefined) delete process.env.QUORUM_RUNS_DIR
  else process.env.QUORUM_RUNS_DIR = originalRunsDir
  if (originalWorkspace === undefined) delete process.env.QUORUM_WORKSPACE_DIRECTORY
  else process.env.QUORUM_WORKSPACE_DIRECTORY = originalWorkspace
  if (originalOpencodeDir === undefined) delete process.env.OPENCODE_DIRECTORY
  else process.env.OPENCODE_DIRECTORY = originalOpencodeDir
  await rm(dir, { recursive: true, force: true })
})

describe("findings MCP health check UI", () => {
  test("run page includes the check button and preserves results across live refresh", async () => {
    const html = renderFindingsMcpCheckPanel("sample-run")
    expect(html).toContain("Check findings MCP")
    expect(html).toContain('data-run-name="sample-run"')
    expect(FINDINGS_MCP_CHECK_SCRIPT).toContain("/api/runs/")
    expect(FINDINGS_MCP_CHECK_SCRIPT).toContain("/findings-mcp-check")
    expect(FINDINGS_MCP_CHECK_SCRIPT).toContain("get_unresolved_findings")
    expect(POLLING_SCRIPT).toContain("findings-mcp-check-section")
    expect(POLLING_SCRIPT).toContain("data-findings-mcp-busy")

    const page = await (await renderRun("sample-run")).text()
    expect(page).toContain("Check findings MCP")
    expect(page).toContain("id=\"findings-mcp-check-section\"")
    expect(page).toContain("data-findings-mcp-check-btn")
  })

  test("POST /api/runs/:id/findings-mcp-check returns this run's round findings", async () => {
    const req = new Request("http://localhost/api/runs/sample-run/findings-mcp-check", {
      method: "POST",
      headers: { Accept: "application/json", Origin: "http://localhost:3000" },
    })
    const res = await handleRunApi(req, "/api/runs/sample-run/findings-mcp-check", new URL(req.url))
    expect(res).toBeDefined()
    expect(res!.status).toBe(200)
    const body = await res!.json() as {
      ok: boolean
      round: number
      sourceFile: string
      findingsMatch: boolean
      findingCount: number
      grantSource: string
      findings: Array<{ findingId: string; issue: string }>
    }
    expect(body.ok).toBe(true)
    expect(body.round).toBe(1)
    expect(body.sourceFile).toBe("findings.json")
    expect(body.findingsMatch).toBe(true)
    expect(body.findingCount).toBe(1)
    expect(body.grantSource).toBe("issued-for-check")
    expect(body.findings[0]?.issue).toBe("The draft contradicts the cited source")
  })

  test("POST /api/runs/:id/findings-mcp-check 404s unknown runs", async () => {
    const req = new Request("http://localhost/api/runs/missing-run/findings-mcp-check", {
      method: "POST",
      headers: { Accept: "application/json" },
    })
    const res = await handleRunApi(req, "/api/runs/missing-run/findings-mcp-check", new URL(req.url))
    expect(res!.status).toBe(404)
  })
})
