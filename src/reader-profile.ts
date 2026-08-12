import type { ReaderCalibrationProfile } from "./schema"

export function formatReaderProfileForPrompt(profile: ReaderCalibrationProfile | undefined): string {
  if (!profile) return "(none yet — synthesize a best-effort profile from the topic context and your first question plan)"

  const lines: string[] = []
  lines.push(`Primary goal: ${profile.intent.goal}`)
  if (profile.intent.secondaryGoals.length > 0) {
    lines.push(`Secondary goals: ${profile.intent.secondaryGoals.join("; ")}`)
  }
  lines.push(`Depth: ${profile.intent.depth}`)
  if (profile.intent.format) lines.push(`Format: ${profile.intent.format}`)
  lines.push(`Background: ${profile.background.summary}`)
  lines.push(
    `In-topic (${profile.competence.inTopic.level}): ${profile.competence.inTopic.summary}`,
  )
  if (profile.competence.inTopic.evidence.length > 0) {
    lines.push(`In-topic evidence: ${profile.competence.inTopic.evidence.join("; ")}`)
  }
  lines.push(`Adjacent: ${profile.competence.adjacent.summary}`)
  if (profile.competence.adjacent.evidence.length > 0) {
    lines.push(`Adjacent evidence: ${profile.competence.adjacent.evidence.join("; ")}`)
  }
  if (profile.inferredGaps.length > 0) {
    lines.push("Inferred gaps:")
    for (const gap of profile.inferredGaps) {
      lines.push(`- ${gap.concept} (${gap.treatment}): ${gap.rationale}`)
    }
  } else {
    lines.push("Inferred gaps: (none yet)")
  }
  return lines.join("\n")
}

export function readerContextBlock(profile: ReaderCalibrationProfile | undefined): string {
  if (!profile) return ""

  const lines: string[] = []
  lines.push(`Reader primary goal: ${profile.intent.goal}`)
  if (profile.intent.secondaryGoals.length > 0) {
    lines.push(
      `Reader secondary goals (must still serve, as consequences of the primary throughline — not peer chapters): ${profile.intent.secondaryGoals.join("; ")}`,
    )
    lines.push(
      "Structure the document around the primary goal. Serve secondary goals via worked examples, layouts, checklists, or success criteria hanging off that spine. Do not drop them; do not give each equal top-level weight.",
    )
  }
  lines.push(`Desired depth: ${profile.intent.depth}`)
  if (profile.intent.format) lines.push(`Preferred format: ${profile.intent.format}`)
  lines.push(`Background: ${profile.background.summary}`)
  lines.push(
    `In-topic level (${profile.competence.inTopic.level}): ${profile.competence.inTopic.summary}`,
  )
  if (profile.competence.adjacent.summary.trim()) {
    lines.push(`Adjacent experience: ${profile.competence.adjacent.summary}`)
  }

  const mustExplain = profile.inferredGaps.filter((g) => g.treatment === "must-explain").map((g) => g.concept)
  const briefRecap = profile.inferredGaps.filter((g) => g.treatment === "brief-recap").map((g) => g.concept)
  const canAssume = profile.inferredGaps.filter((g) => g.treatment === "can-assume").map((g) => g.concept)

  if (canAssume.length > 0) {
    lines.push(`Reader already knows (do not re-teach): ${canAssume.join(", ")}`)
  }
  if (mustExplain.length > 0) {
    lines.push(`Must ground once in the throughline (true priors / unknown concepts): ${mustExplain.join(", ")}.`)
  }
  if (briefRecap.length > 0) {
    lines.push(`Brief recap at first use only: ${briefRecap.join(", ")}.`)
  }
  if (mustExplain.length > 0 || briefRecap.length > 0) {
    lines.push(
      "Do not add a separate Prerequisites section. Do not explain the same concept fully twice.",
    )
  }

  return lines.join("\n")
}

/**
 * Enforce intent-only repair: take goal / secondaryGoals / format from the
 * repaired profile, preserve depth and everything outside intent from the original.
 */
export function applyIntentOnlyRepair(
  original: ReaderCalibrationProfile,
  repaired: {
    intent: {
      goal: string
      secondaryGoals?: string[]
      depth: ReaderCalibrationProfile["intent"]["depth"]
      format?: string
    }
  },
): ReaderCalibrationProfile {
  return {
    ...original,
    intent: {
      goal: repaired.intent.goal,
      secondaryGoals: repaired.intent.secondaryGoals ?? [],
      depth: original.intent.depth,
      format: repaired.intent.format ?? original.intent.format,
    },
  }
}
