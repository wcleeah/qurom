import { z } from "zod"

/**
 * Categorized failure classes for the structured-output recovery router.
 * - nooutput: agent produced no usable bytes (empty inline / file missing / unreadable)
 * - truncated: JSON cut off before closing -> continue generation in the same agent
 * - syntax:   strict JSON.parse fails (escapes, commas, fences/prefix that coerceJson couldn't recover)
 * - schema:   strict JSON parsed fine but zod semantic/enum rules rejected it
 * - transport: provider transport/runtime error (response.error, no data, continue_failed)
 */
export type Fault = "nooutput" | "truncated" | "syntax" | "schema" | "transport"

export class StructuredRecoveryError extends Error {
  readonly fault: Fault
  readonly attempts: number
  readonly lastError: unknown

  constructor(fault: Fault, attempts: number, lastError: unknown, msg?: string) {
    super(msg ?? `${fault}_unresolved (attempts=${attempts})`)
    this.name = "StructuredRecoveryError"
    this.fault = fault
    this.attempts = attempts
    this.lastError = lastError
  }
}

/** Raised when the JSON payload has no balanced closer (truncated mid-generation). */
export class TruncatedJsonError extends SyntaxError {
  constructor(message = "JSON payload appears truncated: no balanced close brace found") {
    super(message)
    this.name = "TruncatedJsonError"
  }
}

export function classifyFault(err: unknown): Fault {
  if (err instanceof StructuredRecoveryError) return err.fault
  if (err instanceof z.ZodError) return "schema"
  if (err instanceof TruncatedJsonError) return "truncated"
  if (err instanceof SyntaxError) return "syntax"
  return "nooutput"
}

export function buildStructuredPrompt(prompt: string, schema: Record<string, unknown>) {
  return [
    prompt,
    "Output requirements:",
    "- Return only a single JSON object as plain text.",
    "- Do not include markdown fences, commentary, or explanation.",
    "<required_json_schema>",
    JSON.stringify(schema, null, 2),
    "</required_json_schema>",
  ].join("\n\n")
}

export function formatStructuredError(error: unknown) {
  if (error instanceof SyntaxError) return error.message
  if (error instanceof z.ZodError) return JSON.stringify(error.issues, null, 2)
  if (error instanceof Error) return error.message
  return JSON.stringify(error)
}

export function buildStructuredRepairPrompt(input: {
  schema: Record<string, unknown>
  previousResponse: string
  error: unknown
  zodIssues?: z.ZodIssue[]
}) {
  const lines = [
    "Your previous response did not match the required output format.",
    "Return only a single JSON object as plain text.",
    "Do not include markdown fences, prose, or explanation.",
    "<required_json_schema>",
    JSON.stringify(input.schema, null, 2),
    "</required_json_schema>",
  ]
  if (input.zodIssues && input.zodIssues.length > 0) {
    lines.push(
      "<zod_issues>",
      input.zodIssues.map((i) => `at ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n"),
      "</zod_issues>",
      "The JSON parsed but does not match the schema - correct the values, keep the structure.",
    )
  } else {
    lines.push("<validation_errors>", formatStructuredError(input.error), "</validation_errors>")
  }
  lines.push("<previous_response>", input.previousResponse, "</previous_response>")
  return lines.join("\n\n")
}

export function buildFileRepairPrompt(input: {
  outputFile: string
  parseError: string
}) {
  return [
    `The JSON file you wrote at \`${input.outputFile}\` could not be parsed.`,
    "Read that file, fix the JSON syntax errors, and rewrite it.",
    "Common issues: unescaped double quotes inside strings, trailing commas, missing brackets.",
    "Escape all double-quote characters inside string values with backslash-quote.",
    "Rewrite the entire file with valid JSON. Respond with OK when done.",
    "Parse error:",
    input.parseError,
  ].join("\n\n")
}

/**
 * Free-tier pre-clean: strip a single wrapping ```json/``` fence or <json>/<output>
 * tag pair, then slice the first balanced {...} or [...] block.
 */
export function coerceJson(text: string): string {
  let t = text.trim()
  const fenceStart = t.match(/^```(?:json)?\s*/i)
  if (fenceStart) {
    const closer = t.search(/\n```\s*$/)
    if (closer !== -1) t = t.slice(fenceStart[0].length, closer)
  }
  const tagMatch = t.match(/^<(json|output)>\s*/)
  if (tagMatch) {
    const closeTag = `</${tagMatch[1]}>`
    const closeIdx = t.indexOf(closeTag)
    if (closeIdx !== -1) t = t.slice(tagMatch[0].length, closeIdx)
  }
  t = t.trim()
  const start = t.search(/[\[{]/)
  if (start === -1) return t
  const open = t[start]
  const close = open === "{" ? "}" : "]"
  let depth = 0
  let inStr = false
  let esc = false
  let end = -1
  for (let i = start; i < t.length; i++) {
    const c = t[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === "\\") esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  return end === -1 ? t : t.slice(start, end + 1)
}

function hasBalancedJsonClose(text: string): boolean {
  const t = text.trim()
  const start = t.search(/[\[{]/)
  if (start === -1) return false
  const open = t[start]
  const close = open === "{" ? "}" : "]"
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < t.length; i++) {
    const c = t[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === "\\") esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return true
    }
  }
  return false
}

export function parseStructuredResponse<T>(schema: z.ZodType<T>, text: string) {
  const coerced = coerceJson(text)
  if (!hasBalancedJsonClose(coerced)) throw new TruncatedJsonError()
  return schema.parse(JSON.parse(coerced))
}
