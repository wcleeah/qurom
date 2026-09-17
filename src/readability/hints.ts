import type { ReadabilityHotspot } from "./schema"

function firstLineQuote(quote: string, maxChars = 180) {
  const collapsed = quote.replace(/\s+/g, " ").trim()
  if (collapsed.length <= maxChars) return collapsed
  return `${collapsed.slice(0, maxChars).trimEnd()}…`
}

export function formatReadabilityHints(hotspots: ReadabilityHotspot[]): string {
  if (hotspots.length === 0) return ""

  const bullets = hotspots.map((hotspot) => {
    const section = hotspot.section.trim() || "Untitled"
    const score = hotspot.score.toFixed(2).replace(/\.00$/, "")
    const conf = hotspot.confidence.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
    return `- [${hotspot.unitId}] ${section} — ${hotspot.criterion} ${score} (conf ${conf}); remedy: ${hotspot.remedy}\n  ${firstLineQuote(hotspot.quote)}`
  })

  return [
    "## Readability review",
    "",
    "Local processing notes. Ignore one when the marked style is doing work.",
    "",
    "Remedy: unnest = flatten clauses, keep the paragraph; split = more than one move; uninvert = restore subject–verb order; simplify_words = same claim, plainer diction; lower_register = drop performative formality only.",
    "",
    ...bullets,
  ].join("\n")
}
