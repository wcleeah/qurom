import type { z } from "zod"
import { toJsonSchema } from "@langchain/core/utils/json_schema"

import type { RuntimeConfig } from "../config"
import type { EventBus } from "../runner"
import { providerForRole } from "../providers/registry"
import type {
  AgentProvider,
  AgentRole,
  AgentRunHandle,
  ProviderPromptInput,
  ProviderPromptResult,
} from "../providers/types"
import type { PromptFileInput } from "../opencode"

const INLINE_ATTACHMENT_MAX_BYTES = 1024 * 1024

type OutputMode = "file" | "inline"

const inputContextLabels: Record<string, string> = {
  "draft.md": "draft",
  "audits.json": "audit results",
  "findings.json": "findings",
  "rebuttals.json": "rebuttals",
  "disputed.json": "disputed findings and responses",
  "document.html": "HTML document",
  "content.md": "markdown document",
}

export type RuntimePromptInput<T> = {
  role: AgentRole
  handle: AgentRunHandle
  prompt: string
  schema?: z.ZodType<T>
  variant?: string
  inputFiles?: PromptFileInput[]
  outputFile?: string
  telemetry?: ProviderPromptInput<T>["telemetry"]
}

export type AgentRuntime = {
  createHandle: (role: AgentRole, title: string, parentId?: string) => Promise<AgentRunHandle>
  prompt: <T>(input: RuntimePromptInput<T>) => Promise<ProviderPromptResult<T>>
  abort: (handle: AgentRunHandle) => Promise<void>
  providerForRole: (role: AgentRole) => AgentProvider
}

export type AgentRuntimeOptions = {
  providerForRole?: (role: AgentRole) => AgentProvider
  roleInstructions?: Record<string, string>
}

async function inlineInputFiles(prompt: string, inputFiles: PromptFileInput[] | undefined) {
  if (!inputFiles || inputFiles.length === 0) {
    return { prompt, inputFiles }
  }

  const blocks: string[] = []
  for (const file of inputFiles) {
    const bunFile = Bun.file(file.path)
    const size = bunFile.size
    if (size > INLINE_ATTACHMENT_MAX_BYTES) {
      throw new Error(`Input file ${file.filename} is too large to inline (${size} bytes; max ${INLINE_ATTACHMENT_MAX_BYTES})`)
    }
    const text = await bunFile.text()
    const label = inputContextLabels[file.filename] ?? file.filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ")
    blocks.push([
      `--- BEGIN CONTEXT: ${label} ---`,
      "",
      text,
      `--- END CONTEXT: ${label} ---`,
    ].join("\n"))
  }

  return {
    prompt: [
      prompt,
      "The following context is included directly in this prompt. Use it as the source material; do not try to read or open external files.",
      blocks.join("\n\n"),
    ].join("\n\n"),
    inputFiles: undefined,
  }
}

function outputModeFor(provider: AgentProvider, schema: z.ZodType<unknown> | undefined, outputFile: string | undefined): OutputMode {
  if (!outputFile) return "inline"
  if (schema) return provider.capabilities.has("jsonFileOutput") ? "file" : "inline"
  return provider.capabilities.has("fileOutput") ? "file" : "inline"
}

function renderOutputInstructions(input: {
  outputFile?: string
  schema?: z.ZodType<unknown>
  mode: OutputMode
}) {
  if (!input.outputFile) return ""

  if (input.schema) {
    const schema = JSON.stringify(toJsonSchema(input.schema), null, 2)
    if (input.mode === "file") {
      return [
        "## Output instructions",
        `Write JSON to the output file \`${input.outputFile}\` matching this schema:`,
        schema,
        "Respond with only `OK` when the file is written.",
        "Do not include the JSON in your response.",
      ].join("\n")
    }
    return [
      "## Output instructions",
      "Return JSON inline matching this schema:",
      schema,
      "Do not write to any output file.",
      "Do not include prose or markdown outside the JSON.",
    ].join("\n")
  }

  if (input.mode === "file") {
    return [
      "## Output instructions",
      `Write the complete output to \`${input.outputFile}\`.`,
      "Respond with only `OK` when the file is written.",
      "Do not include the output content in your response.",
    ].join("\n")
  }

  return [
    "## Output instructions",
    "Return the complete output inline.",
    "Do not write to any output file.",
    "Do not respond with only `OK`.",
  ].join("\n")
}

