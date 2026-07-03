import { nowIso, validateHtmlReaderTarget, withHtmlReaderDb } from "./html-reader-db"

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

export interface HtmlReaderHighlight {
  id: string
  runName: string
  filePath: string
  color: HighlightColor
  quote: string
  prefix: string
  suffix: string
  createdAt: string
  updatedAt: string
}

export const HIGHLIGHT_COLOR_RGBA: Record<HighlightColor, string> = {
  yellow: "rgba(255, 235, 59, 0.55)",
  green: "rgba(134, 239, 172, 0.55)",
  blue: "rgba(147, 197, 253, 0.55)",
  pink: "rgba(244, 114, 182, 0.45)",
}

function isHighlightColor(value: string): value is HighlightColor {
  return (HIGHLIGHT_COLORS as readonly string[]).includes(value)
}

function rowToHighlight(row: {
  id: string
  run_name: string
  file_path: string
  color: string
  quote: string
  prefix: string
  suffix: string
  created_at: string
  updated_at: string
}): HtmlReaderHighlight {
  return {
    id: row.id,
    runName: row.run_name,
    filePath: row.file_path,
    color: isHighlightColor(row.color) ? row.color : "yellow",
    quote: row.quote,
    prefix: row.prefix,
    suffix: row.suffix,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listHtmlReaderHighlights(
  runName: string,
  filePath: string,
): Promise<HtmlReaderHighlight[]> {
  validateHtmlReaderTarget(runName, filePath)
  return withHtmlReaderDb((db) => {
    const rows = db.query<
      {
        id: string
        run_name: string
        file_path: string
        color: string
        quote: string
        prefix: string
        suffix: string
        created_at: string
        updated_at: string
      },
      [string, string]
    >(
      `SELECT id, run_name, file_path, color, quote, prefix, suffix, created_at, updated_at
       FROM html_reader_highlights
       WHERE run_name = ? AND file_path = ?
       ORDER BY created_at ASC`,
    ).all(runName, filePath)
    return rows.map(rowToHighlight)
  })
}

export async function createHtmlReaderHighlight(input: {
  runName: string
  filePath: string
  color: string
  quote: string
  prefix?: string
  suffix?: string
}): Promise<HtmlReaderHighlight> {
  validateHtmlReaderTarget(input.runName, input.filePath)
  const quote = input.quote.trim()
  if (!quote) {
    throw new Error("Highlight quote is required")
  }
  if (!isHighlightColor(input.color)) {
    throw new Error("Invalid highlight color")
  }
  const id = crypto.randomUUID()
  const now = nowIso()
  const prefix = input.prefix ?? ""
  const suffix = input.suffix ?? ""
  await withHtmlReaderDb((db) => {
    db.query(
      `INSERT INTO html_reader_highlights
       (id, run_name, file_path, color, quote, prefix, suffix, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.runName, input.filePath, input.color, quote, prefix, suffix, now, now)
  })
  return {
    id,
    runName: input.runName,
    filePath: input.filePath,
    color: input.color,
    quote,
    prefix,
    suffix,
    createdAt: now,
    updatedAt: now,
  }
}

export async function deleteHtmlReaderHighlight(
  runName: string,
  filePath: string,
  id: string,
): Promise<boolean> {
  validateHtmlReaderTarget(runName, filePath)
  return withHtmlReaderDb((db) => {
    const result = db.query(
      "DELETE FROM html_reader_highlights WHERE run_name = ? AND file_path = ? AND id = ?",
    ).run(runName, filePath, id)
    return result.changes > 0
  })
}
