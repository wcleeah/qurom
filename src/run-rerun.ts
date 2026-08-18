import { join } from "node:path"

import { readRunSourceDocument } from "./document-input"
import { loadCompletedReaderTranscriptFromRunDir, type ReaderTranscriptEntry } from "./reader-transcript"
import { archiveDirForRuns } from "./run-archive"
import { resolveRunDirectory } from "./run-resume"
import {
  inputRequestSchema,
  readerCalibrationProfileSchema,
  type InputRequest,
  type ReaderCalibrationProfile,
} from "./schema"
import type { UnattendedRerunInterview } from "./rerun-queue-store"

export type RerunInterviewMode = "reuse" | "fresh" | "repair"

export function isUnattendedRerunInterview(mode: RerunInterviewMode): mode is UnattendedRerunInterview {
  return mode === "reuse" || mode === "repair"
}

export function displayTopicForRerun(request: InputRequest, fallback: string): string {
  if (request.inputMode === "topic") return request.topic
  const text = request.documentText ?? ""
  const line = text.split(/\r?\n/).map((entry) => entry.trim()).find(Boolean)
  if (!line) return fallback
  return line.replace(/^#{1,6}\s+/, "").slice(0, 120) || fallback
}

export type PriorRunRerunLoad = {
  sourceRunDir: string
  request: InputRequest
  readerProfile?: ReaderCalibrationProfile
  interviewTranscript?: ReaderTranscriptEntry[]
}

export class RerunLoadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "RerunLoadError"
  }
}

export function parseRerunInterviewMode(raw: unknown): RerunInterviewMode {
  if (raw === "reuse" || raw === "fresh" || raw === "repair") return raw
  throw new RerunLoadError('interview must be "reuse", "fresh", or "repair"', 400)
}

/**
 * Rebuild a new-run InputRequest from a prior run, optionally loading its
 * accepted reader profile for interview-skipping reuse or intent-only repair.
 */
export async function loadPriorRunForRerun(
  runRef: string,
  mode: RerunInterviewMode,
  runsRoot: string,
  archiveRoot = archiveDirForRuns(runsRoot),
): Promise<PriorRunRerunLoad> {
  const sourceRunDir = await resolveRunDirectory(runRef, runsRoot, archiveRoot).catch(() => {
    throw new RerunLoadError(`Run not found: ${runRef}`, 404)
  })

  const requestFile = Bun.file(join(sourceRunDir, "request.json"))
  if (!(await requestFile.exists())) {
    throw new RerunLoadError("No request.json found in prior run", 404)
  }

  const raw = await requestFile.json() as Record<string, unknown>
  const parsed = inputRequestSchema.safeParse(raw)
  if (!parsed.success) {
    throw new RerunLoadError(`Invalid request.json in prior run: ${parsed.error.message}`, 400)
  }

  let request: InputRequest = parsed.data
  if (request.inputMode === "document") {
    const documentText = await readRunSourceDocument(sourceRunDir)
    if (!documentText?.trim()) {
      throw new RerunLoadError("This run has no saved source document (input.md).", 404)
    }
    request = { inputMode: "document", documentText }
  } else if (!request.topic?.trim()) {
    throw new RerunLoadError("This run has no topic to rerun.", 404)
  }

  if (mode === "fresh") {
    return { sourceRunDir, request }
  }

  const profileFile = Bun.file(join(sourceRunDir, "reader-profile.json"))
  if (!(await profileFile.exists())) {
    throw new RerunLoadError("This run has no reader-profile.json to reuse.", 404)
  }
  const profileParsed = readerCalibrationProfileSchema.safeParse(await profileFile.json())
  if (!profileParsed.success) {
    throw new RerunLoadError(`Invalid reader-profile.json in prior run: ${profileParsed.error.message}`, 400)
  }

  const interviewTranscript = mode === "repair"
    ? await loadCompletedReaderTranscriptFromRunDir(sourceRunDir)
    : undefined

  return {
    sourceRunDir,
    request,
    readerProfile: profileParsed.data,
    ...(interviewTranscript && interviewTranscript.length > 0 ? { interviewTranscript } : {}),
  }
}
