import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildRepairPrompt, resolveRepairHtml } from "../src/view/html-repair-context.ts"
import {
  appendHtmlReaderRepairMessage,
  createHtmlReaderRepairThread,
  listHtmlReaderRepairThreads,
  purgeEmptyHtmlReaderRepairThreads,
} from "../src/view/html-repair-store.ts"
import { handleListRepairThreads } from "../src/view/html-repair-routes.ts"
import { renderHtmlViewerPage } from "../src/view/html-viewer.ts"
import { DEFAULT_PLAYWRIGHT_MCP_SERVER } from "../src/mcp-config.ts"
import { configuredAgentRoles, HTML_REPAIR_ROLE } from "../src/role-registry.ts"
import { ensureConfigInitialized, loadMcpRegistryFromStore } from "../src/config-store.ts"
import { installDefaultsFixtures, testRuntimeConfig, testRuntimeEnv } from "./test-env"

let dir: string
let originalDataDir: string | undefined
let originalWorkspace: string | undefined
let originalOpencodeDir: string | undefined
let originalRunsDir: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-view-html-repair-"))
  await mkdir(join(dir, "runs", "alpha-run"), { recursive: true })
  await writeFile(join(dir, "runs", "alpha-run", "final.html"), "<html><body>Hello</body></html>")
  await installDefaultsFixtures(dir)

  originalDataDir = process.env.QUORUM_DATA_DIR
  originalWorkspace = process.env.QUORUM_WORKSPACE_DIRECTORY
  originalOpencodeDir = process.env.OPENCODE_DIRECTORY
  originalRunsDir = process.env.QUORUM_RUNS_DIR
  process.env.QUORUM_DATA_DIR = dir
  process.env.QUORUM_WORKSPACE_DIRECTORY = dir
  process.env.OPENCODE_DIRECTORY = dir
  process.env.QUORUM_RUNS_DIR = join(dir, "runs")
})

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.QUORUM_DATA_DIR
  else process.env.QUORUM_DATA_DIR = originalDataDir
  if (originalWorkspace === undefined) delete process.env.QUORUM_WORKSPACE_DIRECTORY
  else process.env.QUORUM_WORKSPACE_DIRECTORY = originalWorkspace
  if (originalOpencodeDir === undefined) delete process.env.OPENCODE_DIRECTORY
  else process.env.OPENCODE_DIRECTORY = originalOpencodeDir
  if (originalRunsDir === undefined) delete process.env.QUORUM_RUNS_DIR
  else process.env.QUORUM_RUNS_DIR = originalRunsDir
  await rm(dir, { recursive: true, force: true })
})

