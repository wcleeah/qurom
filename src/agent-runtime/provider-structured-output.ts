import { toJsonSchema } from "@langchain/core/utils/json_schema"
import { z } from "zod"

import type { ProviderPromptResult } from "../providers/types"
import {
  buildStructuredPrompt,
  buildStructuredRepairPrompt,
  classifyFault,
  parseStructuredResponse,
  StructuredRecoveryError,
  type Fault,
} from "./structured-output"

export type ProviderTextResponse = {
  text: string
  model?: string
  provider?: string
  variant?: string
  raw?: unknown
}

export type StructuredPromptRunnerInput<T> = {
  prompt: string
  schema?: z.ZodType<T>
  providerOutputFile?: string
  artifactFile?: string
  sendPrompt: (prompt: string) => Promise<ProviderTextResponse>
  persistInlineFileOutput?: boolean
}

async function readOutputFile(outputFile: string | undefined) {
  if (!outputFile) return undefined
  try {
    const file = Bun.file(outputFile)
    if (!(await file.exists())) return undefined
    const content = await file.text()
    return content.trim() ? content : undefined
  } catch {
    return undefined
  }
}

function repairPromptForFault(input: {
  fault: Fault
  schema: Record<string, unknown>
  previousResponse: string
  error: unknown
  providerOutputFile?: string
}) {
  if (input.fault === "truncated") {
    return [
      "Your previous JSON output was cut off before it closed.",
      "Continue the JSON exactly from where you left off; do not repeat content already written.",
      "Do not include any prose or markdown. Output only the continuation.",
      "<previous_output>",
      input.previousResponse,
      "</previous_output>",
    ].join("\n\n")
  }

  if (input.fault === "nooutput" && input.providerOutputFile) {
    return [
      "You were asked to write valid JSON to the file path below but produced no usable output.",
      `Write the complete JSON object to \`${input.providerOutputFile}\` now.`,
      "Do not respond inline. Do not include prose or markdown. Write the file, then respond OK.",
      "<required_json_schema>",
      JSON.stringify(input.schema, null, 2),
      "</required_json_schema>",
    ].join("\n\n")
  }

  const zodErr = input.error instanceof z.ZodError ? input.error : undefined
  return buildStructuredRepairPrompt({
    schema: input.schema,
    previousResponse: input.previousResponse,
    error: input.error,
    zodIssues: zodErr?.issues,
  })
}

export async function runProviderStructuredPrompt<T>(
  input: StructuredPromptRunnerInput<T>,
): Promise<ProviderPromptResult<T>> {
  if (!input.schema) {
    const response = await input.sendPrompt(input.prompt)
    const fileText = await readOutputFile(input.providerOutputFile)
    return {
      text: fileText ?? response.text,
      model: response.model,
      provider: response.provider,
      variant: response.variant,
      outputSource: fileText ? "file" : "inline",
      raw: response.raw,
    }
  }

  const jsonSchema = toJsonSchema(input.schema) as Record<string, unknown>
  const initial = await input.sendPrompt(buildStructuredPrompt(input.prompt, jsonSchema))
  let raw = (await readOutputFile(input.providerOutputFile)) ?? initial.text
  let outputSource: "file" | "inline" = input.providerOutputFile && raw !== initial.text ? "file" : "inline"
  let latest = initial
  const budget = { sameAgent: 2 }
  const maxAttempts = 4

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const structured = parseStructuredResponse(input.schema, raw)
      if (input.artifactFile && outputSource === "inline" && input.persistInlineFileOutput !== false) {
        await Bun.write(input.artifactFile, JSON.stringify(structured, null, 2) + "\n")
      }
      return {
        structured,
        model: latest.model,
        provider: latest.provider,
        variant: latest.variant,
        outputSource,
        raw: latest.raw,
      }
    } catch (error) {
      const fault = classifyFault(error)
      if (budget.sameAgent <= 0) {
        throw new StructuredRecoveryError(fault, attempt, error)
      }
      budget.sameAgent--
      const repaired = await input.sendPrompt(
        repairPromptForFault({
          fault,
          schema: jsonSchema,
          previousResponse: raw,
          error,
          providerOutputFile: input.providerOutputFile,
        }),
      )
      latest = repaired
      const fileText = await readOutputFile(input.providerOutputFile)
      raw = fileText ?? repaired.text
      outputSource = fileText ? "file" : "inline"
    }
  }

  throw new StructuredRecoveryError("nooutput", maxAttempts, undefined, "structured output recovery budget exhausted")
}
