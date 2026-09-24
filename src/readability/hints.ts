import type { ReadabilityHotspot } from "./schema"

export function formatReadabilityLineSpan(startLine?: number, endLine?: number): string | undefined {
  if (typeof startLine !== "number" || typeof endLine !== "number") return undefined
  const lo = Math.min(startLine, endLine)
  const hi = Math.max(startLine, endLine)
  if (lo === hi) return `line ${lo}`
  return `lines ${lo}–${hi}`
}

type HintGroup = {
  unitId: string
  section: string
  startLine?: number
  endLine?: number
  notes: Array<{
    criterion: ReadabilityHotspot["criterion"]
    score: number
    confidence: number
    remedy: ReadabilityHotspot["remedy"]
  }>
}

function formatHintNumber(value: number) {
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
}

function groupHotspots(hotspots: ReadabilityHotspot[]): HintGroup[] {
  const groups: HintGroup[] = []
  const byId = new Map<string, HintGroup>()
  for (const hotspot of hotspots) {
    let group = byId.get(hotspot.unitId)
    if (!group) {
      group = {
        unitId: hotspot.unitId,
        section: hotspot.section,
        startLine: hotspot.startLine,
        endLine: hotspot.endLine,
        notes: [],
      }
      byId.set(hotspot.unitId, group)
      groups.push(group)
    }
    group.notes.push({
      criterion: hotspot.criterion,
      score: hotspot.score,
      confidence: hotspot.confidence,
      remedy: hotspot.remedy,
    })
  }
  groups.sort((a, b) => {
    const aLine = a.endLine ?? a.startLine ?? 0
    const bLine = b.endLine ?? b.startLine ?? 0
    return bLine - aLine
  })
  return groups
}

export function formatReadabilityHints(hotspots: ReadabilityHotspot[]): string {
  if (hotspots.length === 0) return ""

  const bullets = groupHotspots(hotspots).map((group) => {
    const section = group.section.trim() || "Untitled"
    const span = formatReadabilityLineSpan(group.startLine, group.endLine)
    const location = span ? `${section} — ${span}` : section
    const notes = group.notes.map((note) => {
      const score = formatHintNumber(note.score)
      const conf = formatHintNumber(note.confidence)
      return `${note.criterion} ${score} (conf ${conf}); remedy: ${note.remedy}`
    }).join("; ")
    return `- [${group.unitId}] ${location} — ${notes}`
  })

  return [
    "## Readability review",
    "",
    "Local processing notes. Ignore one when the marked style is doing work. Read every listed span in the working markdown file first, then edit. Work from the bottom of the file so line numbers stay valid. Do not guess the passage from this prompt.",
    "",
    "Remedy: unnest = flatten clauses, keep the paragraph; split = more than one move; uninvert = restore subject–verb order; simplify_words = same claim, plainer diction; lower_register = drop performative formality only.",
    "",
    ...bullets,
  ].join("\n")
}
