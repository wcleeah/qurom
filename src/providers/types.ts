import type { z } from "zod"

import type { Bridge, EventBus } from "../runner"
import type { RuntimeConfig } from "../config"
import type { PromptFileInput } from "../opencode"
import type { DebugLog } from "../debug-log"
import type { TelemetryRun, TraceObservation } from "../telemetry"

export type AgentProviderId = "opencode" | (string & {})

export type AgentRole = string

export type ProviderCapability =
  | "streamingEvents"
  | "toolEvents"
  | "permissionEvents"
  | "fileAttachments"
  | "fileOutput"
  | "roleInstructions"
  | "providerManagedAgents"
  | "jsonFileOutput"
  | "plainJsonOutput"

export type StructuredOutputMode = "json_file" | "plain_json"

export type AgentRunHandle = {
  id: string
  providerId: AgentProviderId
  role: AgentRole
  title: string
  providerAgent?: string
  keepAlive?: boolean
  dispose?: () => Promise<void>
}

export type ProviderRuntimeInfo = {
  cleanup?: () => Promise<void>
  metadata?: Record<string, unknown>
}

export type ProviderPrepareInput = {
  config: RuntimeConfig
}

export type CreateRunHandleInput = {
  config: RuntimeConfig
  role: AgentRole
  title: string
  parentId?: string
  providerOptions?: Record<string, unknown>
}

export type ProviderPromptInput<T> = {
  config: RuntimeConfig
  bus?: EventBus
  handle: AgentRunHandle
  role: AgentRole
  prompt: string
  schema?: z.ZodType<T>
  variant?: string
  inputFiles?: PromptFileInput[]
  outputFile?: string
  structuredOutput?: {
    preferred: StructuredOutputMode[]
  }
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
  providerOptions?: Record<string, unknown>
}

export type ProviderPromptResult<T> = {
  text?: string
  structured?: T
  model?: string
  provider?: string
  variant?: string
  outputSource?: "file" | "inline"
  raw?: unknown
}

export type ProviderBridgeInput = {
  config: RuntimeConfig
  bus: EventBus
  getRunDir: () => string | undefined
  onStreamError?: (error: unknown) => void
}

export type ProviderValidationInput = {
  config: RuntimeConfig
  roles: AgentRole[]
}

export type ProviderValidationResult = {
  providerId: AgentProviderId
  agents?: unknown[]
  warnings?: string[]
}

export type ProviderConfigFormInput = {
  config: RuntimeConfig
}

export type ProviderConfigFormModelOption = {
  id: string
  label: string
}

export type ProviderConfigFormParameterValue = {
  value: string
  label: string
}

export type ProviderConfigFormParameter = {
  id: string
  label: string
  values: ProviderConfigFormParameterValue[]
}

export type ProviderConfigFormDescriptor = {
  providerId: AgentProviderId
  modelOptions?: ProviderConfigFormModelOption[]
  parametersByModel?: Record<string, ProviderConfigFormParameter[]>
  warnings?: string[]
  fields?: {
    providerAgent?: boolean
    model?: "text" | "select" | false
    variant?: boolean
    outputMode?: boolean
  }
}

export interface AgentProvider {
  id: AgentProviderId
  capabilities: ReadonlySet<ProviderCapability>
  prepare?: (input: ProviderPrepareInput) => Promise<ProviderRuntimeInfo>
  createRunHandle: (input: CreateRunHandleInput) => Promise<AgentRunHandle>
  prompt: <T>(input: ProviderPromptInput<T>) => Promise<ProviderPromptResult<T>>
  abort?: (config: RuntimeConfig, handleId: string) => Promise<void>
  createEventBridge?: (input: ProviderBridgeInput) => Bridge
  validate?: (input: ProviderValidationInput) => Promise<ProviderValidationResult>
  configForm?: (input: ProviderConfigFormInput) => Promise<ProviderConfigFormDescriptor>
}
