import { basename } from "node:path"
import type { z } from "zod"

import { parseStructuredResponse } from "./structured-output"
import type { ProviderPromptResult } from "../providers/types"

export async function readHarvestableLocalFile<T>(input: {
  outputFile?: string
  schema?: z.ZodType<T>
}): Promise<ProviderPromptResult<T> | undefined> {
  if (!input.outputFile) return undefined
  try {
    const file = Bun.file(input.outputFile)
    if (!(await file.exists())) return undefined
    const text = await file.text()
    if (!text.trim()) return undefined
    if (input.schema) {
      const structured = parseStructuredResponse(input.schema, text)
      return {
        text,
        structured,
        outputSource: "file",
        harvested: true,
        harvestSource: "local",
      }
    }
    if (text.trim() === "OK") return undefined
    return {
      text,
      outputSource: "file",
      harvested: true,
      harvestSource: "local",
    }
  } catch {
    return undefined
  }
}

export async function parseHarvestedResult<T>(input: {
  result: ProviderPromptResult<T>
  outputFile?: string
  schema?: z.ZodType<T>
}): Promise<ProviderPromptResult<T> | undefined> {
  const fileResult = await readHarvestableLocalFile(input)
  if (input.schema) {
    if (fileResult?.structured !== undefined) {
      return {
        ...input.result,
        ...fileResult,
        harvested: true,
        harvestSource: input.result.harvestSource ?? fileResult.harvestSource,
      }
    }
    if (input.result.text) {
      try {
        const structured = parseStructuredResponse(input.schema, input.result.text)
        return {
          ...input.result,
          structured,
          harvested: true,
        }
      } catch {
        return undefined
      }
    }
    return undefined
  }
  if (fileResult?.text) {
    return {
      ...input.result,
      text: fileResult.text,
      outputSource: "file",
      harvested: true,
      harvestSource: input.result.harvestSource ?? "local",
    }
  }
  if (input.result.text && input.result.text.trim() && input.result.text.trim() !== "OK") {
    return { ...input.result, harvested: true }
  }
  return undefined
}

export function artifactBasename(outputFile: string | undefined): string | undefined {
  return outputFile ? basename(outputFile) : undefined
}
