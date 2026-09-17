import { readdir } from "node:fs/promises"
import { join } from "node:path"

import type { RuntimeConfig } from "../config"
import { writeRunJsonArtifact } from "../output"
import { readerCalibrationProfileSchema, type ReaderCalibrationProfile } from "../schema"
import { resolveReadabilitySystemOne, type ReadabilitySystemOne } from "../typesafe/client"
import { readabilityContextFromProfile } from "./context"
import { readabilityThresholds } from "./criteria"
import {
  POSTHOC_RAW_FILENAME,
  POSTHOC_REPORT_FILENAME,
  POSTHOC_STATUS_FILENAME,
  readabilityReportSchema,
  type ReadabilityReport,
} from "./schema"
import { scoreDraftReadability, type RawReadabilityCall } from "./score"
import { segmentDraft } from "./segment"

export class PosthocReviewError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "PosthocReviewError"
  }
}

export type PosthocReviewStatus = {
  phase: "running" | "complete" | "error"
  startedAt: string
  finishedAt?: string
  sourceFile?: string
  error?: string
}

export type ReviewMarkdownSource = {
  filename: string
  text: string
}

const inflight = new Set<string>()

const DRAFT_ROUND_RE = /^draft-round-(\d+)\.md$/

export function hasReviewableMarkdown(files: string[]) {
  return Boolean(pickReviewableMarkdownFilename(files))
}

export function pickReviewableMarkdownFilename(files: string[]): string | undefined {
  if (files.includes("final.md")) return "final.md"
  if (files.includes("latest-draft.md")) return "latest-draft.md"
  let best: { filename: string; round: number } | undefined
  for (const file of files) {
    const match = file.match(DRAFT_ROUND_RE)
    if (!match?.[1]) continue
    const round = Number.parseInt(match[1], 10)
    if (!best || round > best.round) best = { filename: file, round }
  }
  return best?.filename
}

export async function resolveReviewMarkdown(runDir: string): Promise<ReviewMarkdownSource> {
  const files = await readdir(runDir)
  const filename = pickReviewableMarkdownFilename(files)
  if (!filename) {
    throw new PosthocReviewError("This run has no markdown article to score (final.md, latest-draft.md, or draft-round-N.md).", 404)
  }
  const text = await Bun.file(join(runDir, filename)).text()
  if (!text.trim()) {
    throw new PosthocReviewError(`${filename} is empty.`, 400)
  }
  return { filename, text }
}

async function loadOptionalJson<T>(path: string): Promise<T | undefined> {
  if (!(await Bun.file(path).exists())) return undefined
  try {
    return await Bun.file(path).json() as T
  } catch {
    return undefined
  }
}

async function loadReaderProfile(runDir: string): Promise<ReaderCalibrationProfile | undefined> {
  const raw = await loadOptionalJson<unknown>(join(runDir, "reader-profile.json"))
  if (!raw) return undefined
  const parsed = readerCalibrationProfileSchema.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}

async function loadFallbackJob(runDir: string): Promise<string | undefined> {
  const request = await loadOptionalJson<{
    topic?: string
    inputSummary?: { title?: string }
  }>(join(runDir, "request.json"))
  return request?.inputSummary?.title || request?.topic
}

async function writeStatus(runDir: string, status: PosthocReviewStatus) {
  await writeRunJsonArtifact(runDir, POSTHOC_STATUS_FILENAME, status)
}

export async function scoreCompletedRun(input: {
  runDir: string
  config: RuntimeConfig
  systemOne?: ReadabilitySystemOne
}): Promise<{ report: ReadabilityReport; sourceFile: string }> {
  const runDir = input.runDir
  if (inflight.has(runDir)) {
    throw new PosthocReviewError("A readability review is already running for this run.", 409)
  }
  inflight.add(runDir)
  const startedAt = new Date().toISOString()
  let sourceFile: string | undefined
  try {
    const resolved = resolveReadabilitySystemOne(input.config, { systemOne: input.systemOne })
    if (!resolved.systemOne) {
      const reason = resolved.skipReason === "disabled"
        ? "Readability review is disabled in quorum config."
        : "TYPESAFE_API_KEY is not set."
      throw new PosthocReviewError(reason, 400)
    }

    const source = await resolveReviewMarkdown(runDir)
    sourceFile = source.filename
    await writeStatus(runDir, { phase: "running", startedAt, sourceFile })

    const settings = input.config.quorumConfig.readability
    const profile = await loadReaderProfile(runDir)
    const context = readabilityContextFromProfile(profile, await loadFallbackJob(runDir))
    const units = segmentDraft(source.text)
    const reviewedAt = new Date().toISOString()
    let report: ReadabilityReport
    let raw: RawReadabilityCall[] | undefined
    if (units.length === 0) {
      report = readabilityReportSchema.parse({
        round: 0,
        try: 0,
        model: settings.model,
        passed: true,
        kind: "posthoc",
        sourceFile,
        reviewedAt,
        thresholds: readabilityThresholds(input.config.quorumConfig),
        units: [],
        hotspots: [],
      })
    } else {
      const scored = await scoreDraftReadability({
        units,
        context,
        model: settings.model,
        thresholds: readabilityThresholds(input.config.quorumConfig),
        systemOne: resolved.systemOne,
        round: 0,
        tryIndex: 0,
      })
      report = readabilityReportSchema.parse({
        ...scored.report,
        kind: "posthoc",
        sourceFile,
        reviewedAt,
      })
      raw = scored.raw
    }

    await writeRunJsonArtifact(runDir, POSTHOC_REPORT_FILENAME, report)
    if (raw !== undefined) {
      await writeRunJsonArtifact(runDir, POSTHOC_RAW_FILENAME, raw)
    }
    await writeStatus(runDir, {
      phase: "complete",
      startedAt,
      finishedAt: reviewedAt,
      sourceFile,
    })
    return { report, sourceFile }
  } catch (error) {
    if (error instanceof PosthocReviewError && error.status === 409) throw error
    const message = error instanceof Error ? error.message : String(error)
    await writeStatus(runDir, {
      phase: "error",
      startedAt,
      finishedAt: new Date().toISOString(),
      sourceFile,
      error: message,
    }).catch(() => {})
    throw error
  } finally {
    inflight.delete(runDir)
  }
}
