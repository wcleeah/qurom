import { stat } from "node:fs/promises"
import { join } from "node:path"

import type { RuntimeConfig } from "../config"
import type { PromptFileInput } from "../opencode"
import { buildResearchToolHint } from "../research-tools"
import type { HtmlReaderHighlight } from "./html-highlights-store"
import { safeRunPath } from "./paths"
import type { AskScope } from "./html-ask-store"

export class NoSourceMarkdownError extends Error {
  constructor(runName: string) {
    super(`No source markdown found for run ${JSON.stringify(runName)}`)
    this.name = "NoSourceMarkdownError"
  }
}

export interface ResolvedSourceMarkdown {
  mdFile: string
  absolutePath: string
  mtimeMs: number
}

export async function resolveSourceMarkdown(runName: string): Promise<ResolvedSourceMarkdown> {
  const runDir = safeRunPath(runName)
  for (const mdFile of ["final.md", "latest-draft.md"]) {
    const absolutePath = join(runDir, mdFile)
    try {
      const fileStat = await stat(absolutePath)
      if (!fileStat.isFile()) continue
      return { mdFile, absolutePath, mtimeMs: fileStat.mtimeMs }
    } catch {
      continue
    }
  }
  throw new NoSourceMarkdownError(runName)
}

async function readPromptTemplate(name: string): Promise<string> {
  const path = join(process.env.QUORUM_WORKSPACE_DIRECTORY ?? process.cwd(), "assets", "prompts", name)
  const file = Bun.file(path)
  if (!(await file.exists())) {
    throw new Error(`Missing prompt template ${name} at ${path}`)
  }
  return (await file.text()).trim()
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => values[key] ?? "")
}

export interface AskPromptBuildInput {
  scope: AskScope
  message: string
  highlight?: Pick<HtmlReaderHighlight, "quote" | "prefix" | "suffix"> | null
  bootstrap: boolean
  source: ResolvedSourceMarkdown
  config: RuntimeConfig
}

export interface AskPromptBuildResult {
  prompt: string
  inputFiles?: PromptFileInput[]
}

export async function buildAskPrompt(input: AskPromptBuildInput): Promise<AskPromptBuildResult> {
  const message = input.message.trim()
  if (!message) {
    throw new Error("Message is required")
  }

  if (!input.bootstrap) {
    return { prompt: message }
  }

  const templateName = input.scope === "highlight" ? "html-ask-highlight.md" : "html-ask-page.md"
  const template = await readPromptTemplate(templateName)
  const values: Record<string, string> = {
    question: message,
    researchToolHint: buildResearchToolHint(input.config),
  }
  if (input.scope === "highlight") {
    const highlight = input.highlight
    if (!highlight) {
      throw new Error("Highlight context is required for highlight scope bootstrap")
    }
    values.quote = highlight.quote
    values.prefix = highlight.prefix
    values.suffix = highlight.suffix
  }
  const prompt = renderTemplate(template, values)
  return {
    prompt,
    inputFiles: [{
      path: input.source.absolutePath,
      mime: "text/markdown",
      filename: "content.md",
    }],
  }
}

export function isMdStale(threadMtimeMs: number, source: ResolvedSourceMarkdown): boolean {
  return threadMtimeMs !== source.mtimeMs
}
