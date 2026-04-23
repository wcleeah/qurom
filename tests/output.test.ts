import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildRunDirName, buildRunDirSlug, ensureRunDirPath, removeEmptyRunDir, resolveRunDir } from "../src/output.ts"

describe("output helpers", () => {
  test("buildRunDirName uses a short readable topic slug with the request id suffix", () => {
    const dirName = buildRunDirName({
      requestId: "123e4567-e89b-12d3-a456-426614174000",
      inputMode: "topic",
      topic: "How does Raft leader election work in practice?",
    })

    expect(dirName).toBe("how-does-raft-leader-election-123e4567-e89b-12d3-a456-426614174000")
  })

  test("buildRunDirSlug abbreviates document mode from the first meaningful heading", () => {
    const slug = buildRunDirSlug({
      inputMode: "document",
      documentPath: "/tmp/generated.md",
      documentText: [
        "---",
        'title: ignored frontmatter',
        "---",
        "",
        "# How hybrid reranking works in Qdrant",
        "",
        "body",
      ].join("\n"),
    })

    expect(slug).toBe("how-hybrid-reranking-works-in")
  })

  test("buildRunDirSlug falls back to a document filename when text has no heading", () => {
    const slug = buildRunDirSlug({
      inputMode: "document",
      documentPath: "/tmp/Understanding Vector Search.md",
      documentText: "",
    })

    expect(slug).toBe("understanding-vector-search")
  })

  test("resolveRunDir joins the artifact root with the generated name", () => {
    const runDir = resolveRunDir("runs", {
      requestId: "req-1",
      inputMode: "topic",
      topic: "What is a vector database?",
    })

    expect(runDir).toBe(join("runs", "what-is-a-vector-database-req-1"))
  })

  test("buildRunDirSlug prefers a provided slug hint", () => {
    const slug = buildRunDirSlug({
      inputMode: "document",
      documentPath: "/tmp/generated.md",
      documentText: "# ignored",
      slugHint: "Hybrid reranking in Qdrant",
    })

    expect(slug).toBe("hybrid-reranking-in-qdrant")
  })

  test("removeEmptyRunDir removes empty directories but keeps non-empty ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "qurom-output-"))
    const emptyDir = join(root, "empty-run")
    const nonEmptyDir = join(root, "non-empty-run")

    await ensureRunDirPath(emptyDir)
    await ensureRunDirPath(nonEmptyDir)
    await Bun.write(join(nonEmptyDir, "final.md"), "hello")

    await removeEmptyRunDir(emptyDir)
    await removeEmptyRunDir(nonEmptyDir)

    expect(await Bun.file(emptyDir).exists()).toBe(false)
    expect(await Bun.file(join(nonEmptyDir, "final.md")).exists()).toBe(true)
  })
})
