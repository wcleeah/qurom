import { toJsonSchema } from "@langchain/core/utils/json_schema"
import { createOpencodeClient, type FilePartInput, type Part, type PermissionReplyData, type Session, type TextPartInput } from "@opencode-ai/sdk/v2"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { z } from "zod"

import type { RuntimeConfig } from "./config"
import type { DebugLog } from "./debug-log"
import type { TelemetryRun, TraceObservation } from "./telemetry"

const assistantInfoSchema = z.object({
  role: z.literal("assistant"),
  structured: z.unknown().optional(),
  error: z.unknown().optional(),
  modelID: z.string().optional(),
  providerID: z.string().optional(),
  variant: z.string().optional(),
})

function extractText(parts: Part[]) {
  return parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text" && !part.ignored)
    .map((part) => part.text)
    .join("\n")
    .trim()
}

function buildStructuredPrompt(prompt: string, schema: Record<string, unknown>) {
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

function formatStructuredError(error: unknown) {
  if (error instanceof SyntaxError) return error.message
  if (error instanceof z.ZodError) return JSON.stringify(error.issues, null, 2)
  if (error instanceof Error) return error.message
  return JSON.stringify(error)
}

/**
 * Categorized failure classes for the structured-output recovery router.
 * - nooutput: agent produced no usable bytes (empty inline / file missing / unreadable)
 * - truncated: JSON cut off before closing → continue generation in the same agent
 * - syntax:   strict JSON.parse fails (escapes, commas, fences/prefix that coerceJson couldn't recover)
 * - schema:   strict JSON parsed fine but zod semantic/enum rules rejected it
 * - transport: OpenCode transport/runtime error (response.error, no data, continue_failed)
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

export function classifyFault(err: unknown): Fault {
  if (err instanceof StructuredRecoveryError) return err.fault
  if (err instanceof z.ZodError) return "schema"
  if (err instanceof TruncatedJsonError) return "truncated"
  if (err instanceof SyntaxError) return "syntax"
  // readOutputFile.ok === false already routed upstream; this branch shouldn't be hit here.
  return "nooutput"
}

function buildStructuredRepairPrompt(input: {
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
      "The JSON parsed but does not match the schema — correct the values, keep the structure.",
    )
  } else {
    lines.push("<validation_errors>", formatStructuredError(input.error), "</validation_errors>")
  }
  lines.push("<previous_response>", input.previousResponse, "</previous_response>")
  return lines.join("\n\n")
}

function buildFileRepairPrompt(input: {
  outputFile: string
  parseError: string
}) {
  return [
    `The JSON file you wrote at \`${input.outputFile}\` could not be parsed.`,
    `Read that file, fix the JSON syntax errors, and rewrite it.`,
    "Common issues: unescaped double quotes inside strings, trailing commas, missing brackets.",
    "Escape all double-quote characters inside string values with backslash-quote.",
    "Rewrite the entire file with valid JSON. Respond with OK when done.",
    "Parse error:",
    input.parseError,
  ].join("\n\n")
}

/**
 * Free-tier (D) pre-clean: strip a single wrapping ```json/``` fence or <json>/<output>
 * tag pair, then slice the first balanced {...} or [...] block (string-aware so
 * backticks and quotes inside string values are never stripped).
 * Returns the original text trimmed if no opener is found, so JSON.parse still
 * fails with a faithful error for the router to classify.
 */
export function coerceJson(text: string): string {
  let t = text.trim()
  // strip a single leading ```json or ``` fence (anchored, only if matching closer exists)
  const fenceStart = t.match(/^```(?:json)?\s*/i)
  if (fenceStart) {
    const closer = t.search(/\n```\s*$/)
    if (closer !== -1) t = t.slice(fenceStart[0].length, closer)
  }
  // strip a single leading <json>…</json> or <output>…</output> tag wrap
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

/** Raised when the JSON payload has no balanced closer (truncated mid-generation). */
export class TruncatedJsonError extends SyntaxError {
  constructor(message = "JSON payload appears truncated: no balanced close brace found") {
    super(message)
    this.name = "TruncatedJsonError"
  }
}

function parseStructuredResponse<T>(schema: z.ZodType<T>, text: string) {
  const coerced = coerceJson(text)
  if (!hasBalancedJsonClose(coerced)) throw new TruncatedJsonError()
  return schema.parse(JSON.parse(coerced))
}

function generationMetadata(input: {
  agent: string
  sessionID: string
  provider?: string
  variant?: string
}) {
  return {
    agentName: input.agent,
    sessionId: input.sessionID,
    provider: input.provider,
    variant: input.variant,
  }
}

function buildResearchToolHint(config: RuntimeConfig): string {
  const tools = config.quorumConfig.researchTools
  const toolList = tools.prefer.map((t) => `- **${t}**`).join("\n")

  return [
    "You have access to the following tools. Use them to assist your work if needed.",
    "",
    toolList,
    "",
    `Web search is powered by **${tools.webSearchProvider}**. Prefer online sources over local files.`,
  ].join("\n")
}

function isResearchAgent(agent: string, config: RuntimeConfig): boolean {
  const researchAgents = new Set([
    config.quorumConfig.designatedDrafter,
    ...config.quorumConfig.auditors,
    config.quorumConfig.summarizerAgent,
  ])
  return researchAgents.has(agent)
}

export type PromptFileInput = {
  path: string
  mime: string
  filename: string
}

export async function promptAgent<T>(input: {
  config: RuntimeConfig
  sessionID: string
  agent: string
  prompt: string
  schema?: z.ZodType<T>
  variant?: string
  inputFiles?: PromptFileInput[]
  outputFile?: string
  telemetry?: {
    run: TelemetryRun
    parentObservation?: TraceObservation
    trackSessionObservation?: (sessionID: string, observation: TraceObservation | undefined) => void
    trackAgentMetadata?: (input: { agent: string; sessionID: string; model?: string; variant?: string }) => void
    debugLog?: DebugLog
    name: string
    input?: unknown
    metadata?: unknown
  }
}) {
  const client = createOpencodeClient({
    baseUrl: input.config.env.OPENCODE_BASE_URL,
    directory: input.config.env.OPENCODE_DIRECTORY,
  })

  const agentObservation =
    input.telemetry?.run?.traceId && input.telemetry?.run?.rootObservation
      ? await input.telemetry.run.startObservation({
          traceId: input.telemetry.run.traceId,
          parentObservationId: input.telemetry.parentObservation?.id ?? input.telemetry.run.rootObservation.id,
          name: input.telemetry.name,
          type: "Agent",
          input: input.telemetry.input ?? {
            agentName: input.agent,
            sessionId: input.sessionID,
            structured: Boolean(input.schema),
          },
          metadata: {
            agentName: input.agent,
            sessionId: input.sessionID,
            ...((input.telemetry.metadata as Record<string, unknown> | undefined) ?? {}),
          },
        })
      : undefined

  input.telemetry?.trackSessionObservation?.(input.sessionID, agentObservation)

  let repaired = false
  let model: string | undefined
  let provider: string | undefined
  let variant: string | undefined
  let activeSessionID = input.sessionID

  // Inject research tool hints for research agents
  const prompt = isResearchAgent(input.agent, input.config)
    ? buildResearchToolHint(input.config) + "\n\n---\n\n" + input.prompt
    : input.prompt

  async function sendPrompt(prompt: string) {
    const generationObservation =
      input.telemetry?.run?.traceId && agentObservation
        ? await input.telemetry.run.startObservation({
            traceId: input.telemetry.run.traceId,
            parentObservationId: agentObservation.id,
            name: `${input.telemetry.name}.generation`,
            type: "Generation",
              input: {
                prompt,
                structured: Boolean(input.schema),
                variant: input.variant,
                inputFiles: input.inputFiles?.map((f) => f.filename),
                outputFile: input.outputFile,
              },
              metadata: {
                ...generationMetadata({
                  agent: input.agent,
                  sessionID: activeSessionID,
                  variant: input.variant,
                }),
              },
            })
        : undefined

    const parts: Array<TextPartInput | FilePartInput> = [
      { type: "text", text: prompt } satisfies TextPartInput,
    ]

    if (input.inputFiles) {
      for (const f of input.inputFiles) {
        parts.push({
          type: "file",
          mime: f.mime,
          filename: f.filename,
          url: pathToFileURL(resolve(f.path)).href,
        } satisfies FilePartInput)
      }
    }

    const maxTransportAttempts = 2
    let response
    for (let transportAttempt = 0; transportAttempt < maxTransportAttempts; transportAttempt++) {
      response = await client.session.prompt({
        sessionID: activeSessionID,
        agent: input.agent,
        variant: input.variant,
        parts,
      })

      input.telemetry?.debugLog?.write("session.prompt", {
        sessionID: activeSessionID,
        agent: input.agent,
        variant: input.variant,
        promptLength: prompt.length,
        inputFiles: input.inputFiles?.map((f) => ({ name: f.filename, path: f.path })),
        outputFile: input.outputFile,
        hasSchema: Boolean(input.schema),
        hasError: Boolean(response.error),
        hasData: Boolean(response.data),
      })

      if (response.error || !response.data) {
        if (transportAttempt + 1 < maxTransportAttempts) {
          input.telemetry?.debugLog?.write("session.transport_retry", {
            sessionID: activeSessionID,
            agent: input.agent,
            attempt: transportAttempt + 1,
            error: response.error ? JSON.stringify(response.error) : "no data",
          })
          await new Promise((r) => setTimeout(r, 200))
          continue
        }
        if (response.error) {
          await input.telemetry?.run?.endObservation(generationObservation, {
            level: "ERROR",
            statusMessage: `OpenCode prompt failed: ${JSON.stringify(response.error)}`,
          })
          throw new StructuredRecoveryError(
            "transport",
            transportAttempt + 1,
            response.error,
            `transport.prompt_failed: Failed to prompt agent ${input.agent} in session ${activeSessionID}: ${JSON.stringify(response.error)}`,
          )
        }
        await input.telemetry?.run?.endObservation(generationObservation, {
          level: "ERROR",
          statusMessage: "OpenCode returned no response data",
        })
        throw new StructuredRecoveryError("transport", 2, "no data", `transport.prompt_failed: OpenCode returned no response data for agent ${input.agent} in session ${activeSessionID}`)
      }
      break
    }

    // Defensive: the loop above always either assigns response and breaks, or throws.
    // This narrowing keeps TS happy and is belt-and-braces for any future edit.
    if (!response || !response.data) {
      throw new StructuredRecoveryError("transport", 2, undefined, `transport.prompt_failed: unreachable: response unset after retry loop for agent ${input.agent}`)
    }

    const info = assistantInfoSchema.parse(response.data.info)
    model = info.modelID
    provider = info.providerID
    variant = info.variant ?? input.variant
    input.telemetry?.trackAgentMetadata?.({ agent: input.agent, sessionID: activeSessionID, model, variant })

    if (info.error) {
      await input.telemetry?.run?.endObservation(generationObservation, {
        level: "ERROR",
        statusMessage: `OpenCode assistant call failed: ${JSON.stringify(info.error)}`,
        output: {
          error: info.error,
        },
        model: info.modelID,
        metadata: {
          ...generationMetadata({
            agent: input.agent,
            sessionID: activeSessionID,
            provider: info.providerID,
            variant,
          }),
          model: info.modelID,
        },
      })
      throw new Error(`OpenCode assistant call failed in session ${activeSessionID}: ${JSON.stringify(info.error)}`)
    }

    const text = extractText(response.data.parts)

    // If the LLM returned empty text, ask it to continue
    let finalText = text
    if (!finalText.trim()) {
      input.telemetry?.debugLog?.write("session.empty_response", {
        sessionID: activeSessionID,
        agent: input.agent,
      })
      const maxContinueAttempts = 2
      for (let continueAttempt = 0; continueAttempt < maxContinueAttempts && !finalText.trim(); continueAttempt++) {
        const continueResponse = await client.session.prompt({
          sessionID: activeSessionID,
          agent: input.agent,
          variant: input.variant,
          parts: [{ type: "text", text: "Continue. Produce your output now." } satisfies TextPartInput],
        })
        if (continueResponse.error || !continueResponse.data) {
          throw new StructuredRecoveryError(
            "transport",
            continueAttempt + 1,
            continueResponse.error,
            `transport.continue_failed: continue prompt errored for agent ${input.agent} in session ${activeSessionID}: ${JSON.stringify(continueResponse.error ?? "no data")}`,
          )
        }
        finalText = extractText(continueResponse.data.parts)
        if (!finalText.trim()) {
          input.telemetry?.debugLog?.write("session.empty_response", {
            sessionID: activeSessionID,
            agent: input.agent,
            continueAttempt: continueAttempt + 1,
          })
        }
      }
    }

    await input.telemetry?.run?.endObservation(generationObservation, {
      output: {
        response: finalText,
      },
      model: info.modelID,
        metadata: {
          ...generationMetadata({
            agent: input.agent,
            sessionID: activeSessionID,
            provider: info.providerID,
            variant,
          }),
        model: info.modelID,
      },
    })

    return {
      text: finalText,
      model: info.modelID,
      provider: info.providerID,
    }
  }

  async function readOutputFile(): Promise<{ ok: true; text: string } | { ok: false; reason: "missing" | "empty" | "unreadable"; err?: string }> {
    if (!input.outputFile) return { ok: false, reason: "missing" }
    try {
      const file = Bun.file(input.outputFile)
      if (!(await file.exists())) {
        console.warn(`[opencode] Output file not written by agent: ${input.outputFile}`)
        return { ok: false, reason: "missing", err: "file does not exist" }
      }
      const content = await file.text()
      if (!content.trim()) {
        console.warn(`[opencode] Output file empty: ${input.outputFile}`)
        return { ok: false, reason: "empty" }
      }
      return { ok: true, text: content }
    } catch (e) {
      return { ok: false, reason: "unreadable", err: e instanceof Error ? e.message : String(e) }
    }
  }

  try {
    if (!input.schema) {
      const response = await sendPrompt(prompt)

      // If outputFile was requested, read it back (agent wrote there instead of responding inline)
      const fileContentRead = await readOutputFile()
      const outputText = fileContentRead.ok ? fileContentRead.text : response.text

      await input.telemetry?.run?.endObservation(agentObservation, {
        output: {
          response: response.text,
          outputFile: input.outputFile,
          fileRead: fileContentRead.ok,
          structured: false,
        },
        metadata: {
          agentName: input.agent,
          sessionId: activeSessionID,
          model: response.model,
          provider: response.provider,
          variant,
          repaired,
        },
      })

      return {
        text: outputText,
        structured: undefined,
        model: response.model,
        provider: response.provider,
      }
    }

    const jsonSchema = toJsonSchema(input.schema) as Record<string, unknown>
    const initialResponse = await sendPrompt(buildStructuredPrompt(prompt, jsonSchema))

    // If outputFile was requested, try reading it first (agent may have written structured output there)
    const fileContentRead = await readOutputFile()
    const fileContent = fileContentRead.ok ? fileContentRead.text : undefined
    const wantFile = Boolean(input.outputFile)

    async function parseAndReturn(schema: z.ZodType<T>, sourceText: string, _sourceLabel: string) {
      void _sourceLabel
      try {
        const structured = parseStructuredResponse(schema, sourceText)
        await input.telemetry?.run?.endObservation(agentObservation, {
          output: {
            response: sourceText,
            parsed: structured,
            parseSource: _sourceLabel,
            outputFile: input.outputFile,
            structured: true,
            repaired,
          },
          metadata: {
            agentName: input.agent,
            sessionId: activeSessionID,
            model,
            provider,
            variant,
            repaired,
          },
        })
        // Phase 4 — persistence: when an agent was asked to write to a file but
        // produced valid JSON inline instead, persist the parsed struct to the
        // canonical outputFile before returning so downstream file readers see
        // it (and before any observer can treat success as final). A persist
        // failure is escalated as a categorized 'nooutput' fault (the A branch
        // re-prompts: 'write the file you were asked to') rather than a phantom
        // success — never return a valid struct whose canonical file is empty.
        if (input.outputFile && _sourceLabel === "from inline response") {
          try {
            await Bun.write(input.outputFile, JSON.stringify(structured, null, 2) + "\n")
          } catch (persistErr) {
            throw new StructuredRecoveryError(
              "nooutput",
              0,
              persistErr,
              `persist of inline-valid structured output to ${input.outputFile} failed: ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`,
            )
          }
        }
        return {
          text: undefined,
          structured,
          model,
          provider,
        }
      } catch (err) {
        // Do not wrap — rethrow the original typed error so the router can
        // classifyFault it (ZodError -> schema, SyntaxError -> syntax/truncated).
        throw err
      }
    }

    // Phase 4 — divergence triage: when BOTH a file was written AND a valid
    // inline response was produced, emit session.dual_output so post-hoc
    // triage sees the divergence (the returned struct keeps the file, which
    // matches today's file-first preference and avoids overwriting the agent's
    // own chosen artifact). Per the plan, divergence is flagged ONLY when both
    // sides parse to distinct values — a malformed file or malformed inline is
    // a different failure mode (handled by the router), not a dual-output
    // divergence, so it must not noise this event.
    if (wantFile && fileContent && initialResponse.text.trim()) {
      let diverged = false
      try {
        const fParsed = JSON.parse(coerceJson(fileContent))
        const iParsed = JSON.parse(coerceJson(initialResponse.text))
        if (JSON.stringify(fParsed) !== JSON.stringify(iParsed)) diverged = true
      } catch {
        // One side did not parse — not a dual-output divergence; leave to the router.
        diverged = false
      }
      if (diverged) {
        const meta = input.telemetry?.metadata as { requestId?: string; round?: number } | undefined
        input.telemetry?.debugLog?.write("session.dual_output", {
          sessionID: activeSessionID,
          agent: input.agent,
          requestId: meta?.requestId,
          round: meta?.round,
          diverged: true,
        })
      }
    }

    // Recovery router: D (coerce, inside parseAndReturn) -> classifyFault -> A/B/C.
    //   A nooutput/truncated: reprompt the SAME agent in the current in-session.
    //   B schema:             same agent, with <zod_issues> embedded in the repair prompt.
    //   C syntax (with outputFile + json-fixer budget): json-fixer agent rewrites the file on disk.
    //   If syntax has no outputFile / no C-budget, fall back to A with a generic repair prompt.
    // On budget exhaustion we throw a typed StructuredRecoveryError so Phase 3.5's outer
    //   fresh-session restart wrapper can match on instanceof StructuredRecoveryError.
    let raw: string
    let sourceLabel: string
    if (wantFile && fileContent) {
      raw = fileContent
      sourceLabel = `from file ${input.outputFile}`
    } else {
      raw = initialResponse.text
      sourceLabel = "from inline response"
    }

    async function repromptSameAgentRaw(
      kind: Fault,
      parseErr: unknown,
      previousResponse: string,
    ): Promise<{ text: string; sourceLabel: string }> {
      let repairPrompt: string
      if (kind === "schema") {
        const zodErr = parseErr instanceof z.ZodError ? parseErr : undefined
        repairPrompt = buildStructuredRepairPrompt({
          schema: jsonSchema,
          previousResponse,
          error: parseErr,
          zodIssues: zodErr?.issues,
        })
      } else if (kind === "truncated") {
        repairPrompt = [
          "Your previous JSON output was cut off before it closed.",
          "Continue the JSON exactly from where you left off; do not repeat content already written.",
          "Do not include any prose or markdown. Output only the continuation.",
          "<previous_output>",
          previousResponse,
          "</previous_output>",
          "<validation_errors>",
          formatStructuredError(parseErr),
          "</validation_errors>",
        ].join("\n\n")
      } else if (kind === "nooutput" && wantFile) {
        repairPrompt = [
          "You were asked to write valid JSON to the file path below but produced no usable output.",
          `Write the complete JSON object to \`${input.outputFile}\` now.`,
          "Do not respond inline. Do not include prose or markdown. Write the file, then respond OK.",
          "<required_json_schema>",
          JSON.stringify(jsonSchema, null, 2),
          "</required_json_schema>",
        ].join("\n\n")
      } else {
        // nooutput (no file requested) or syntax-fallback: generic structured repair.
        repairPrompt = buildStructuredRepairPrompt({
          schema: jsonSchema,
          previousResponse,
          error: parseErr,
        })
      }
      const repairedResponse = await sendPrompt(repairPrompt)
      if (wantFile) {
        const fr = await readOutputFile()
        if (fr.ok) return { text: fr.text, sourceLabel: `from file ${input.outputFile}` }
      }
      return { text: repairedResponse.text, sourceLabel: "from inline response" }
    }

    async function repairWithJsonFixerOnce(
      parseErr: unknown,
      previousResponse: string,
    ): Promise<{ text: string; sourceLabel: string }> {
      const target = input.outputFile!
      const existing = await readOutputFile()
      if (!existing.ok || existing.text !== previousResponse) {
        await Bun.write(target, previousResponse)
      }
      const repairSession = await createSession(input.config, `json-fixer:${target}`)
      input.telemetry?.trackSessionObservation?.(repairSession.id, agentObservation)
      const previousSessionID = activeSessionID
      const savedAgent = input.agent
      activeSessionID = repairSession.id
      input.agent = "json-fixer"
      try {
        await sendPrompt(
          buildFileRepairPrompt({
            outputFile: target,
            parseError: formatStructuredError(parseErr),
          }),
        )
      } finally {
        // Always restore agent/session; the original code could leave them mutated on throw.
        input.agent = savedAgent
        activeSessionID = previousSessionID
      }
      const after = await readOutputFile()
      if (!after.ok) {
        throw new StructuredRecoveryError(
          "syntax",
          99,
          parseErr,
          `json-fixer did not produce a readable file at ${target}`,
        )
      }
      return { text: after.text, sourceLabel: `from repaired file ${target}` }
    }

    const budget = { sameAgent: 2, jsonFixer: 2 }
    const maxAttempts = 8 // global cap; per-fault budgets guarantee <= 2 A + <= 2 C overall
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await parseAndReturn(input.schema, raw, sourceLabel)
      } catch (err) {
        // Transport-class errors from sendPrompt bubble out immediately; they originate
        // in the reprompt/repair handlers below, not parseAndReturn, so detect-instanceof.
        if (err instanceof StructuredRecoveryError && err.fault === "transport") throw err

        const fault = classifyFault(err)
        input.telemetry?.debugLog?.write("session.recovery.classify", {
          sessionID: activeSessionID,
          agent: input.agent,
          attempt,
          fault,
          budgetSameAgentLeft: budget.sameAgent,
          budgetJsonFixerLeft: budget.jsonFixer,
        })
        repaired = true

        if (fault === "syntax" && input.outputFile && budget.jsonFixer > 0) {
          // C branch: json-fixer on disk
          budget.jsonFixer--
          input.telemetry?.debugLog?.write("session.repair.json_fixer", {
            sessionID: activeSessionID,
            agent: input.agent,
            attempt,
          })
          const after = await repairWithJsonFixerOnce(err, raw)
          raw = after.text
          sourceLabel = after.sourceLabel
          continue
        }

        // A/B branches: same agent, in-session
        if (budget.sameAgent <= 0) {
          throw new StructuredRecoveryError(fault, attempt, err)
        }
        budget.sameAgent--
        input.telemetry?.debugLog?.write("session.recovery.reprompt", {
          sessionID: activeSessionID,
          agent: input.agent,
          kind: fault,
          attempt,
        })
        const reprompted = await repromptSameAgentRaw(fault, err, raw)
        raw = reprompted.text
        sourceLabel = reprompted.sourceLabel
        continue
      }
    }
    throw new StructuredRecoveryError("nooutput", maxAttempts, undefined, `recovery budget exhausted for agent ${input.agent}`)

  } catch (error) {
        await input.telemetry?.run?.endObservation(agentObservation, {
      level: "ERROR",
      statusMessage: error instanceof Error ? error.message : String(error),
      metadata: {
        agentName: input.agent,
        sessionId: activeSessionID,
        model,
        provider,
        variant,
        repaired,
      },
    })
    throw error
  }
}

