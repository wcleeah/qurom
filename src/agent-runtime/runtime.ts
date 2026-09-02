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
  SessionHarvestContext,
} from "../providers/types"
import type { PromptFileInput } from "../opencode"
import { prependFrontendDesignSkill, usesFrontendDesignSkill } from "../frontend-design-skill"
import {
  findSessionLedgerEntry,
  isHarvestableLedgerStatus,
  upsertSessionLedgerEntry,
} from "../session-ledger"
import { artifactBasename, parseHarvestedResult, readHarvestableLocalFile } from "./harvest"

const INLINE_ATTACHMENT_MAX_BYTES = 1024 * 1024
const DESIGN_PHASE_NODES: Record<string, string> = {
  drafting: "runDesignHtml",
  enhancing: "graphicalEnhance",
  reading: "readingExperienceEnhance",
  finalizing: "finalizeDesign",
}

type OutputMode = "file" | "inline"

type HarvestBusContext = {
  node?: string
  round: number
  requestId?: string
  runDir?: string
}

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
  resumeHandle: (role: AgentRole, title: string, handleId: string) => Promise<AgentRunHandle>
  prompt: <T>(input: RuntimePromptInput<T>) => Promise<ProviderPromptResult<T>>
  abort: (handle: AgentRunHandle) => Promise<void>
  providerForRole: (role: AgentRole) => AgentProvider
}

