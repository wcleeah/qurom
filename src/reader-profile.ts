import type { ReaderCalibrationProfile } from "./schema"

export function formatReaderProfileForPrompt(profile: ReaderCalibrationProfile | undefined): string {
  if (!profile) return "(none yet — synthesize a best-effort profile from the topic context and your first question plan)"

  const lines: string[] = []
  lines.push(`Goal: ${profile.intent.goal}`)
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
  lines.push(`Reader goal: ${profile.intent.goal}`)
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
  const prereqConcepts = [...mustExplain, ...briefRecap]
  if (prereqConcepts.length > 0) {
    lines.push(`Include a Prerequisites section covering: ${prereqConcepts.join(", ")}.`)
    if (mustExplain.length > 0) {
      lines.push(`Explain fully before the main topic: ${mustExplain.join(", ")}.`)
    }
    if (briefRecap.length > 0) {
      lines.push(`Brief recap only in Prerequisites: ${briefRecap.join(", ")}.`)
    }
  }

  return lines.join("\n")
}
