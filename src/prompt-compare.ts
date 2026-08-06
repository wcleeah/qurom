/** Normalize prompt bodies for equality checks across active SQLite and defaults files. */
export function normalizePromptContent(content: string | undefined | null): string {
  return (content ?? "").trim()
}

export function promptsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  return normalizePromptContent(a) === normalizePromptContent(b)
}
