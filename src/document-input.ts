import { resolve } from "node:path"

import type { InputRequest } from "./schema"
import { RUN_INPUT_DOCUMENT, writeRunTextArtifact } from "./output"

export { RUN_INPUT_DOCUMENT }

/** Maximum document size accepted from browser or API (1 MiB). */
export const MAX_DOCUMENT_BYTES = 1_048_576

export type DocumentSource = "inline" | "path" | "copied"

export type NormalizedDocumentRequest = Extract<InputRequest, { inputMode: "document" }> & {
  documentSource: DocumentSource
  originalDocumentPath?: string
}

export class DocumentInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DocumentInputError"
  }
}

export function assertDocumentSize(text: string, maxBytes = MAX_DOCUMENT_BYTES) {
  const bytes = new TextEncoder().encode(text).byteLength
  if (bytes > maxBytes) {
    const maxKb = Math.round(maxBytes / 1024)
    throw new DocumentInputError(
      `Document is too large (${Math.round(bytes / 1024)} KB). Maximum size is ${maxKb} KB.`,
    )
  }
}

function trimmed(value: string | undefined) {
  const next = value?.trim()
  return next ? next : undefined
}

/**
 * Persist browser- or path-supplied document content into the run directory as
 * `input.md` and return a normalized request the graph can consume.
 */
export async function normalizeDocumentRequest(
  request: Extract<InputRequest, { inputMode: "document" }>,
  runDir: string,
): Promise<NormalizedDocumentRequest> {
  const canonicalPath = resolve(runDir, RUN_INPUT_DOCUMENT)
  const inlineText = trimmed(request.documentText)
  const externalPath = trimmed(request.documentPath)

  if (!inlineText && !externalPath) {
    throw new DocumentInputError("Document input requires pasted text or a file path.")
  }

  let text: string
  let documentSource: DocumentSource
  let originalDocumentPath: string | undefined

  if (inlineText) {
    assertDocumentSize(inlineText)
    text = inlineText
    documentSource = "inline"
    if (externalPath && resolve(externalPath) !== canonicalPath) {
      originalDocumentPath = externalPath
    }
  } else {
    const sourcePath = resolve(externalPath!)
    const file = Bun.file(sourcePath)
    if (!(await file.exists())) {
      throw new DocumentInputError(`Document not found: ${externalPath}`)
    }
    text = await file.text()
    assertDocumentSize(text)
    originalDocumentPath = sourcePath === canonicalPath ? undefined : externalPath
    documentSource = sourcePath === canonicalPath ? "path" : "copied"
  }

  await writeRunTextArtifact(runDir, RUN_INPUT_DOCUMENT, text)

  return {
    inputMode: "document",
    documentPath: canonicalPath,
    documentText: text,
    documentSource,
    originalDocumentPath,
  }
}

export async function readRunSourceDocument(runDir: string): Promise<string | undefined> {
  const path = resolve(runDir, RUN_INPUT_DOCUMENT)
  const file = Bun.file(path)
  if (!(await file.exists())) return undefined
  return file.text()
}
