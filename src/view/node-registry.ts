import {
  designHtmlArtifactName,
  designHtmlArtifactNames,
  DESIGNER_ROLE,
  GRAPHICAL_ENHANCER_ROLE,
  isDesignHtmlArtifact,
  LEGACY_DESIGN_HTML_ROUND_RE,
  presentDesignHtmlArtifact,
  READING_EXPERIENCE_ENHANCER_ROLE,
} from "../design-artifacts"
import { indexRunArtifacts, roundHasRebuttals, type RoundArtifacts, type RunArtifactIndex } from "./run-artifacts"
import type { LiveStatus, RunStatus } from "./types"

export type NodePhase = "setup" | "research" | "design"

export type NodeDefinition = {
  id: string
  label: string
  order: number
  phase: NodePhase
  pipelineLabel?: string
  miniLabel?: string
  liveNodeAliases?: string[]
  filePatterns: RegExp[]
  roundScoped: boolean
  turnScoped?: boolean
}

export const GRAPH_NODES: NodeDefinition[] = [
  { id: "ingestRequest", label: "Ingest request", order: 1, phase: "setup", filePatterns: [/^request\.json$/], roundScoped: false },
  { id: "summarizeInputDocument", label: "Summarize input", order: 2, phase: "setup", filePatterns: [], roundScoped: false },
  { id: "prepareOutputPath", label: "Prepare output", order: 3, phase: "setup", filePatterns: [], roundScoped: false },
  {
    id: "discoverReader",
    label: "Discover reader",
    miniLabel: "Reader",
    order: 4,
    phase: "setup",
    pipelineLabel: "discoverReader",
    liveNodeAliases: ["discoverReaderPrompt", "discoverReaderResume"],
    filePatterns: [/^reader-profile\.json$/, /^question-\d+\.json$/, /^reply-\d+\.json$/],
    roundScoped: false,
  },
  {
    id: "draftFullDraft",
    label: "Draft",
    miniLabel: "Draft",
    order: 5,
    phase: "research",
    filePatterns: [/^draft-round-\d+\.md$/],
    roundScoped: true,
  },
  {
    id: "runParallelAudits",
    label: "Parallel audits",
    order: 6,
    phase: "research",
    filePatterns: [/^audits-round-\d+\.json$/, /^audit-[\w-]+-round-\d+\.json$/],
    roundScoped: true,
  },
  {
    id: "reviewFindingsByDrafter",
    label: "Review Findings",
    miniLabel: "Review Findings",
    order: 7,
    phase: "research",
    filePatterns: [/^drafter-finding-review-round-\d+\.json$/],
    roundScoped: true,
  },
  {
    id: "runTargetedRebuttals",
    label: "Write Rebuttals",
    order: 8,
    phase: "research",
    filePatterns: [
      /^auditor-rebuttal-responses-round-\d+-turn-\d+\.json$/,
      /^auditor-rebuttal-responses-[\w-]+-round-\d+\.json$/,
      /^rebuttals-[\w-]+-round-\d+\.json$/,
    ],
    roundScoped: true,
    turnScoped: true,
  },
  {
    id: "reviewRebuttalResponses",
    label: "Rebuttals",
    miniLabel: "Rebuttals",
    order: 9,
    phase: "research",
    liveNodeAliases: ["runTargetedRebuttals"],
    filePatterns: [/^drafter-rebuttal-review-round-\d+-turn-\d+\.json$/, /^disputed-round-\d+\.json$/],
    roundScoped: true,
    turnScoped: true,
  },
  {
    id: "aggregateConsensus",
    label: "Aggregate Consensus",
    miniLabel: "Aggregate Consensus",
    order: 10,
    phase: "research",
    filePatterns: [/^aggregated-findings-round-\d+\.json$/],
    roundScoped: true,
  },
  {
    id: "computeConfidence",
    label: "Compute confidence",
    order: 11,
    phase: "research",
    filePatterns: [/^confidence\.json$/],
    roundScoped: false,
  },
  {
    id: "reviseDraft",
    label: "Revise draft",
    order: 12,
    phase: "research",
    filePatterns: [/^unresolved-findings-round-\d+\.json$/],
    roundScoped: true,
  },
  {
    id: "finalizeApprovedDraft",
    label: "Finalize approved",
    order: 13,
    phase: "research",
    liveNodeAliases: ["finalizeFailedRun"],
    filePatterns: [/^final\.md$/, /^latest-draft\.md$/, /^failure\.json$/],
    roundScoped: false,
  },
  {
    id: "summarizeOutputArtifact",
    label: "Summarize output",
    order: 14,
    phase: "research",
    filePatterns: [/^summary\.json$/],
    roundScoped: false,
  },
  {
    id: "runDesignHtml",
    label: "Design HTML",
    miniLabel: "Design",
    order: 15,
    phase: "design",
    filePatterns: [
      new RegExp(`^${designHtmlArtifactName(DESIGNER_ROLE).replace(/\./g, "\\.")}$`),
      LEGACY_DESIGN_HTML_ROUND_RE,
    ],
    roundScoped: false,
  },
  {
    id: "graphicalEnhance",
    label: "Graphical enhance",
    miniLabel: "Graphics",
    order: 16,
    phase: "design",
    liveNodeAliases: ["interactiveEnhance"],
    filePatterns: designHtmlArtifactNames(GRAPHICAL_ENHANCER_ROLE).map(
      (name) => new RegExp(`^${name.replace(/\./g, "\\.")}$`),
    ),
    roundScoped: false,
  },
  {
    id: "readingExperienceEnhance",
    label: "Reading experience",
    miniLabel: "Reading",
    order: 17,
    phase: "design",
    filePatterns: [new RegExp(`^${designHtmlArtifactName(READING_EXPERIENCE_ENHANCER_ROLE).replace(/\./g, "\\.")}$`)],
    roundScoped: false,
  },
  {
    id: "finalizeDesign",
    label: "Finalize design",
    order: 18,
    phase: "design",
    filePatterns: [/^final\.html$/, /^design-failure\.json$/],
    roundScoped: false,
  },
]

