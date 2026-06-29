import { readdir } from "node:fs/promises"
import type { Dirent } from "node:fs"
import { join } from "node:path"

export interface RunHistoryEntry {
  name: string
  topic: string
  inputMode: "topic" | "document"
  documentPath?: string
  status: string
  roundCount: number
  mtime: number
  hasHtml: boolean
}

function topicLabel(topic: string, maxLen = 60): string {
  return topic.length > maxLen ? topic.slice(0, maxLen - 3) + "…" : topic
}

export async function loadRunHistory(
  runsDir: string,
  limit = 30,
): Promise<RunHistoryEntry[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(runsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !/\.sqlite/.test(e.name))
    .sort((a, b) => b.name.localeCompare(a.name)) // crude reverse-chron by name
    .slice(0, limit)

  const results: RunHistoryEntry[] = []

  for (const dir of dirs) {
    try {
      const requestPath = join(runsDir, dir.name, "request.json")
      const requestFile = Bun.file(requestPath)
      if (!(await requestFile.exists())) continue

      const request = await requestFile.json() as {
        inputMode?: string
        topic?: string
        documentPath?: string
        inputSummary?: { title?: string }
      }

      const summaryPath = join(runsDir, dir.name, "summary.json")
      let outcome = "running"
      let roundCount = 0
      try {
        const summaryFile = Bun.file(summaryPath)
        if (await summaryFile.exists()) {
          const summary = await summaryFile.json() as { outcome?: string; round?: number }
          outcome = summary.outcome ?? "running"
          roundCount = summary.round ?? 0
        }
      } catch { /* ignore */ }

      // Count draft rounds if summary didn't have it
      if (roundCount === 0) {
        try {
          const files = await readdir(join(runsDir, dir.name))
          for (const f of files) {
            const m = f.match(/^draft-round-(\d+)\.md$/)
            if (m) roundCount = Math.max(roundCount, parseInt(m[1]) + 1)
          }
        } catch { /* ignore */ }
      }

      const hasHtml = (await Bun.file(join(runsDir, dir.name, "final.html")).exists())

      const topic = request.inputSummary?.title ?? request.topic ?? dir.name
      const inputMode = (request.inputMode === "document" ? "document" : "topic") as "topic" | "document"

      results.push({
        name: dir.name,
        topic: topicLabel(topic),
        inputMode,
        documentPath: inputMode === "document" ? request.documentPath : undefined,
        status: outcome,
        roundCount,
        mtime: 0,
        hasHtml,
      })
    } catch {
      continue
    }
  }

  // Sort by name descending (roughly chronological since names include timestamps or slugs)
  return results
}
