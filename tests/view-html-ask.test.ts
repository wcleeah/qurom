import { Database } from "bun:sqlite"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildAskPrompt, resolveSourceMarkdown } from "../src/view/html-ask-context.ts"
import type { RuntimeConfig } from "../src/config.ts"
import {
  appendHtmlReaderAskMessage,
  countHtmlReaderAskMessages,
  createHtmlReaderAskThread,
  listHtmlReaderAskMessages,
  listHtmlReaderAskThreads,
} from "../src/view/html-ask-store.ts"
import { formatSseEvent } from "../src/view/html-ask-sse.ts"
import { handleListAskThreads } from "../src/view/html-ask-routes.ts"
import { openHtmlReaderDb } from "../src/view/html-reader-db.ts"
import { renderHtmlViewerPage } from "../src/view/html-viewer.ts"
import { testQuorumConfig, testRuntimeEnv } from "./test-env"

let dir: string
let originalDataDir: string | undefined
let originalWorkspace: string | undefined
let originalOpencodeDir: string | undefined
let originalRunsDir: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-view-html-ask-"))
  await mkdir(join(dir, "runs", "alpha-run"), { recursive: true })
  await mkdir(join(dir, "assets", "prompts"), { recursive: true })
  await writeFile(join(dir, "runs", "alpha-run", "final.html"), "<html><body>Hello</body></html>")
  await writeFile(join(dir, "runs", "alpha-run", "final.md"), "# Title\n\nBody text.")
  await writeFile(join(dir, "assets", "prompts", "html-ask-page.md"), "{researchToolHint}\n\n## Reader question\n\n{question}\n")
  await writeFile(
    join(dir, "assets", "prompts", "html-ask-highlight.md"),
    'Quote: "{quote}"\n\n{question}\n',
  )

  originalDataDir = process.env.QUORUM_DATA_DIR
  originalWorkspace = process.env.QUORUM_WORKSPACE_DIRECTORY
  originalOpencodeDir = process.env.OPENCODE_DIRECTORY
  originalRunsDir = process.env.QUORUM_RUNS_DIR
  process.env.QUORUM_DATA_DIR = dir
  process.env.QUORUM_WORKSPACE_DIRECTORY = dir
  process.env.OPENCODE_DIRECTORY = dir
  process.env.QUORUM_RUNS_DIR = join(dir, "runs")
})

function askTestConfig(): RuntimeConfig {
  return {
    env: testRuntimeEnv({ dataDir: dir, workspaceDir: dir }),
    quorumConfig: testQuorumConfig({
      maxRounds: 1,
      auditors: ["source-auditor"],
      researchTools: { prefer: ["context7", "exa"], webSearchProvider: "exa" },
    }),
  }
}

const askPromptAssets = {
  htmlAskPage: "{researchToolHint}\n\n## Reader question\n\n{question}\n",
  htmlAskHighlight: 'Quote: "{quote}"\n\n{question}\n',
}

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

describe("html ask context", () => {
  test("resolveSourceMarkdown prefers final.md", async () => {
    const source = await resolveSourceMarkdown("alpha-run")
    expect(source.mdFile).toBe("final.md")
    expect(source.absolutePath).toContain("final.md")
  })

  test("buildAskPrompt bootstrap includes md attachment and followup is plain text", async () => {
    const source = await resolveSourceMarkdown("alpha-run")
    const bootstrap = await buildAskPrompt({
      scope: "page",
      message: "What is this about?",
      bootstrap: true,
      source,
      config: askTestConfig(),
      promptAssets: askPromptAssets,
    })
    expect(bootstrap.inputFiles?.[0]?.filename).toBe("content.md")
    expect(bootstrap.prompt).toContain("What is this about?")
    expect(bootstrap.prompt).toContain("Research tool preferences:")
    expect(bootstrap.prompt).toContain("Prefer context7")

    const followup = await buildAskPrompt({
      scope: "page",
      message: "Tell me more",
      bootstrap: false,
      source,
      config: askTestConfig(),
      promptAssets: askPromptAssets,
    })
    expect(followup.prompt).toBe("Tell me more")
    expect(followup.inputFiles).toBeUndefined()
  })
})