const DESIGN_PHASE_NODE: Record<string, string> = {
  drafting: "runDesignHtml",
  enhancing: "graphicalEnhance",
  reading: "readingExperienceEnhance",
  finalizing: "finalizeDesign",
}

export const REBUTTALS_VIEWER_NODE_ID = "reviewRebuttalResponses"

export function isRebuttalsViewerNode(nodeId: string): boolean {
  return nodeId === "runTargetedRebuttals" || nodeId === REBUTTALS_VIEWER_NODE_ID
}

export function rebuttalsTelemetryNodeId(_nodeId?: string): string {
  return REBUTTALS_VIEWER_NODE_ID
}

export function getNodeDefinition(nodeId: string): NodeDefinition | undefined {
  return GRAPH_NODES.find((n) => n.id === nodeId || n.pipelineLabel === nodeId)
    ?? GRAPH_NODES.find((n) => n.liveNodeAliases?.includes(nodeId))
}

export function resolveLiveNode(liveStatus: LiveStatus | null): string | undefined {
  if (!liveStatus?.node) return undefined
  const raw = liveStatus.node
  if (raw.startsWith("design:")) {
    const phase = raw.replace(/^design:\s*/, "").split(/\s+/)[0]
    if (phase && DESIGN_PHASE_NODE[phase]) return DESIGN_PHASE_NODE[phase]
    if (raw.includes("drafting")) return "runDesignHtml"
    if (raw.includes("enhancing") || raw.includes("graphical")) return "graphicalEnhance"
    if (raw.includes("reading")) return "readingExperienceEnhance"
    if (raw.includes("finalizing")) return "finalizeDesign"
  }
  const def = getNodeDefinition(raw)
  return def?.id ?? raw
}

export function isNodeActive(liveStatus: LiveStatus | null, nodeId: string): boolean {
  if (!liveStatus?.node) return false
  const def = getNodeDefinition(nodeId)
  if (def?.liveNodeAliases?.includes(liveStatus.node)) return true
  if (def?.pipelineLabel && liveStatus.node === def.pipelineLabel) return true
  if (resolveLiveNode(liveStatus) === nodeId) return true
  return liveStatus.node === nodeId
}

export function filesForRebuttalsViewer(files: string[], index?: RunArtifactIndex, round?: number): string[] {
  if (round === undefined) {
    return [...new Set([
      ...filesForNode("runTargetedRebuttals", files, index),
      ...filesForNode(REBUTTALS_VIEWER_NODE_ID, files, index),
    ])].sort()
  }
  const artifactIndex = index ?? indexRunArtifacts(files)
  return [...new Set([
    ...filesForNodeRound("runTargetedRebuttals", files, artifactIndex, round),
    ...filesForNodeRound(REBUTTALS_VIEWER_NODE_ID, files, artifactIndex, round),
  ])].sort()
}

