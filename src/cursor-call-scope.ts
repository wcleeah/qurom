import { basename } from "node:path"

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

function inferScopeFromArtifact(artifact: string, role: string): CursorCallScope {
  let match: RegExpMatchArray | null

  if ((match = artifact.match(/^design-html-round-(\d+)\.html$/))) {
    const round = Number.parseInt(match[1]!, 10)
    if (role === "interactive-enhancer") return { node: "interactiveEnhance", round }
    return { node: "runDesignHtml", round }
  }

  if (artifact === "final.html") {
    return { node: "finalizeDesign", round: 0 }
  }

  if (/^reader-profile(?:-\d+)?\.json$/.test(artifact)) {
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
      return { node: "discoverReader", round: 0 }
    case "html-designer":
      return { node: "runDesignHtml", round: 0 }
    case "interactive-enhancer":
      return { node: "interactiveEnhance", round: 0 }
    case "source-auditor":
    case "logic-auditor":
    case "clarity-auditor":
      return { node: "runParallelAudits" }
    default:
      return {}
  }
}
