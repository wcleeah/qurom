import { nowIso, validateHtmlReaderTarget, withHtmlReaderDb } from "./html-reader-db"

export type HtmlReaderProgress = {
  runName: string
  filePath: string
  scrollY: number
  scrollRatio: number
  updatedAt: string
}

type ProgressRow = {
  run_name: string
  file_path: string
  scroll_y: number
  scroll_ratio: number
  updated_at: string
}

function clampScrollY(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return value
}

function clampScrollRatio(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function rowToProgress(row: ProgressRow): HtmlReaderProgress {
  return {
    runName: row.run_name,
    filePath: row.file_path,
    scrollY: row.scroll_y,
    scrollRatio: row.scroll_ratio,
    updatedAt: row.updated_at,
  }
}

export async function getHtmlReaderProgress(
  runName: string,
  filePath: string,
): Promise<HtmlReaderProgress | null> {
  validateHtmlReaderTarget(runName, filePath)
  return withHtmlReaderDb((db) => {
    const row = db.query<ProgressRow, [string, string]>(
      `SELECT run_name, file_path, scroll_y, scroll_ratio, updated_at
       FROM html_reader_progress
       WHERE run_name = ? AND file_path = ?
       LIMIT 1`,
    ).get(runName, filePath)
    return row ? rowToProgress(row) : null
  })
}

export async function setHtmlReaderProgress(input: {
  runName: string
  filePath: string
  scrollY: number
  scrollRatio: number
}): Promise<HtmlReaderProgress> {
  validateHtmlReaderTarget(input.runName, input.filePath)
  const scrollY = clampScrollY(input.scrollY)
  const scrollRatio = clampScrollRatio(input.scrollRatio)
  const updatedAt = nowIso()
  await withHtmlReaderDb((db) => {
    db.query(
      `INSERT INTO html_reader_progress (run_name, file_path, scroll_y, scroll_ratio, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(run_name, file_path) DO UPDATE SET
         scroll_y = excluded.scroll_y,
         scroll_ratio = excluded.scroll_ratio,
         updated_at = excluded.updated_at`,
    ).run(input.runName, input.filePath, scrollY, scrollRatio, updatedAt)
  })
  return {
    runName: input.runName,
    filePath: input.filePath,
    scrollY,
    scrollRatio,
    updatedAt,
  }
}