export function filesForNode(nodeId: string, files: string[], index?: RunArtifactIndex): string[] {
  const def = getNodeDefinition(nodeId)
  if (!def) return []
  const artifactIndex = index ?? indexRunArtifacts(files)
  const matched = files.filter((f) => def.filePatterns.some((p) => p.test(f)))
  if (!def.roundScoped) return matched.sort()

  const roundFiles: string[] = []
  for (const round of artifactIndex.rounds) {
    if (nodeId === "draftFullDraft" && round.draft) roundFiles.push(round.draft)
    if (nodeId === "runParallelAudits") {
      if (round.audits) roundFiles.push(round.audits)
      roundFiles.push(...round.perAgentAudits)
    }
    if (nodeId === "reviewFindingsByDrafter" && round.review) roundFiles.push(round.review)
    if (nodeId === "runTargetedRebuttals") {
      for (const turn of round.rebuttalTurns) {
        if (turn.responses) roundFiles.push(turn.responses)
        roundFiles.push(...turn.perAgentResponses)
      }
      roundFiles.push(...round.perAgentRebuttalInputs)
    }
    if (nodeId === "reviewRebuttalResponses") {
      if (round.disputed) roundFiles.push(round.disputed)
      for (const turn of round.rebuttalTurns) {
        if (turn.drafterReview) roundFiles.push(turn.drafterReview)
      }
    }
    if (nodeId === "aggregateConsensus" && round.consensus) roundFiles.push(round.consensus)
    if (nodeId === "reviseDraft" && round.unresolved) roundFiles.push(round.unresolved)
  }
  return [...new Set([...matched, ...roundFiles])].sort()
}

export function filesForNodeRound(
  nodeId: string,
  files: string[],
  index: RunArtifactIndex,
  round: number,
): string[] {
  const def = getNodeDefinition(nodeId)
  if (!def) return []
  if (!def.roundScoped) return filesForNode(nodeId, files, index)

  const roundArt = index.rounds.find((entry) => entry.round === round)
  const roundFiles: string[] = []
  if (roundArt) {
    if (nodeId === "draftFullDraft" && roundArt.draft) roundFiles.push(roundArt.draft)
    if (nodeId === "runParallelAudits") {
      if (roundArt.audits) roundFiles.push(roundArt.audits)
      roundFiles.push(...roundArt.perAgentAudits)
    }
    if (nodeId === "reviewFindingsByDrafter" && roundArt.review) roundFiles.push(roundArt.review)
    if (nodeId === "runTargetedRebuttals") {
      for (const turn of roundArt.rebuttalTurns) {
        if (turn.responses) roundFiles.push(turn.responses)
        roundFiles.push(...turn.perAgentResponses)
      }
      roundFiles.push(...roundArt.perAgentRebuttalInputs)
    }
    if (nodeId === "reviewRebuttalResponses") {
      if (roundArt.disputed) roundFiles.push(roundArt.disputed)
      for (const turn of roundArt.rebuttalTurns) {
        if (turn.drafterReview) roundFiles.push(turn.drafterReview)
      }
    }
    if (nodeId === "aggregateConsensus" && roundArt.consensus) roundFiles.push(roundArt.consensus)
    if (nodeId === "reviseDraft" && roundArt.unresolved) roundFiles.push(roundArt.unresolved)
  }

  const matched = files.filter((f) => {
    if (!def.filePatterns.some((p) => p.test(f))) return false
    const fileRound = roundFromFilename(f)
    return fileRound === undefined || fileRound === round
  })

  return [...new Set([...matched, ...roundFiles])].sort()
}

function roundFromFilename(filename: string): number | undefined {
  const match = filename.match(/round-(\d+)/)
  if (!match?.[1]) return undefined
  return parseInt(match[1], 10)
}

export type NodeKpi = { label: string; value: string }

export function nodeKpis(nodeId: string, files: string[], index?: RunArtifactIndex): NodeKpi[] {
  const artifactIndex = index ?? indexRunArtifacts(files)
  const kpis: NodeKpi[] = []

  switch (nodeId) {
    case "discoverReader": {
      const profiles = files.filter((f) => /^reader-profile\.json$/.test(f) || /^question-\d+\.json$/.test(f))
      kpis.push({ label: "Profiles", value: String(profiles.length) })
      break
    }
    case "draftFullDraft": {
      const drafts = files.filter((f) => /^draft-round-\d+\.md$/.test(f))
      kpis.push({ label: "Rounds", value: String(drafts.length) })
      break
    }
    case "runParallelAudits": {
      const bundles = files.filter((f) => /^audits-round-\d+\.json$/.test(f))
      kpis.push({ label: "Audit rounds", value: String(bundles.length) })
      break
    }
    case "reviewFindingsByDrafter":
    case "runTargetedRebuttals":
    case "reviewRebuttalResponses":
    case "aggregateConsensus":
      return []
    case "runDesignHtml": {
      const html = files.filter((f) => isDesignHtmlArtifact(f))
      kpis.push({ label: "HTML drafts", value: String(html.length) })
      break
    }
    case "finalizeDesign": {
      if (files.includes("final.html")) kpis.push({ label: "Output", value: "final.html" })
      break
    }
    default:
      break
  }

  const nodeFiles = filesForNode(nodeId, files, artifactIndex)
  if (nodeFiles.length > 0 && kpis.length === 0) {
    kpis.push({ label: "Artifacts", value: String(nodeFiles.length) })
  }
  return kpis
}