export async function createSession(config: RuntimeConfig, title: string, parentID?: string) {
  const response = await createOpencodeClient({
    baseUrl: config.env.OPENCODE_BASE_URL,
    directory: config.env.OPENCODE_DIRECTORY,
  }).session.create({
    title,
    parentID,
  })

  if (response.error) {
    throw new Error(`Failed to create OpenCode session "${title}": ${JSON.stringify(response.error)}`)
  }

  if (!response.data) {
    throw new Error(`OpenCode returned no session payload for "${title}"`)
  }

  return response.data satisfies Session
}

export async function abortSession(config: RuntimeConfig, sessionID: string) {
  const response = await createOpencodeClient({
    baseUrl: config.env.OPENCODE_BASE_URL,
    directory: config.env.OPENCODE_DIRECTORY,
  }).session.abort({
    sessionID,
    directory: config.env.OPENCODE_DIRECTORY,
  })

  if (response.error) {
    throw new Error(`Failed to abort OpenCode session "${sessionID}": ${JSON.stringify(response.error)}`)
  }
}

export async function replyToPermission(
  config: RuntimeConfig,
  input: {
    requestID: string
    reply: NonNullable<PermissionReplyData["body"]>["reply"]
    message?: string
  },
) {
  const response = await createOpencodeClient({
    baseUrl: config.env.OPENCODE_BASE_URL,
    directory: config.env.OPENCODE_DIRECTORY,
  }).permission.reply({
    requestID: input.requestID,
    directory: config.env.OPENCODE_DIRECTORY,
    reply: input.reply,
    message: input.message,
  })

  if (response.error) {
    throw new Error(`Failed to reply to OpenCode permission "${input.requestID}": ${JSON.stringify(response.error)}`)
  }
}

