import { join } from "node:path"

export const DRAFT_WORKING_FILENAME = "draft.md"

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
