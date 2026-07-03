import { nowIso, validateHtmlReaderTarget, withHtmlReaderDb } from "./html-reader-db"

export async function getHtmlReaderNotes(runName: string, filePath: string): Promise<string> {
  validateHtmlReaderTarget(runName, filePath)
  return withHtmlReaderDb((db) => {
    const row = db.query<{ notes: string }, [string, string]>(
      "SELECT notes FROM html_reader_notes WHERE run_name = ? AND file_path = ? LIMIT 1",
    ).get(runName, filePath)
    return row?.notes ?? ""
  })
}

export async function setHtmlReaderNotes(
  runName: string,
  filePath: string,
  notes: string,
): Promise<{ updatedAt: string }> {
  validateHtmlReaderTarget(runName, filePath)
  const updatedAt = nowIso()
  await withHtmlReaderDb((db) => {
    db.query(
      "INSERT OR REPLACE INTO html_reader_notes (run_name, file_path, notes, updated_at) VALUES (?, ?, ?, ?)",
    ).run(runName, filePath, notes, updatedAt)
  })
  return { updatedAt }
}