export type AgentRuntimeOptions = {
  providerForRole?: (role: AgentRole) => AgentProvider
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
  providerInstructions?: string
}) {
  if (!input.outputFile) return ""
  if (input.providerInstructions) return input.providerInstructions

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
  providerInstructions?: string
}) {
  const instructions = renderOutputInstructions(input)
  return [input.prompt.trim(), instructions].filter(Boolean).join("\n\n")
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
  const harvestContext: HarvestBusContext = { round: 0 }

  bus?.on((event) => {
    if (event.kind === "graph.node" && event.phase === "start") {
      const state = event.state && typeof event.state === "object"
        ? event.state as Record<string, unknown>
        : {}
      harvestContext.node = event.node
      harvestContext.round = typeof state.round === "number"
        ? state.round
        : typeof state.designRound === "number"
          ? state.designRound
          : 0
      harvestContext.requestId = typeof state.requestId === "string" ? state.requestId : harvestContext.requestId
      harvestContext.runDir = typeof state.outputPath === "string" ? state.outputPath : harvestContext.runDir
      return
    }
    if (event.kind === "design.phase") {
      harvestContext.node = DESIGN_PHASE_NODES[event.phase] ?? harvestContext.node
      harvestContext.round = event.round
    }
  })

  function resolveProvider(role: AgentRole) {
    return options.providerForRole?.(role) ?? providerForRole(config, role)
  }

  function currentHarvest(handle?: AgentRunHandle): SessionHarvestContext | undefined {
    if (handle?.harvest?.runDir) return handle.harvest
    if (!harvestContext.runDir || !harvestContext.node) return undefined
    return {
      runDir: harvestContext.runDir,
      node: harvestContext.node,
      round: harvestContext.round,
      requestId: harvestContext.requestId,
    }
  }

  function attachHarvest(handle: AgentRunHandle, extras?: Partial<SessionHarvestContext>): AgentRunHandle {
    const base = currentHarvest(handle)
    if (!base && !extras?.runDir) return handle
    handle.harvest = {
      runDir: extras?.runDir ?? base?.runDir ?? "",
      node: extras?.node ?? base?.node,
      round: extras?.round ?? base?.round,
      requestId: extras?.requestId ?? base?.requestId,
      expectedArtifact: extras?.expectedArtifact ?? base?.expectedArtifact,
      resumed: extras?.resumed ?? base?.resumed,
      cursorRunId: extras?.cursorRunId ?? base?.cursorRunId,
    }
    return handle
  }

  function emitCreated(provider: AgentProvider, handle: AgentRunHandle, role: AgentRole) {
    if (provider.capabilities.has("streamingEvents")) return
    bus?.emit({ kind: "session.created", sessionID: handle.id, role })
    if (handle.sessionBootstrap) {
      bus?.emit({
        kind: "session.telemetry",
        sessionID: handle.id,
        role,
        provider: handle.providerId,
        phase: "created",
        requestedModel: handle.sessionBootstrap.requestedModel,
        modelParams: handle.sessionBootstrap.modelParams,
        variant: handle.sessionBootstrap.variant,
        providerAgent: handle.providerAgent,
        completedAt: Date.now(),
      })
    }
  }

  function emitHarvest(input: {
    sessionID: string
    role: string
    source: "reattach" | "wait" | "artifacts" | "local" | "miss"
    node?: string
    reason?: string
  }) {
    bus?.emit({
      kind: "session.harvest",
      sessionID: input.sessionID,
      role: input.role,
      source: input.source,
      node: input.node,
      reason: input.reason,
    })
  }

  async function recordLedger(
    handle: AgentRunHandle,
    patch: {
      status?: "created" | "waiting" | "finished" | "error" | "harvested"
      expectedArtifact?: string
      cursorRunId?: string
    },
  ) {
    const harvest = handle.harvest
    if (!harvest?.runDir || !harvest.node) return
    try {
      await upsertSessionLedgerEntry(harvest.runDir, {
        role: handle.role,
        node: harvest.node,
        round: harvest.round ?? 0,
        requestId: harvest.requestId,
        provider: handle.providerId,
        handleId: handle.id,
        expectedArtifact: patch.expectedArtifact ?? harvest.expectedArtifact,
        cursorRunId: patch.cursorRunId ?? harvest.cursorRunId,
        status: patch.status,
      })
    } catch {
      // Ledger writes must not fail the prompt.
    }
  }

  const runtime: AgentRuntime = {
    async createHandle(role, title, parentId) {
      const provider = resolveProvider(role)
      const harvest = currentHarvest()
      if (harvest?.runDir && harvest.node && provider.resumeRunHandle) {
        const entry = await findSessionLedgerEntry(harvest.runDir, {
          role,
          node: harvest.node,
          round: harvest.round ?? 0,
        }).catch(() => undefined)
        if (entry && isHarvestableLedgerStatus(entry.status) && entry.status !== "error") {
          try {
            const resumed = attachHarvest(
              await provider.resumeRunHandle({ config, role, title, handleId: entry.handleId }),
              {
                ...harvest,
                resumed: true,
                cursorRunId: entry.cursorRunId,
                expectedArtifact: entry.expectedArtifact,
              },
            )
            emitCreated(provider, resumed, role)
            emitHarvest({
              sessionID: resumed.id,
              role,
              source: "reattach",
              node: harvest.node,
            })
            return resumed
          } catch {
            emitHarvest({
              sessionID: entry.handleId,
              role,
              source: "miss",
              node: harvest.node,
              reason: "resume failed",
            })
          }
        }
      }

      const handle = attachHarvest(await provider.createRunHandle({ config, role, title, parentId }))
      emitCreated(provider, handle, role)
      await recordLedger(handle, { status: "created" })
      return handle
    },
    async resumeHandle(role, title, handleId) {
      const provider = resolveProvider(role)
      if (!provider.resumeRunHandle) {
        throw new Error(`Provider ${provider.id} does not support resuming run handles`)
      }
      return attachHarvest(
        await provider.resumeRunHandle({ config, role, title, handleId }),
        { resumed: true },
      )
    },
    async prompt(input) {
      const provider = resolveProvider(input.role)
      const handle = attachHarvest(input.handle, {
        expectedArtifact: artifactBasename(input.outputFile),
      })
      if (handle.harvest?.expectedArtifact === undefined && input.outputFile) {
        handle.harvest = {
          ...(handle.harvest ?? { runDir: "" }),
          expectedArtifact: artifactBasename(input.outputFile),
        }
      }

      const harvested = await tryHarvestPrompt({
        provider,
        handle,
        role: input.role,
        outputFile: input.outputFile,
        schema: input.schema,
        config,
        bus,
        telemetry: input.telemetry,
        emitHarvest,
        recordLedger,
      })
      if (harvested.status === "done") {
        if (!handle.keepAlive) await handle.dispose?.()
        return harvested.result
      }
      if (harvested.status === "replace") {
        if (!handle.keepAlive) await handle.dispose?.()
        const replacement = await runtime.createHandle(input.role, handle.title)
        replacement.keepAlive = handle.keepAlive
        return runtime.prompt({ ...input, handle: replacement })
      }

      const outputMode = outputModeFor(provider, input.schema, input.outputFile)
      const workspaceDir = config.env.QUORUM_WORKSPACE_DIRECTORY || config.env.OPENCODE_DIRECTORY
      const taskPrompt = usesFrontendDesignSkill(input.role)
        ? await prependFrontendDesignSkill(input.prompt, workspaceDir)
        : input.prompt
      const prompt = renderPromptForOutputMode({
        prompt: taskPrompt,
        outputFile: input.outputFile,
        schema: input.schema,
        mode: outputMode,
        providerInstructions: outputMode === "file" && input.outputFile
          ? provider.outputInstructions?.({
              config,
              handle,
              role: input.role,
              outputFile: input.outputFile,
              schema: input.schema,
            })
          : undefined,
      })
      if (!provider.capabilities.has("streamingEvents")) {
        bus?.emit({ kind: "session.status", sessionID: handle.id, status: "running" })
      }
      await recordLedger(handle, {
        status: "waiting",
        expectedArtifact: artifactBasename(input.outputFile),
      })
      try {
        const promptInput = await renderPromptInputs(provider, prompt, input.inputFiles)
        const result = await provider.prompt({
          config,
          bus,
          handle,
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
          bus?.emit({ kind: "session.status", sessionID: handle.id, status: "completed" })
        }
        await recordLedger(handle, { status: "finished" })
        return result
      } catch (error) {
        await recordLedger(handle, { status: "error" })
        if (!provider.capabilities.has("streamingEvents")) {
          bus?.emit({
            kind: "session.error",
            sessionID: handle.id,
            name: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message : String(error),
          })
          bus?.emit({ kind: "session.status", sessionID: handle.id, status: "error" })
        }
        throw error
      } finally {
        if (!handle.keepAlive) {
          await handle.dispose?.()
        }
      }
    },
    async abort(handle) {
      const provider = resolveProvider(handle.role)
      await provider.abort?.(config, handle.id)
    },
    providerForRole: resolveProvider,
  }
  return runtime
}

async function tryHarvestPrompt<T>(input: {
  provider: AgentProvider
  handle: AgentRunHandle
  role: AgentRole
  outputFile?: string
  schema?: import("zod").ZodType<T>
  config: RuntimeConfig
  bus?: EventBus
  telemetry?: ProviderPromptInput<T>["telemetry"]
  emitHarvest: (event: {
    sessionID: string
    role: string
    source: "reattach" | "wait" | "artifacts" | "local" | "miss"
    node?: string
    reason?: string
  }) => void
  recordLedger: (
    handle: AgentRunHandle,
    patch: { status?: "created" | "waiting" | "finished" | "error" | "harvested"; expectedArtifact?: string },
  ) => Promise<void>
}): Promise<{ status: "done"; result: ProviderPromptResult<T> } | { status: "continue" } | { status: "replace" }> {
  const harvest = input.handle.harvest
  if (!harvest?.runDir || !harvest.node) return { status: "continue" }

  const entry = await findSessionLedgerEntry(harvest.runDir, {
    role: input.handle.role,
    node: harvest.node,
    round: harvest.round ?? 0,
  }).catch(() => undefined)

  const allowLocal = entry?.status === "finished" || entry?.status === "harvested"
    || (entry?.status === "waiting" && !input.provider.collectExistingOutput)
  if (allowLocal && !input.handle.keepAlive) {
    const local = await readHarvestableLocalFile({
      outputFile: input.outputFile,
      schema: input.schema,
    })
    if (local) {
      input.emitHarvest({
        sessionID: input.handle.id,
        role: input.role,
        source: "local",
        node: harvest.node,
      })
      await input.recordLedger(input.handle, {
        status: "harvested",
        expectedArtifact: artifactBasename(input.outputFile),
      })
      if (!input.provider.capabilities.has("streamingEvents")) {
        input.bus?.emit({ kind: "session.status", sessionID: input.handle.id, status: "completed" })
      }
      return { status: "done", result: local }
    }
  }

  if (!input.provider.collectExistingOutput) return { status: "continue" }
  const shouldCollect = harvest.resumed || entry?.status === "waiting"
  if (!shouldCollect) return { status: "continue" }

  const collected = await input.provider.collectExistingOutput({
    config: input.config,
    bus: input.bus,
    handle: input.handle,
    role: input.role,
    outputFile: input.outputFile,
    schema: input.schema,
    telemetry: input.telemetry,
  })

  if (input.handle.keepAlive && (collected.status !== "harvested" || collected.source !== "wait")) {
    return { status: "continue" }
  }

  if (collected.status === "harvested") {
    const parsed = await parseHarvestedResult({
      result: collected.result,
      outputFile: input.outputFile,
      schema: input.schema,
    })
    if (parsed) {
      input.emitHarvest({
        sessionID: input.handle.id,
        role: input.role,
        source: collected.source === "wait" ? "wait" : "artifacts",
        node: harvest.node,
      })
      await input.recordLedger(input.handle, {
        status: "harvested",
        expectedArtifact: artifactBasename(input.outputFile),
      })
      if (!input.provider.capabilities.has("streamingEvents")) {
        input.bus?.emit({ kind: "session.status", sessionID: input.handle.id, status: "completed" })
      }
      return { status: "done", result: parsed }
    }
    input.emitHarvest({
      sessionID: input.handle.id,
      role: input.role,
      source: "miss",
      node: harvest.node,
      reason: "harvested output failed validation",
    })
    await input.recordLedger(input.handle, { status: "error" })
    return input.handle.keepAlive ? { status: "continue" } : { status: "replace" }
  }

  if (collected.status === "idle") return { status: "continue" }

  input.emitHarvest({
    sessionID: input.handle.id,
    role: input.role,
    source: "miss",
    node: harvest.node,
    reason: collected.reason,
  })
  await input.recordLedger(input.handle, { status: "error" })
  return input.handle.keepAlive ? { status: "continue" } : { status: "replace" }
}
