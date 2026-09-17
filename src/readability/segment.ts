export type SegmentedUnit = {
  id: string
  section: string
  quote: string
  before: string
  after: string
}

const MIN_PROSE_CHARS = 40

function isFence(line: string) {
  return /^```/.test(line.trim())
}

function isTableLine(line: string) {
  const trimmed = line.trim()
  return trimmed.startsWith("|") && trimmed.includes("|", 1)
}

function isHeading(line: string) {
  return /^#{1,6}\s+\S/.test(line.trim())
}

function headingText(line: string) {
  return line.trim().replace(/^#{1,6}\s+/, "").trim()
}

function isSourcesHeading(text: string) {
  return /^sources\b/i.test(text)
}

function isSkippableParagraph(text: string) {
  const collapsed = text.replace(/\s+/g, " ").trim()
  if (collapsed.length < MIN_PROSE_CHARS) return true
  if (/^[-*+]\s+\S+$/.test(collapsed)) return true
  return false
}

export function segmentDraft(markdown: string): SegmentedUnit[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const paragraphs: Array<{ section: string; sectionIndex: number; quote: string }> = []
  let section = ""
  let sectionIndex = 0
  let inFence = false
  let inTable = false
  let pastSources = false
  let buffer: string[] = []

  const flush = () => {
    const quote = buffer.join("\n").trim()
    buffer = []
    if (!quote || pastSources) return
    if (isSkippableParagraph(quote)) return
    paragraphs.push({ section, sectionIndex, quote })
  }

  for (const line of lines) {
    if (isFence(line)) {
      flush()
      inFence = !inFence
      inTable = false
      continue
    }
    if (inFence || pastSources) continue

    if (isHeading(line)) {
      flush()
      inTable = false
      const text = headingText(line)
      if (isSourcesHeading(text)) {
        pastSources = true
        continue
      }
      section = text
      sectionIndex += 1
      continue
    }

    if (isTableLine(line)) {
      flush()
      inTable = true
      continue
    }
    if (inTable) {
      if (line.trim() === "") inTable = false
      else continue
    }

    if (line.trim() === "") {
      flush()
      continue
    }
    buffer.push(line)
  }
  flush()

  const counts = new Map<number, number>()
  return paragraphs.map((paragraph, index) => {
    const nextCount = (counts.get(paragraph.sectionIndex) ?? 0) + 1
    counts.set(paragraph.sectionIndex, nextCount)
    return {
      id: `s${paragraph.sectionIndex}-p${nextCount}`,
      section: paragraph.section,
      quote: paragraph.quote,
      before: paragraphs[index - 1]?.quote ?? "",
      after: paragraphs[index + 1]?.quote ?? "",
    }
  })
}
