export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

export const LIBRARY_NOTE_KINDS = ["page", "highlight"] as const
export type LibraryNoteKind = (typeof LIBRARY_NOTE_KINDS)[number]

export interface LibraryNote {
  id: string
  kind: LibraryNoteKind
  runName: string
  filePath: string
  body: string
  quote: string | null
  prefix: string
  suffix: string
  color: HighlightColor | null
  createdAt: string
  updatedAt: string
}

export interface LibrarySource {
  runName: string
  filePath: string
  topic: string | null
  alive: boolean
}

/** HTML viewer / legacy API shape for highlight rows. */
export interface HtmlReaderHighlight {
  id: string
  runName: string
  filePath: string
  color: HighlightColor
  quote: string
  prefix: string
  suffix: string
  note: string
  createdAt: string
  updatedAt: string
}

export const HIGHLIGHT_COLOR_RGBA: Record<HighlightColor, string> = {
  yellow: "rgba(255, 235, 59, 0.55)",
  green: "rgba(134, 239, 172, 0.55)",
  blue: "rgba(147, 197, 253, 0.55)",
  pink: "rgba(244, 114, 182, 0.45)",
}

export function isHighlightColor(value: string): value is HighlightColor {
  return (HIGHLIGHT_COLORS as readonly string[]).includes(value)
}

export function libraryNoteToHighlight(note: LibraryNote): HtmlReaderHighlight {
  return {
    id: note.id,
    runName: note.runName,
    filePath: note.filePath,
    color: note.color ?? "yellow",
    quote: note.quote ?? "",
    prefix: note.prefix,
    suffix: note.suffix,
    note: note.body,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }
}