function renderPromptForOutputMode(input: {
  prompt: string
  outputFile?: string
  schema?: z.ZodType<unknown>
  mode: OutputMode
}) {
  const instructions = renderOutputInstructions(input)
  return [input.prompt.trim(), instructions].filter(Boolean).join("\n\n")
}

function renderRolePrompt(input: { prompt: string; instructions?: string }) {
  const instructions = input.instructions?.trim()
  if (!instructions) return input.prompt
  return [
    "## Role instructions",
    instructions,
    "## Task",
    input.prompt.trim(),
  ].join("\n\n")
}

async function renderPromptInputs(provider: AgentProvider, prompt: string, inputFiles: PromptFileInput[] | undefined) {
  if (provider.capabilities.has("inputFileAttachments")) {
    return { prompt, inputFiles }
  }
  if (provider.capabilities.has("inlineInputContext")) {
    return inlineInputFiles(prompt, inputFiles)
  }
  if (inputFiles && inputFiles.length > 0) {
    throw new Error(`Provider ${provider.id} does not support input files or inline input context`)
  }
  return { prompt, inputFiles: undefined }
}

export function createAgentRuntime(
  config: RuntimeConfig,
  bus?: EventBus,
  options: AgentRuntimeOptions = {},
): AgentRuntime {
  void bus

  function resolveProvider(role: AgentRole) {
    return options.providerForRole?.(role) ?? providerForRole(config, role)
  }

  return {
    async createHandle(role, title, parentId) {
      const provider = resolveProvider(role)
      const handle = await provider.createRunHandle({ config, role, title, parentId })
      if (!provider.capabilities.has("streamingEvents")) {
        bus?.emit({ kind: "session.created", sessionID: handle.id, role })
      }
      return handle
    },
    async prompt(input) {
      const provider = resolveProvider(input.role)
      const outputMode = outputModeFor(provider, input.schema, input.outputFile)
      const rolePrompt = provider.capabilities.has("roleInstructions")
        ? renderRolePrompt({
            prompt: input.prompt,
            instructions: options.roleInstructions?.[input.role],
          })
        : input.prompt
      const prompt = renderPromptForOutputMode({
        prompt: rolePrompt,
        outputFile: input.outputFile,
        schema: input.schema,
        mode: outputMode,
      })
      if (!provider.capabilities.has("streamingEvents")) {
        bus?.emit({ kind: "session.status", sessionID: input.handle.id, status: "running" })
      }
      try {
        const promptInput = await renderPromptInputs(provider, prompt, input.inputFiles)
        const result = await provider.prompt({
          config,
          bus,
          handle: input.handle,
          role: input.role,
          prompt: promptInput.prompt,
          schema: input.schema,
          variant: input.variant,
          inputFiles: promptInput.inputFiles,
          outputFile: outputMode === "file" ? input.outputFile : undefined,
          structuredOutput: input.schema
            ? { preferred: outputMode === "file" ? ["json_file", "plain_json"] : ["plain_json"] }
            : undefined,
          telemetry: input.telemetry,
        })
        if (!provider.capabilities.has("streamingEvents")) {
          bus?.emit({ kind: "session.status", sessionID: input.handle.id, status: "completed" })
        }
        return result
      } catch (error) {
        if (!provider.capabilities.has("streamingEvents")) {
          bus?.emit({
            kind: "session.error",
            sessionID: input.handle.id,
            name: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message : String(error),
          })
          bus?.emit({ kind: "session.status", sessionID: input.handle.id, status: "error" })
        }
        throw error
      } finally {
        if (!input.handle.keepAlive) {
          await input.handle.dispose?.()
        }
      }
    },
    async abort(handle) {
      const provider = resolveProvider(handle.role)
      await provider.abort?.(config, handle.id)
    },
    providerForRole: resolveProvider,
  }
}
