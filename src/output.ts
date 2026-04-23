import { mkdir, readdir, rmdir } from "node:fs/promises"
import { basename, extname, join } from "node:path"

type RunDirInput = {
  requestId: string
  inputMode: "topic" | "document"
  topic?: string
  documentPath?: string
  documentText?: string
  slugHint?: string
}

function normalizeAscii(input: string) {
  return input.normalize("NFKD").replace(/[^\x00-\x7F]/g, "")
}

function tokenize(input: string) {
  return normalizeAscii(input).toLowerCase().match(/[a-z0-9]+/g) ?? []
}

function buildShortSlug(input: string, fallback: string) {
  const selected = tokenize(input).slice(0, 10)

  if (selected.length === 0) return fallback

  let slug = ""
  for (const token of selected) {
    const next = slug ? `${slug}-${token}` : token
    if (next.length > 32) break
    slug = next
  }

  if (slug) return slug
  return selected[0]?.slice(0, 32) || fallback
}

function looksLikeGeneratedName(input: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)
}

function firstMeaningfulDocumentLine(documentText?: string) {
  if (!documentText) return undefined

  const lines = documentText.split(/\r?\n/)
  let inFrontmatter = false
  let inCodeBlock = false

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    const trimmed = raw?.trim() ?? ""
    if (!trimmed) continue

    if (index === 0 && trimmed === "---") {
      inFrontmatter = true
      continue
    }

    if (inFrontmatter) {
      if (trimmed === "---") inFrontmatter = false
      continue
    }

    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock
      continue
    }

    if (inCodeBlock) continue

    const candidate = trimmed
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .trim()

    if (candidate) return candidate
  }

  return undefined
}

function documentSlug(input: RunDirInput) {
  const firstLine = firstMeaningfulDocumentLine(input.documentText)
  if (firstLine) return buildShortSlug(firstLine, "document")

  const filename = input.documentPath ? basename(input.documentPath, extname(input.documentPath)) : ""
  if (filename && !looksLikeGeneratedName(filename)) {
    return buildShortSlug(filename, "document")
  }

  return "document"
}

function hasErrorCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}

export function buildRunDirSlug(input: Omit<RunDirInput, "requestId">) {
  if (input.slugHint) {
    return buildShortSlug(input.slugHint, input.inputMode === "topic" ? "topic" : "document")
  }

  if (input.inputMode === "topic") {
    return buildShortSlug(input.topic ?? "", "topic")
  }

  return documentSlug({ ...input, requestId: "" })
}

export function buildRunDirName(input: RunDirInput) {
  return `${buildRunDirSlug(input)}-${input.requestId}`
}

export function resolveRunDir(root: string, input: RunDirInput) {
  return join(root, buildRunDirName(input))
}

export async function ensureArtifactDir(path: string) {
  await mkdir(path, { recursive: true })
  await Bun.write(`${path}/.gitkeep`, "")
}

export async function ensureRunDir(root: string, input: RunDirInput) {
  const runDir = resolveRunDir(root, input)
  await mkdir(runDir, { recursive: true })
  return runDir
}

export async function ensureRunDirPath(runDir: string) {
  await mkdir(runDir, { recursive: true })
  return runDir
}

export async function removeEmptyRunDir(runDir: string) {
  try {
    const entries = await readdir(runDir)
    if (entries.length === 0) {
      await rmdir(runDir)
    }
  } catch (error) {
    if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTEMPTY")) return
    throw error
  }
}

export async function writeApprovedArtifacts(
  runDir: string,
  input: {
    draft: string
    summary: Record<string, unknown>
  },
) {
  await ensureRunDirPath(runDir)
  await Bun.write(join(runDir, "final.md"), input.draft)
  await Bun.write(join(runDir, "summary.json"), JSON.stringify(input.summary, null, 2))
}

export async function writeFailedArtifacts(
  runDir: string,
  input: {
    draft: string
    summary: Record<string, unknown>
  },
) {
  await ensureRunDirPath(runDir)
  await Bun.write(join(runDir, "latest-draft.md"), input.draft)
  await Bun.write(join(runDir, "failure.json"), JSON.stringify(input.summary, null, 2))
}
