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

function buildStructuredRepairPrompt(input: {
  schema: Record<string, unknown>
  previousResponse: string
  error: unknown
}) {
  return [
    "Your previous response did not match the required output format.",
    "Return only a single JSON object as plain text.",
    "Do not include markdown fences, prose, or explanation.",
    "<required_json_schema>",
    JSON.stringify(input.schema, null, 2),
    "</required_json_schema>",
    "<validation_errors>",
    formatStructuredError(input.error),
    "</validation_errors>",
    "<previous_response>",
    input.previousResponse,
    "</previous_response>",
  ].join("\n\n")
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

function parseStructuredResponse<T>(schema: z.ZodType<T>, text: string) {
  return schema.parse(JSON.parse(text))
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
    input.telemetry?.run.traceId && input.telemetry.run.rootObservation
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
      input.telemetry?.run.traceId && agentObservation
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

    const response = await client.session.prompt({
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

    if (response.error) {
      await input.telemetry?.run.endObservation(generationObservation, {
        level: "ERROR",
        statusMessage: `OpenCode prompt failed: ${JSON.stringify(response.error)}`,
      })
      throw new Error(
        `Failed to prompt agent ${input.agent} in session ${activeSessionID}: ${JSON.stringify(response.error)}`,
      )
    }

    if (!response.data) {
      await input.telemetry?.run.endObservation(generationObservation, {
        level: "ERROR",
        statusMessage: "OpenCode returned no response data",
      })
      throw new Error(`OpenCode returned no response data for agent ${input.agent} in session ${activeSessionID}`)
    }

    const info = assistantInfoSchema.parse(response.data.info)
    model = info.modelID
    provider = info.providerID
    variant = info.variant ?? input.variant
    input.telemetry?.trackAgentMetadata?.({ agent: input.agent, sessionID: activeSessionID, model, variant })

    if (info.error) {
      await input.telemetry?.run.endObservation(generationObservation, {
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
      const continueResponse = await client.session.prompt({
        sessionID: activeSessionID,
        agent: input.agent,
        variant: input.variant,
        parts: [{ type: "text", text: "Continue. Produce your output now." } satisfies TextPartInput],
      })
      if (continueResponse.data && !continueResponse.error) {
        finalText = extractText(continueResponse.data.parts)
      }
    }

    await input.telemetry?.run.endObservation(generationObservation, {
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

  async function readOutputFile(): Promise<string | undefined> {
    if (!input.outputFile) return undefined
    const file = Bun.file(input.outputFile)
    if (!(await file.exists())) {
      console.warn(`[opencode] Output file not written by agent: ${input.outputFile}`)
      return undefined
    }
    const content = await file.text()
    if (!content.trim()) {
      console.warn(`[opencode] Output file empty: ${input.outputFile}`)
      return undefined
    }
    return content
  }

  try {
    if (!input.schema) {
      const response = await sendPrompt(prompt)

      // If outputFile was requested, read it back (agent wrote there instead of responding inline)
      const fileContent = await readOutputFile()
      const outputText = fileContent ?? response.text

      await input.telemetry?.run.endObservation(agentObservation, {
        output: {
          response: response.text,
          outputFile: input.outputFile,
          fileRead: Boolean(fileContent),
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
    const fileContent = await readOutputFile()

    async function parseAndReturn(schema: z.ZodType<T>, sourceText: string, sourceLabel: string) {
      try {
        const structured = parseStructuredResponse(schema, sourceText)
        await input.telemetry?.run.endObservation(agentObservation, {
          output: {
            response: sourceText,
            parsed: structured,
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
        return {
          text: undefined,
          structured,
          model,
          provider,
        }
      } catch (err) {
        throw new Error(
          `Structured response ${sourceLabel} from agent ${input.agent} could not be parsed: ${formatStructuredError(err)}`,
        )
      }
    }

    // Prefer file output if available — with repair on parse failure
    if (fileContent) {
      try {
        return parseAndReturn(input.schema, fileContent, `from file ${input.outputFile}`)
      } catch (fileParseError) {
        input.telemetry?.debugLog?.write("session.file_repair", {
          sessionID: activeSessionID,
          agent: input.agent,
          error: formatStructuredError(fileParseError),
        })
        // File parse failed — create a repair session to fix the malformed JSON
        repaired = true
        const repairSession = await createSession(input.config, `json-fixer:${input.outputFile}`)
        input.telemetry?.trackSessionObservation?.(repairSession.id, agentObservation)
        const previousSessionID = activeSessionID
        activeSessionID = repairSession.id
        // Temporarily switch agent for the repair call
        const savedAgent = input.agent
        input.agent = "json-fixer"

        await sendPrompt(
          buildFileRepairPrompt({
            outputFile: input.outputFile!,
            parseError: formatStructuredError(fileParseError),
          }),
        )
        input.agent = savedAgent
        activeSessionID = previousSessionID

        // Re-read the repaired file
        const repairedFile = await readOutputFile()
        if (!repairedFile) {
          throw new Error(
            `Agent ${input.agent} failed to repair output file ${input.outputFile}: file not written after repair`,
          )
        }

        try {
          return parseAndReturn(input.schema, repairedFile, `from repaired file ${input.outputFile}`)
        } catch (repairError) {
          throw new Error(
            [
              `Structured response in file ${input.outputFile} from agent ${input.agent} remained invalid after repair.`,
              `Initial error: ${formatStructuredError(fileParseError)}`,
              `Repair error: ${formatStructuredError(repairError)}`,
            ].join("\n"),
          )
        }
      }
    }

    try {
      return parseAndReturn(input.schema, initialResponse.text, "from inline response")
    } catch (initialError) {
      repaired = true
      const repairSession = await createSession(input.config, `${input.agent}:repair`)
      input.telemetry?.trackSessionObservation?.(repairSession.id, agentObservation)
      const previousSessionID = activeSessionID
      activeSessionID = repairSession.id
      const repairedResponse = await sendPrompt(
        buildStructuredRepairPrompt({
          schema: jsonSchema,
          previousResponse: initialResponse.text,
          error: initialError,
        }),
      )
      activeSessionID = previousSessionID

      try {
        const structured = parseStructuredResponse(input.schema, repairedResponse.text)

        await input.telemetry?.run.endObservation(agentObservation, {
          output: {
            response: repairedResponse.text,
            parsed: structured,
            structured: true,
            repaired,
          },
          metadata: {
            agentName: input.agent,
            sessionId: repairSession.id,
            model,
            provider,
            variant,
            repaired,
          },
        })

        return {
          text: undefined,
          structured,
          model,
          provider,
        }
      } catch (repairError) {
        throw new Error(
          [
            `Structured response from agent ${input.agent} in session ${repairSession.id} remained invalid after repair.`,
            `Initial error: ${formatStructuredError(initialError)}`,
            `Repair error: ${formatStructuredError(repairError)}`,
            `Last response: ${JSON.stringify(repairedResponse.text)}`,
          ].join("\n"),
        )
      }
    }
  } catch (error) {
    await input.telemetry?.run.endObservation(agentObservation, {
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
