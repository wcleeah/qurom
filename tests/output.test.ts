import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  archiveFailureArtifactsOnResume,
  buildRunDirName,
  buildRunDirSlug,
  ensureRunDirPath,
  removeEmptyRunDir,
  resolveRunDir,
  writeRunJsonArtifact,
  writeRunTextArtifact,
} from "../src/output.ts"

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

  test("writeRunTextArtifact and writeRunJsonArtifact create the run dir and write content", async () => {
    const root = await mkdtemp(join(tmpdir(), "qurom-output-"))
    const runDir = join(root, "artifacts")

    await writeRunTextArtifact(runDir, "draft-round-1.md", "hello world")
    await writeRunJsonArtifact(runDir, "request.json", { requestId: "req-1", inputMode: "topic" })

    expect(await Bun.file(join(runDir, "draft-round-1.md")).text()).toBe("hello world")
    expect(await Bun.file(join(runDir, "request.json")).json()).toEqual({
      requestId: "req-1",
      inputMode: "topic",
    })
  })

  test("archiveFailureArtifactsOnResume renames failure.json and error run-status.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "qurom-output-"))
    const runDir = join(root, "failed-run")
    await writeRunJsonArtifact(runDir, "failure.json", { error: "boom", phase: "finalize" })
    await writeRunJsonArtifact(runDir, "run-status.json", { phase: "error", error: "boom" })
    await writeRunTextArtifact(runDir, "latest-draft.md", "draft body")

    const result = await archiveFailureArtifactsOnResume(runDir)

    expect(result.archivedFailure).toBe(true)
    expect(result.archivedRunStatus).toBe(true)
    expect(await Bun.file(join(runDir, "failure.json")).exists()).toBe(false)
    expect(await Bun.file(join(runDir, "run-status.json")).exists()).toBe(false)
    expect(await Bun.file(join(runDir, "latest-draft.md")).exists()).toBe(true)

    const { readdir } = await import("node:fs/promises")
    const files = await readdir(runDir)
    expect(files.some((f) => f.startsWith("failure-archived-") && f.endsWith(".json"))).toBe(true)
    expect(files.some((f) => f.startsWith("run-status-archived-") && f.endsWith(".json"))).toBe(true)
  })

  test("archiveFailureArtifactsOnResume leaves non-error run-status alone", async () => {
    const root = await mkdtemp(join(tmpdir(), "qurom-output-"))
    const runDir = join(root, "ok-run")
    await writeRunJsonArtifact(runDir, "run-status.json", { phase: "complete" })

    const result = await archiveFailureArtifactsOnResume(runDir)

    expect(result.archivedFailure).toBe(false)
    expect(result.archivedRunStatus).toBe(false)
    expect(await Bun.file(join(runDir, "run-status.json")).json()).toEqual({ phase: "complete" })
  })
})
