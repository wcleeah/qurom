import { join } from "node:path"

import { readRunSourceDocument } from "./document-input"
import { resolveRunDirectory } from "./run-resume"
import {
  inputRequestSchema,
  readerCalibrationProfileSchema,
  type InputRequest,
  type ReaderCalibrationProfile,
} from "./schema"

export type RerunInterviewMode = "reuse" | "fresh"

export type PriorRunRerunLoad = {
  sourceRunDir: string
  request: InputRequest
  readerProfile?: ReaderCalibrationProfile
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
  if (raw === "reuse" || raw === "fresh") return raw
  throw new RerunLoadError('interview must be "reuse" or "fresh"', 400)
}

/**
 * Rebuild a new-run InputRequest from a prior run, optionally loading its
 * accepted reader profile for interview-skipping reuse.
 */
export async function loadPriorRunForRerun(
  runRef: string,
  mode: RerunInterviewMode,
  runsRoot: string,
): Promise<PriorRunRerunLoad> {
  const sourceRunDir = await resolveRunDirectory(runRef, runsRoot).catch(() => {
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

  return { sourceRunDir, request, readerProfile: profileParsed.data }
}
