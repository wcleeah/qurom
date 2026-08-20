import type { RuntimeConfig } from "./config"
import { pipelineAgentRoles } from "./role-registry"
import { providerForRole } from "./providers/registry"
import type { AgentRole } from "./providers/types"

const activeRequestIds = new Set<string>()

export type PipelineConcurrencyPolicy = {
  /** Effective cap after provider safety checks. */
  maxConcurrent: number
  /** Value from quorum config before provider gating. */
  requestedMaxConcurrent: number
  cursorCloudOnly: boolean
  hasOpenCode: boolean
  hasLocalCursor: boolean
  reason: string
}

function cursorRuntime(config: RuntimeConfig, role: AgentRole): "local" | "cloud" | undefined {
  const options = config.roleBindings[role]?.options as { runtime?: unknown } | undefined
  return options?.runtime === "local" || options?.runtime === "cloud" ? options.runtime : undefined
}

export function pipelineConcurrencyPolicy(
  config: RuntimeConfig,
  roles: AgentRole[] = pipelineAgentRoles(config),
): PipelineConcurrencyPolicy {
  const requestedMaxConcurrent = config.quorumConfig.maxConcurrentRuns ?? 1
  let hasOpenCode = false
  let hasLocalCursor = false
  let hasCursorCloud = false

  for (const role of roles) {
    const providerId = providerForRole(config, role).id
    if (providerId !== "cursor") {
      hasOpenCode = true
      continue
    }
    if (providerId === "cursor") {
      if (cursorRuntime(config, role) === "local") {
        hasLocalCursor = true
      } else {
        hasCursorCloud = true
      }
    }
  }

  const cursorCloudOnly = hasCursorCloud && !hasOpenCode && !hasLocalCursor

  if (requestedMaxConcurrent <= 1) {
    return {
      maxConcurrent: 1,
      requestedMaxConcurrent,
      cursorCloudOnly,
      hasOpenCode,
      hasLocalCursor,
      reason: "Quorum policy is set to one active pipeline.",
    }
  }

  if (hasOpenCode) {
    return {
      maxConcurrent: 1,
      requestedMaxConcurrent,
      cursorCloudOnly,
      hasOpenCode,
      hasLocalCursor,
      reason: "OpenCode owns a single serve process and shared workspace, so pipelines stay serial.",
    }
  }

  if (hasLocalCursor) {
    return {
      maxConcurrent: 1,
      requestedMaxConcurrent,
      cursorCloudOnly,
      hasOpenCode,
      hasLocalCursor,
      reason: "Local Cursor agents share this machine's workspace, so pipelines stay serial.",
    }
  }

  if (!hasCursorCloud) {
    return {
      maxConcurrent: 1,
      requestedMaxConcurrent,
      cursorCloudOnly,
      hasOpenCode,
      hasLocalCursor,
      reason: "No Cursor cloud roles are bound, so concurrent pipelines stay disabled.",
    }
  }

  return {
    maxConcurrent: requestedMaxConcurrent,
    requestedMaxConcurrent,
    cursorCloudOnly,
    hasOpenCode,
    hasLocalCursor,
    reason: `Cursor cloud roles can run up to ${requestedMaxConcurrent} isolated pipelines.`,
  }
}

export function atConcurrencyCapacity(activeCount: number, policy: PipelineConcurrencyPolicy): boolean {
  return activeCount >= policy.maxConcurrent
}

export function concurrencyBusyMessage(policy: PipelineConcurrencyPolicy, activeCount: number): string {
  if (policy.maxConcurrent <= 1) {
    return "A run is already active"
  }
  return `Already running ${activeCount} of ${policy.maxConcurrent} allowed concurrent runs`
}

export function trackActiveRequest(runRef: string): () => void {
  const ids = new Set<string>([runRef.trim()])
  const uuid = runRef.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)?.[0]
  if (uuid) ids.add(uuid)
  for (const id of ids) activeRequestIds.add(id)
  return () => {
    for (const id of ids) activeRequestIds.delete(id)
  }
}

export function listActiveRequestIds(): string[] {
  return [...activeRequestIds]
}

export function hasConcurrentActiveRequest(requestId: string, knownIds: Iterable<string> = activeRequestIds): boolean {
  for (const id of knownIds) {
    if (id && id !== requestId) return true
  }
  return false
}

/** @internal */
export function resetActiveRequestsForTests() {
  activeRequestIds.clear()
}
