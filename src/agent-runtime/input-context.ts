import type { PromptFileInput } from "../opencode"

export class InvalidInputContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidInputContextError"
  }
}

export function assertNonEmptyText(text: string, label: string) {
  if (!text.trim()) {
    throw new InvalidInputContextError(`${label} context is empty`)
  }
}

export async function isNonEmptyTextFile(path: string): Promise<boolean> {
  const file = Bun.file(path)
  if (!(await file.exists())) return false
  const text = await file.text()
  return Boolean(text.trim())
}

export async function assertNonEmptyInputFiles(inputFiles: PromptFileInput[] | undefined) {
  if (!inputFiles || inputFiles.length === 0) return

  for (const file of inputFiles) {
    const bunFile = Bun.file(file.path)
    if (!(await bunFile.exists())) {
      throw new InvalidInputContextError(`Input context ${file.filename} is missing`)
    }
    const text = await bunFile.text()
    if (!text.trim()) {
      throw new InvalidInputContextError(`Input context ${file.filename} is empty`)
    }
  }
}
