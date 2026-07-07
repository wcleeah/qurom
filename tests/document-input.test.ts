import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  assertDocumentSize,
  DocumentInputError,
  normalizeDocumentRequest,
  readRunSourceDocument,
  MAX_DOCUMENT_BYTES,
} from "../src/document-input"
import { RUN_INPUT_DOCUMENT } from "../src/output"

describe("document-input", () => {
  let tempDir: string

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  })

  test("normalizeDocumentRequest writes input.md from inline text", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "doc-input-"))
    const normalized = await normalizeDocumentRequest(
      { inputMode: "document", documentText: "# Hybrid reranking\n\nNotes." },
      tempDir,
    )

    expect(normalized.documentPath).toEndWith(RUN_INPUT_DOCUMENT)
    expect(normalized.documentText).toContain("Hybrid reranking")
    expect(normalized.documentSource).toBe("inline")
    expect(await Bun.file(join(tempDir, RUN_INPUT_DOCUMENT)).text()).toContain("Hybrid reranking")
  })

  test("normalizeDocumentRequest copies an external path into the run directory", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "doc-input-"))
    const external = join(tempDir, "external.md")
    await Bun.write(external, "# External doc\n\nBody.")

    const normalized = await normalizeDocumentRequest(
      { inputMode: "document", documentPath: external },
      join(tempDir, "run-dir"),
    )

    expect(normalized.documentSource).toBe("copied")
    expect(normalized.originalDocumentPath).toBe(external)
    expect(await readRunSourceDocument(join(tempDir, "run-dir"))).toContain("External doc")
  })

  test("normalizeDocumentRequest rejects empty input", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "doc-input-"))
    await expect(
      normalizeDocumentRequest({ inputMode: "document" }, tempDir),
    ).rejects.toBeInstanceOf(DocumentInputError)
  })

  test("assertDocumentSize enforces the byte limit", () => {
    const big = "x".repeat(MAX_DOCUMENT_BYTES + 1)
    expect(() => assertDocumentSize(big)).toThrow(DocumentInputError)
  })
})
