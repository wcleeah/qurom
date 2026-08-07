import { stat } from "node:fs/promises"

import type { PromptFileInput } from "../opencode"
import { displayHighlightQuote } from "./library-notes-types"
import { safeFilePath } from "./paths"

export class NoRepairHtmlError extends Error {
  constructor(runName: string, htmlFile: string) {
    super(`HTML file ${JSON.stringify(htmlFile)} not found for run ${JSON.stringify(runName)}`)
    this.name = "NoRepairHtmlError"
  }
}

export interface ResolvedRepairHtml {
  htmlFile: string
  absolutePath: string
  mtimeMs: number
}

export async function resolveRepairHtml(runName: string, htmlFile: string): Promise<ResolvedRepairHtml> {
  const absolutePath = safeFilePath(runName, htmlFile)
  try {
    const fileStat = await stat(absolutePath)
    if (!fileStat.isFile()) throw new NoRepairHtmlError(runName, htmlFile)
    return { htmlFile, absolutePath, mtimeMs: fileStat.mtimeMs }
  } catch (error) {
    if (error instanceof NoRepairHtmlError) throw error
    throw new NoRepairHtmlError(runName, htmlFile)
  }
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => values[key] ?? "")
}

export interface RepairPromptBuildInput {
  message: string
  bootstrap: boolean
  html: ResolvedRepairHtml
  contextQuote?: string | null
  contextPrefix?: string
  contextSuffix?: string
  promptAsset: string
}

export interface RepairPromptBuildResult {
  prompt: string
  inputFiles?: PromptFileInput[]
  outputFile: string
}

export async function buildRepairPrompt(input: RepairPromptBuildInput): Promise<RepairPromptBuildResult> {
  const message = input.message.trim()
  if (!message) {
    throw new Error("Message is required")
  }

  if (!input.bootstrap) {
    return {
      prompt: [
        message,
        "",
        "Continue repairing `{htmlFile}`. Keep the three Playwright verification todos mandatory before finishing."
          .replace("{htmlFile}", input.html.absolutePath),
      ].join("\n"),
      outputFile: input.html.absolutePath,
    }
  }

  const quote = input.contextQuote?.trim()
  const selectionContext = quote
    ? [
      "## Selected context from the page",
      "",
      `Quote: "${displayHighlightQuote(quote)}"`,
      input.contextPrefix ? `Prefix: ${input.contextPrefix}` : "",
      input.contextSuffix ? `Suffix: ${input.contextSuffix}` : "",
    ].filter(Boolean).join("\n")
    : ""

  const prompt = renderTemplate(input.promptAsset, {
    htmlFile: input.html.absolutePath,
    bugReport: message,
    selectionContext,
  })

  return {
    prompt,
    inputFiles: [{
      path: input.html.absolutePath,
      mime: "text/html",
      filename: "document.html",
    }],
    outputFile: input.html.absolutePath,
  }
}

export function isHtmlStale(threadMtimeMs: number, html: ResolvedRepairHtml): boolean {
  return threadMtimeMs !== html.mtimeMs
}