function roundArtifactExists(files: string[], pattern: RegExp, round: number): boolean {
  return files.some((f) => {
    const m = f.match(pattern)
    if (!m?.[1]) return false
    return parseInt(m[1], 10) <= round
  })
}

/** Mirrors pipeline completion heuristics — not all nodes write dedicated artifacts. */
export function isNodeComplete(
  nodeId: string,
  files: string[],
  researchStatus: RunStatus,
  liveStatus: LiveStatus | null,
  index?: RunArtifactIndex,
): boolean {
  if (isNodeActive(liveStatus, nodeId)) return false

  const artifactIndex = index ?? indexRunArtifacts(files)
  const currentRound = liveStatus?.phase === "running" ? liveStatus.round : artifactIndex.maxRound
  const hasAnyFile = files.length > 0
  const hasFile = (pattern: RegExp) => files.some((f) => pattern.test(f))
  const hasReaderProfile = hasFile(/^reader-profile\.json$/)
  const researchDone = researchStatus === "approved" || researchStatus === "failed"

  switch (nodeId) {
    case "ingestRequest":
      return true
    case "summarizeInputDocument":
      return researchStatus !== "running" || hasAnyFile
    case "prepareOutputPath":
      return hasAnyFile
    case "discoverReader":
      return hasReaderProfile && !isNodeActive(liveStatus, "discoverReader")
    case "draftFullDraft":
      return hasFile(/^draft-round-\d+\.md$/)
    case "runParallelAudits":
      return currentRound >= 0
        && roundArtifactExists(files, /^audits-round-(\d+)\.json$/, currentRound)
        && hasFile(/^audits-round-\d+\.json$/)
    case "reviewFindingsByDrafter":
      return currentRound >= 0
        && roundArtifactExists(files, /^drafter-finding-review-round-(\d+)\.json$/, currentRound)
        && hasFile(/^drafter-finding-review-round-\d+\.json$/)
    case "runTargetedRebuttals":
      return hasFile(/^auditor-rebuttal-responses-round-\d+-turn-\d+\.json$/)
        || hasFile(/^auditor-rebuttal-responses-[\w-]+-round-\d+\.json$/)
    case "reviewRebuttalResponses":
      return hasFile(/^drafter-rebuttal-review-round-\d+-turn-\d+\.json$/)
    case "aggregateConsensus":
      return currentRound >= 0
        && roundArtifactExists(files, /^aggregated-findings-round-(\d+)\.json$/, currentRound)
        && hasFile(/^aggregated-findings-round-\d+\.json$/)
    case "computeConfidence":
      return hasFile(/^confidence\.json$/) || (
        currentRound >= 0
        && roundArtifactExists(files, /^aggregated-findings-round-(\d+)\.json$/, currentRound)
        && hasFile(/^aggregated-findings-round-\d+\.json$/)
      )
    case "reviseDraft":
      return researchDone
    case "finalizeApprovedDraft":
    case "finalizeFailedRun":
      return researchDone
    case "summarizeOutputArtifact":
      return hasFile(/^final\.md$/) || hasFile(/^latest-draft\.md$/)
    case "runDesignHtml":
      return files.some((f) => f === designHtmlArtifactName(DESIGNER_ROLE) || LEGACY_DESIGN_HTML_ROUND_RE.test(f))
    case "graphicalEnhance":
    case "interactiveEnhance":
      return presentDesignHtmlArtifact(GRAPHICAL_ENHANCER_ROLE, files) !== undefined
        || files.some((f) => LEGACY_DESIGN_HTML_ROUND_RE.test(f))
    case "readingExperienceEnhance":
      return files.includes(designHtmlArtifactName(READING_EXPERIENCE_ENHANCER_ROLE))
    case "finalizeDesign":
      return hasFile(/^final\.html$/)
    default:
      return filesForNode(nodeId, files, artifactIndex).length > 0
  }
}

export function roundStepComplete(step: keyof RoundArtifacts | "rebuttals", round: RoundArtifacts): boolean {
  switch (step) {
    case "draft":
      return !!round.draft
    case "audits":
      return !!round.audits
    case "review":
      return !!round.review
    case "rebuttals":
      return roundHasRebuttals(round)
    case "consensus":
      return !!round.consensus
    case "unresolved":
      return !!round.unresolved
    default:
      return false
  }
}
