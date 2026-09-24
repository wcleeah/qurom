import { describe, expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { AgentRuntime } from "../src/agent-runtime/runtime"
import { InvalidInputContextError, assertNonEmptyInputFiles, assertNonEmptyText } from "../src/agent-runtime/input-context"
import { ensureConfigInitialized } from "../src/config-store"
import { summarizeMarkdown } from "../src/summarizer"
import { tagArticle } from "../src/tagger"
import { installDefaultsFixtures, testQuorumConfig, testRuntimeEnv, unitTestDataDir } from "./test-env"
import type { RuntimeConfig } from "../src/config"

const config: RuntimeConfig = {
  env: {
    ...testRuntimeEnv({ dataDir: unitTestDataDir("empty-context"), workspaceDir: process.cwd() }),
    CURSOR_API_KEY: undefined,
    LANGFUSE_PUBLIC_KEY: undefined,
    LANGFUSE_SECRET_KEY: undefined,
    LANGFUSE_BASE_URL: undefined,
  },
  quorumConfig: testQuorumConfig({ maxRounds: 1 }),
  roleBindings: {},
}

describe("assertNonEmptyText", () => {
  test("rejects blank strings", () => {
    expect(() => assertNonEmptyText("  \n", "markdown")).toThrow(InvalidInputContextError)
    expect(() => assertNonEmptyText("  \n", "markdown")).toThrow("markdown context is empty")
  })
})

describe("assertNonEmptyInputFiles", () => {
  test("rejects empty files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qurom-empty-ctx-"))
    const path = join(dir, "content.md")
    await writeFile(path, "")
    await expect(assertNonEmptyInputFiles([{ path, mime: "text/plain", filename: "content.md" }]))
      .rejects.toThrow("Input context content.md is empty")
  })
})

describe("summarizeMarkdown", () => {
  test("fails fast on empty markdown", async () => {
    await expect(summarizeMarkdown({
      config,
      title: "summary",
      markdown: "\n",
      mode: "artifact",
    })).rejects.toThrow("markdown context is empty")
  })
})

describe("tagArticle", () => {
  test("fails fast on empty markdown", async () => {
    await expect(tagArticle({
      config,
      runName: "sample-run",
      outputPath: "/tmp",
      markdown: "",
    })).rejects.toThrow("research-tagger markdown context is empty")
  })

  test("passes an outputFile so Cursor structured tagging can run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qurom-tagger-"))
    await installDefaultsFixtures(dir)
    const cfg: RuntimeConfig = {
      env: {
        ...testRuntimeEnv({ dataDir: join(dir, "data"), workspaceDir: dir }),
        CURSOR_API_KEY: undefined,
        LANGFUSE_PUBLIC_KEY: undefined,
        LANGFUSE_SECRET_KEY: undefined,
        LANGFUSE_BASE_URL: undefined,
      },
      quorumConfig: testQuorumConfig({ maxRounds: 1, tagging: { enabled: true, maxArticleTags: 8, maxNoteTags: 8, predefinedTags: [] } }),
      roleBindings: {},
    }
    const previousDataDir = process.env.QUORUM_DATA_DIR
    process.env.QUORUM_DATA_DIR = dir
    try {
      await ensureConfigInitialized(cfg.env)

      let seenOutputFile: string | undefined
      const runtime: AgentRuntime = {
        createHandle: async () => ({ id: "handle", providerId: "fake", role: "research-tagger", title: "tag" }),
        resumeHandle: async () => ({ id: "handle", providerId: "fake", role: "research-tagger", title: "tag" }),
        prompt: async (input) => {
          seenOutputFile = input.outputFile
          return { structured: { tags: [] } }
        },
        abort: async () => {},
        providerForRole: () => {
          throw new Error("unused")
        },
      }

      await tagArticle({
        config: cfg,
        runName: "sample-run",
        outputPath: dir,
        markdown: "# Article\n\nBody.",
        runtime,
      })

      expect(seenOutputFile).toBe(join(dir, "article-tags.json"))
    } finally {
      if (previousDataDir === undefined) delete process.env.QUORUM_DATA_DIR
      else process.env.QUORUM_DATA_DIR = previousDataDir
    }
  })
})
