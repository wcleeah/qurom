import { readdir } from "node:fs/promises"
import { join } from "node:path"

export const DRAFT_WORKING_FILENAME = "draft.md"
export const DRAFT_ROUND_RE = /^draft-round-(\d+)\.md$/
export const DRAFT_READABILITY_RE = /^draft-round-(\d+)-readability-(\d+)\.md$/

export function draftWorkingPath(outputPath: string) {
  return join(outputPath, DRAFT_WORKING_FILENAME)
}

export function draftRoundFilename(round: number) {
  return `draft-round-${round}.md`
}

export function draftRoundPath(outputPath: string, round: number) {
  return join(outputPath, draftRoundFilename(round))
}

export async function snapshotWorkingDraft(outputPath: string, destFilename: string) {
  const source = draftWorkingPath(outputPath)
  const file = Bun.file(source)
  if (!(await file.exists())) {
    throw new Error(`Working draft ${DRAFT_WORKING_FILENAME} is missing`)
  }
  const text = await file.text()
  if (!text.trim()) {
    throw new Error(`Working draft ${DRAFT_WORKING_FILENAME} is empty`)
  }
  await Bun.write(join(outputPath, destFilename), text)
  return text
}

/** Prefer the newest readability snapshot, then the newest round snapshot. */
export function latestDraftSnapshotFilename(files: string[]): string | undefined {
  let best: { round: number; tryIndex: number; name: string } | undefined
  for (const name of files) {
    const readability = name.match(DRAFT_READABILITY_RE)
    if (readability) {
      const candidate = {
        round: Number.parseInt(readability[1]!, 10),
        tryIndex: Number.parseInt(readability[2]!, 10),
        name,
      }
      if (!best || candidate.round > best.round || (candidate.round === best.round && candidate.tryIndex >= best.tryIndex)) {
        best = candidate
      }
      continue
    }
    const round = name.match(DRAFT_ROUND_RE)
    if (round) {
      const candidate = {
        round: Number.parseInt(round[1]!, 10),
        tryIndex: 0,
        name,
      }
      if (!best || candidate.round > best.round || (candidate.round === best.round && candidate.tryIndex > best.tryIndex)) {
        best = candidate
      }
    }
  }
  return best?.name
}

export async function restoreWorkingDraftFromLatestSnapshot(outputPath: string): Promise<string | undefined> {
  let files: string[] = []
  try {
    files = await readdir(outputPath)
  } catch {
    return undefined
  }
  const name = latestDraftSnapshotFilename(files)
  if (!name) return undefined
  const text = await Bun.file(join(outputPath, name)).text()
  if (!text.trim()) return undefined
  await Bun.write(draftWorkingPath(outputPath), text)
  return name
}