export async function listAgents(config: RuntimeConfig) {
  const response = await createOpencodeClient({
    baseUrl: config.env.OPENCODE_BASE_URL,
    directory: config.env.OPENCODE_DIRECTORY,
  }).app.agents()

  if (response.error) {
    throw new Error(`Failed to query OpenCode agents from ${config.env.OPENCODE_BASE_URL}: ${JSON.stringify(response.error)}`)
  }

  if (!response.data) {
    throw new Error(`OpenCode returned no agent payload from ${config.env.OPENCODE_BASE_URL}`)
  }

  return response.data
}

export async function validateRuntimePrerequisites(config: RuntimeConfig) {
  const agents = await listAgents(config)
  const required = [
    config.quorumConfig.designatedDrafter,
    ...config.quorumConfig.auditors,
    config.quorumConfig.summarizerAgent,
  ]

  if (config.quorumConfig.designQuorum?.enabled) {
    required.push(config.quorumConfig.designQuorum.designatedDesigner)
    required.push(...config.quorumConfig.designQuorum.auditors)
  }

  const names = new Set(agents.map((entry) => entry.name))
  const missing = required.filter((name) => !names.has(name))

  if (missing.length > 0) {
    throw new Error(`Missing required OpenCode agents: ${missing.join(", ")}`)
  }

  return {
    agents,
  }
}
