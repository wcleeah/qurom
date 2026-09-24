import { basename } from "node:path"

import {
  DESIGN_WORKING_FILENAME,
  designHtmlRoleFromFilename,
  GRAPHICAL_ENHANCER_ROLE,
  HTML_REVIEWER_ROLE,
  LEGACY_DESIGN_HTML_ROUND_RE,
  LEGACY_INTERACTIVE_ENHANCER_ROLE,
  READING_EXPERIENCE_ENHANCER_ROLE,
} from "./design-artifacts"
import { DRAFT_WORKING_FILENAME } from "./draft-artifacts"
import { DESIGNER_ROLE, SUMMARIZER_ROLE } from "./role-registry"

const SHARED_WORKING_FILES = new Set([DRAFT_WORKING_FILENAME, DESIGN_WORKING_FILENAME])

export type CursorCallScope = {
  node?: string
  round?: number
}

export type CursorCallHistoryEntry = {
  node: string
  round?: number
  startedAt: number
  completedAt: number
  durationMs?: number
}

/** Infer graph node + round from a Cursor call's output artifact and agent role. */
export function inferCursorCallScope(input: {
  role: string
  artifact?: string
}): CursorCallScope {
  const artifact = basename((input.artifact ?? "").trim())
  // Working files are reused across nodes. Role still uniquely names design
  // stages; drafter keep-alive calls fall through so node-history can decide.
  if (SHARED_WORKING_FILES.has(artifact)) return inferScopeFromRole(input.role)
  if (artifact) {
    const fromArtifact = inferScopeFromArtifact(artifact, input.role)
    if (fromArtifact.node) return fromArtifact
  }
  return inferScopeFromRole(input.role)
}

/** Map a finished call onto the graph node that was running when it completed. */
export function inferScopeFromNodeHistory(
  completedAtMs: number | undefined,
  history: CursorCallHistoryEntry[],
): CursorCallScope {
  if (completedAtMs == null || !Number.isFinite(completedAtMs) || history.length === 0) return {}
  const hits = history.filter((entry) => completedAtMs >= entry.startedAt && completedAtMs <= entry.completedAt)
  if (hits.length === 0) return {}
  const preferred = hits.reduce((best, entry) => {
    const bestDuration = best.durationMs ?? (best.completedAt - best.startedAt)
    const entryDuration = entry.durationMs ?? (entry.completedAt - entry.startedAt)
    return entryDuration > bestDuration ? entry : best
  })
  return { node: preferred.node, round: preferred.round }
}

function designNodeForRole(role: string): string | undefined {
  switch (role) {
    case DESIGNER_ROLE:
      return "runDesignHtml"
    case GRAPHICAL_ENHANCER_ROLE:
    case LEGACY_INTERACTIVE_ENHANCER_ROLE:
      return "graphicalEnhance"
    case READING_EXPERIENCE_ENHANCER_ROLE:
      return "readingExperienceEnhance"
    case HTML_REVIEWER_ROLE:
      return "htmlReview"
    default:
      return undefined
  }
}

function inferScopeFromArtifact(artifact: string, role: string): CursorCallScope {
  let match: RegExpMatchArray | null

  const designRole = designHtmlRoleFromFilename(artifact)
  if (designRole) {
    const node = designNodeForRole(designRole) ?? designNodeForRole(role)
    if (node) return { node, round: 0 }
  }

  if ((match = artifact.match(LEGACY_DESIGN_HTML_ROUND_RE))) {
    const round = Number.parseInt(match[1]!, 10)
    const node = designNodeForRole(role) ?? "runDesignHtml"
    return { node, round }
  }

  if (artifact === "final.html") {
    return { node: "finalizeDesign", round: 0 }
  }

  if (/^reader-profile\.json$/.test(artifact) || /^\.interview-scratch\.json$/.test(artifact) || /^question-\d+\.json$/.test(artifact)) {
    return { node: "discoverReader", round: 0 }
  }

  if ((match = artifact.match(/^draft-round-(\d+)-readability-(\d+)\.md$/))) {
    return { node: "reviseReadability", round: Number.parseInt(match[1]!, 10) }
  }

  if ((match = artifact.match(/^readability-round-(\d+)-try-(\d+)\.json$/))) {
    return { node: "scoreReadability", round: Number.parseInt(match[1]!, 10) }
  }

  if ((match = artifact.match(/^draft-round-(\d+)\.md$/))) {
    const draftRound = Number.parseInt(match[1]!, 10)
    if (draftRound === 0) return { node: "draftFullDraft", round: 0 }
    return { node: "reviseDraft", round: draftRound - 1 }
  }

  if ((match = artifact.match(/^audit-[\w-]+-round-(\d+)\.json$/))) {
    return { node: "runParallelAudits", round: Number.parseInt(match[1]!, 10) }
  }

  if ((match = artifact.match(/^drafter-finding-review-round-(\d+)\.json$/))) {
    return { node: "reviewFindingsByDrafter", round: Number.parseInt(match[1]!, 10) }
  }

  if ((match = artifact.match(/^rebuttals-[\w-]+-round-(\d+)\.json$/))) {
    return { node: "runTargetedRebuttals", round: Number.parseInt(match[1]!, 10) }
  }

  if ((match = artifact.match(/^auditor-rebuttal-responses-[\w-]+-round-(\d+)\.json$/))) {
    return { node: "runTargetedRebuttals", round: Number.parseInt(match[1]!, 10) }
  }

  if ((match = artifact.match(/^drafter-rebuttal-review-round-(\d+)/))) {
    return { node: "reviewRebuttalResponses", round: Number.parseInt(match[1]!, 10) }
  }

  if (artifact === "artifact-summary.json" || artifact === "summary.json") {
    return { node: "summarizeOutputArtifact", round: 0 }
  }

  return {}
}

function inferScopeFromRole(role: string): CursorCallScope {
  switch (role) {
    case "reader-interviewer":
    case "reader-profile-repairer":
      return { node: "discoverReader", round: 0 }
    case DESIGNER_ROLE:
      return { node: "runDesignHtml", round: 0 }
    case GRAPHICAL_ENHANCER_ROLE:
    case LEGACY_INTERACTIVE_ENHANCER_ROLE:
      return { node: "graphicalEnhance", round: 0 }
    case READING_EXPERIENCE_ENHANCER_ROLE:
      return { node: "readingExperienceEnhance", round: 0 }
    case HTML_REVIEWER_ROLE:
      return { node: "htmlReview", round: 0 }
    case SUMMARIZER_ROLE:
      return { node: "summarizeOutputArtifact", round: 0 }
    case "source-auditor":
    case "logic-auditor":
    case "clarity-auditor":
      return { node: "runParallelAudits" }
    default:
      return {}
  }
}