describe("html ask store", () => {
  test("creates threads, stores messages, and lists newest first", async () => {
    const thread = await createHtmlReaderAskThread({
      runName: "alpha-run",
      htmlFile: "final.html",
      mdFile: "final.md",
      mdMtimeMs: 1,
      scope: "page",
      provider: "cursor",
    })
    expect(thread.scope).toBe("page")

    await appendHtmlReaderAskMessage({ threadId: thread.id, role: "user", content: "Hello" })
    expect(await countHtmlReaderAskMessages(thread.id)).toBe(1)

    const listed = await listHtmlReaderAskThreads("alpha-run", "final.html")
    expect(listed).toHaveLength(1)
    expect(listed[0]?.firstUserPreview).toBe("Hello")

    const messages = await listHtmlReaderAskMessages(thread.id)
    expect(messages[0]?.content).toBe("Hello")
  })

  test("allows multiple page bootstrap threads after migration", async () => {
    await createHtmlReaderAskThread({
      runName: "alpha-run",
      htmlFile: "final.html",
      mdFile: "final.md",
      mdMtimeMs: 1,
      scope: "page",
      provider: "cursor",
    })
    await createHtmlReaderAskThread({
      runName: "alpha-run",
      htmlFile: "final.html",
      mdFile: "final.md",
      mdMtimeMs: 1,
      scope: "page",
      provider: "cursor",
    })

    const listed = await listHtmlReaderAskThreads("alpha-run", "final.html")
    expect(listed).toHaveLength(2)
  })

  test("migrates legacy unique constraint schema", () => {
    const dbPath = join(dir, "runs", "legacy-config.sqlite")
    const legacy = new Database(dbPath, { create: true })
    legacy.run(`
CREATE TABLE html_reader_ask_threads (
  id TEXT PRIMARY KEY,
  run_name TEXT NOT NULL,
  html_file TEXT NOT NULL,
  md_file TEXT NOT NULL,
  md_mtime_ms INTEGER NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('page', 'highlight')),
  highlight_id TEXT,
  provider TEXT NOT NULL,
  handle_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_name, html_file, scope, highlight_id)
);
    `)
    legacy.close()

    openHtmlReaderDb(dbPath).close()

    const reopened = new Database(dbPath, { create: true })
    const row = reopened.query<{ sql: string }, []>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'html_reader_ask_threads'",
    ).get()
    reopened.close()

    expect(row?.sql ?? "").not.toContain("UNIQUE(run_name, html_file, scope, highlight_id)")
  })
})

describe("html ask routes and ui", () => {
  test("formatSseEvent encodes json payload", () => {
    const chunk = formatSseEvent("delta", { text: "hi" })
    expect(chunk).toContain("event: delta")
    expect(chunk).toContain('"text":"hi"')
  })

  test("lists threads via route handler", async () => {
    await createHtmlReaderAskThread({
      runName: "alpha-run",
      htmlFile: "final.html",
      mdFile: "final.md",
      mdMtimeMs: 1,
      scope: "page",
      provider: "cursor",
    })
    const resp = await handleListAskThreads("alpha-run", "final.html")
    const data = await resp.json() as { threads: unknown[] }
    expect(data.threads).toHaveLength(1)
  })

  test("renders Ask tab UI with flat chat list", () => {
    const html = renderHtmlViewerPage("alpha-run", "final.html", "", [], [])
    expect(html).toContain('data-html-tab="ask"')
    expect(html).toContain('data-html-panel="ask"')
    expect(html).toContain("data-html-ask-chat-list")
    expect(html).toContain("data-html-ask-bootstrap")
    expect(html).toContain("New chat")
    expect(html).not.toContain("data-html-ask-thread-list")
    expect(html).toContain("/view-client/marked.umd.js")
    expect(html).toContain("quorumRenderMarkdown")
  })
})