describe("html repair", () => {
  test("role registry includes html-repair utility role", () => {
    const config = testRuntimeConfig({ dataDir: dir })
    expect(configuredAgentRoles(config)).toContain(HTML_REPAIR_ROLE)
    expect(configuredAgentRoles(config)).not.toContain("browser-qa-enhancer")
  })

  test("seeds playwright MCP by default", async () => {
    const env = testRuntimeEnv({ dataDir: dir, workspaceDir: dir })
    await ensureConfigInitialized(env)
    const registry = await loadMcpRegistryFromStore(env)
    expect(registry.servers.some((server) => server.name === "playwright")).toBe(true)
    expect(registry.servers.find((server) => server.name === "playwright")).toEqual(DEFAULT_PLAYWRIGHT_MCP_SERVER)
    expect(registry.enabled).toContain("playwright")
  })

  test("resolveRepairHtml and buildRepairPrompt require verification todos without attachment-path wording", async () => {
    const html = await resolveRepairHtml("alpha-run", "final.html")
    expect(html.htmlFile).toBe("final.html")
    const built = await buildRepairPrompt({
      message: "cannot scroll",
      bootstrap: true,
      html,
      promptAsset: [
        "Bug: {bugReport}",
        "{selectionContext}",
        "todowrite",
        "Scrolling works all the way",
        "Mobile overflow checks",
        "UI looks fine",
      ].join("\n"),
    })
    expect(built.outputFile).toBe(html.absolutePath)
    expect(built.inputFiles?.[0]?.filename).toBe("document.html")
    expect(built.prompt).toContain("cannot scroll")
    expect(built.prompt).not.toContain(html.absolutePath)
    expect(built.prompt).toContain("Scrolling works all the way")
    expect(built.prompt).toContain("Mobile overflow checks")
    expect(built.prompt).toContain("UI looks fine")

    const followup = await buildRepairPrompt({
      message: "still broken on mobile",
      bootstrap: false,
      html,
      promptAsset: "unused",
    })
    expect(followup.prompt).toContain("still broken on mobile")
    expect(followup.prompt).not.toContain(html.absolutePath)
    expect(followup.outputFile).toBe(html.absolutePath)
  })

  test("repair store persists threads with messages", async () => {
    const html = await resolveRepairHtml("alpha-run", "final.html")
    const thread = await createHtmlReaderRepairThread({
      runName: "alpha-run",
      htmlFile: "final.html",
      htmlMtimeMs: html.mtimeMs,
      provider: "opencode",
      contextQuote: "overflow here",
    })
    await appendHtmlReaderRepairMessage({
      threadId: thread.id,
      role: "user",
      content: "page cannot scroll",
    })
    const listed = await listHtmlReaderRepairThreads("alpha-run", "final.html")
    expect(listed).toHaveLength(1)
    expect(listed[0]?.firstUserPreview).toContain("cannot scroll")
    expect(listed[0]?.contextQuote).toBe("overflow here")
  })

  test("purgeEmptyHtmlReaderRepairThreads removes empty threads", async () => {
    const html = await resolveRepairHtml("alpha-run", "final.html")
    await createHtmlReaderRepairThread({
      runName: "alpha-run",
      htmlFile: "final.html",
      htmlMtimeMs: html.mtimeMs,
      provider: "opencode",
    })
    const purged = await purgeEmptyHtmlReaderRepairThreads("alpha-run", "final.html")
    expect(purged).toBe(1)
    expect(await listHtmlReaderRepairThreads("alpha-run", "final.html")).toHaveLength(0)
  })

  test("handleListRepairThreads returns json", async () => {
    const html = await resolveRepairHtml("alpha-run", "final.html")
    const thread = await createHtmlReaderRepairThread({
      runName: "alpha-run",
      htmlFile: "final.html",
      htmlMtimeMs: html.mtimeMs,
      provider: "opencode",
    })
    await appendHtmlReaderRepairMessage({
      threadId: thread.id,
      role: "user",
      content: "mobile overflow",
    })
    const response = await handleListRepairThreads("alpha-run", "final.html")
    expect(response.status).toBe(200)
    const body = await response.json() as { ok: boolean; threads: Array<{ id: string }> }
    expect(body.ok).toBe(true)
    expect(body.threads).toHaveLength(1)
    expect(body.threads[0]?.id).toBe(thread.id)
  })

  test("renders Fix tab UI and repair script", () => {
    const html = renderHtmlViewerPage("alpha-run", "final.html", "", [], [])
    expect(html).toContain('data-html-tab="fix"')
    expect(html).toContain('data-html-panel="fix"')
    expect(html).toContain("data-html-repair-root")
    expect(html).toContain("data-html-repair-chat-list")
    expect(html).toContain("data-html-nav-fix")
    expect(html).toContain("/html-repair")
    expect(html).toContain("Playwright")
    expect(html).toContain("html-repair-open")
    expect(html).not.toContain("browser-qa-enhancer")
  })

  test("shipped prompt mandates the three verification todos", async () => {
    const prompt = await Bun.file(join(dir, "defaults", "prompts", "html-repair.fix.md")).text()
    expect(prompt).toContain("todowrite")
    expect(prompt).toContain("Scrolling works all the way")
    expect(prompt).toContain("Mobile overflow checks")
    expect(prompt).toContain("UI looks fine")
    expect(prompt).toContain("Playwright MCP")
    expect(prompt).toContain("`HTML document` context or attached as a file")
    expect(prompt).toContain("by chunk, instead of one full write")
    expect(prompt).not.toContain("{htmlFile}")
    expect(prompt).not.toContain("also attached as `document.html`")
  })

  test("enhancer prompts restore chunked local-file write guidance", async () => {
    const graphical = await Bun.file(join(dir, "defaults", "prompts", "graphical-enhancer.enhance.md")).text()
    const reading = await Bun.file(join(dir, "defaults", "prompts", "reading-experience-enhancer.enhance.md")).text()
    for (const prompt of [graphical, reading]) {
      expect(prompt).toContain("`HTML document` context or attached as a file")
      expect(prompt).toContain("by chunk, instead of one full write")
      expect(prompt).not.toContain("The HTML document is provided with this prompt.")
    }
  })

  test("shipped agent allows bash and todowrite", async () => {
    const agent = await Bun.file(join(dir, "defaults", "opencode", "agents", "html-repair.md")).text()
    expect(agent).toContain("bash: allow")
    expect(agent).toContain("todowrite: allow")
    expect(agent).toContain("runs/**/*.html")
  })
})
