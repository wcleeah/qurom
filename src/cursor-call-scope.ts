import { basename } from "node:path"

import {
  designHtmlRoleFromFilename,
  INTERACTIVE_ENHANCER_ROLE,
  LEGACY_DESIGN_HTML_ROUND_RE,
  READING_EXPERIENCE_ENHANCER_ROLE,
} from "./design-artifacts"
import { DESIGNER_ROLE } from "./role-registry"

export type CursorCallScope = {
  node?: string
  round?: number
}

/** Infer graph node + round from a Cursor call's output artifact and agent role. */
export function inferCursorCallScope(input: {
  role: string
  artifact?: string
}): CursorCallScope {
  const artifact = basename((input.artifact ?? "").trim())
  if (artifact) {
    const fromArtifact = inferScopeFromArtifact(artifact, input.role)
    if (fromArtifact.node) return fromArtifact
  }
  return inferScopeFromRole(input.role)
}

function designNodeForRole(role: string): string | undefined {
  switch (role) {
    case DESIGNER_ROLE:
      return "runDesignHtml"
    case INTERACTIVE_ENHANCER_ROLE:
      return "interactiveEnhance"
    case READING_EXPERIENCE_ENHANCER_ROLE:
      return "readingExperienceEnhance"
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

  return {}
}

function inferScopeFromRole(role: string): CursorCallScope {
  switch (role) {
    case "reader-interviewer":
    case "reader-profile-repairer":
      return { node: "discoverReader", round: 0 }
    case DESIGNER_ROLE:
      return { node: "runDesignHtml", round: 0 }
    case INTERACTIVE_ENHANCER_ROLE:
      return { node: "interactiveEnhance", round: 0 }
    case READING_EXPERIENCE_ENHANCER_ROLE:
      return { node: "readingExperienceEnhance", round: 0 }
    case "source-auditor":
    case "logic-auditor":
    case "clarity-auditor":
      return { node: "runParallelAudits" }
    default:
      return {}
  }
}
