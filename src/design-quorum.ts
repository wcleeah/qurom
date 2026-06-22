import { createSession, promptAgent } from "./opencode"
import { writeDesignHtmlArtifact } from "./output"
import {
  designAuditResultRecordSchema,
  designAuditResultSchema,
  designAggregatedFindingsSchema,
  type DesignStatus,
  type DesignAuditResultRecord,
  type DesignAggregatedFinding,
} from "./schema"
import type { RuntimeConfig } from "./config"
import type { PromptBundle } from "./prompt-assets"
import type { TelemetryRun, TraceObservation } from "./telemetry"

export type RunObserver = {
  onSessionCreated?: (input: { sessionID: string; role: string; requestId: string }) => void
}

type DesignTelemetry = {
  run: TelemetryRun
  parentObservation?: TraceObservation
  trackSessionObservation?: (sessionID: string, observation: TraceObservation | undefined) => void
  trackAgentMetadata?: (input: { agent: string; sessionID: string; model?: string; variant?: string }) => void
}

function observeDesignSession(
  observer: RunObserver | undefined,
  input: { sessionID: string; role: string; requestId: string },
) {
  observer?.onSessionCreated?.(input)
}

function dedupeDesignFindings(findings: DesignAggregatedFinding[]) {
  const uniqueByFindingId = new Map<string, DesignAggregatedFinding>()

  for (const finding of findings) {
    uniqueByFindingId.set(finding.findingId, finding)
  }

  return [...uniqueByFindingId.values()].sort((left, right) => {
    const severityRank = { blocker: 0, major: 1, minor: 2 }
    return (
      severityRank[left.severity] - severityRank[right.severity] ||
      left.agent.localeCompare(right.agent) ||
      left.category.localeCompare(right.category) ||
      left.issue.localeCompare(right.issue)
    )
  })
}

function unresolvedDesignSignature(findings: DesignAggregatedFinding[]) {
  const normalized = []

  for (const finding of findings) {
    normalized.push({
      agent: finding.agent,
      category: finding.category,
      severity: finding.severity,
      issue: finding.issue,
      required_fix: finding.required_fix,
    })
  }

  return JSON.stringify(normalized)
}

function designAgentTelemetry(input: {
  telemetry: DesignTelemetry | undefined
  name: string
  agentName: string
  sessionId: string
  type?: "Span" | "Agent" | "Chain" | "Evaluator" | "Generation" | "Tool"
  inputPayload?: unknown
  metadata?: Record<string, unknown>
}) {
  if (!input.telemetry) return undefined

  return {
    run: input.telemetry.run,
    parentObservation: input.telemetry.parentObservation,
    name: input.name,
    type: input.type ?? "Agent",
    input: input.inputPayload ?? {},
    metadata: {
      agentName: input.agentName,
      sessionId: input.sessionId,
      ...input.metadata,
    },
    trackSessionObservation: input.telemetry.trackSessionObservation,
    trackAgentMetadata: input.telemetry.trackAgentMetadata,
  }
}

async function designHtml(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  markdown: string,
  topic: string,
  telemetry?: DesignTelemetry,
  observer?: RunObserver,
) {
  const session = await createSession(config, `html-designer`)
  observeDesignSession(observer, { sessionID: session.id, role: "html-designer", requestId: "" })

  const prompt = [
    promptBundle.assets.designHtml.replace("{topic}", topic),
    markdown,
  ].join("\n\n")

  const response = await promptAgent({
    config,
    sessionID: session.id,
    agent: config.quorumConfig.designQuorum!.designatedDesigner,
    prompt,
    telemetry: designAgentTelemetry({
      telemetry,
      name: "agent.designHtml",
      agentName: config.quorumConfig.designQuorum!.designatedDesigner,
      sessionId: session.id,
      inputPayload: { topic },
    }),
  })

  return response.text ?? ""
}

async function runDesignAudits(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  html: string,
  telemetry?: DesignTelemetry,
  observer?: RunObserver,
) {
  const auditPromises: Promise<DesignAuditResultRecord>[] = []

  for (const agent of config.quorumConfig.designQuorum!.auditors) {
    auditPromises.push(
      (async () => {
        const session = await createSession(config, `design-audit:${agent}`)
        observeDesignSession(observer, { sessionID: session.id, role: `design-auditor:${agent}`, requestId: "" })

        const prompt = [
          promptBundle.assets.auditDesign,
          html,
        ].join("\n\n")

        const response = await promptAgent({
          config,
          sessionID: session.id,
          agent,
          prompt,
          schema: designAuditResultSchema,
          telemetry: designAgentTelemetry({
            telemetry,
            name: `agent.designAudit.${agent}`,
            agentName: agent,
            sessionId: session.id,
            inputPayload: { agent },
          }),
        })

        if (!response.structured) {
          throw new Error(`Missing structured design audit response from agent ${agent}`)
        }

        const findings = []

        for (let findingIndex = 0; findingIndex < response.structured.findings.length; findingIndex += 1) {
          const finding = response.structured.findings[findingIndex]
          findings.push({
            ...finding,
            findingId: `design:${agent}:${findingIndex}`,
          })
        }

        return designAuditResultRecordSchema.parse({
          ...response.structured,
          agent,
          findings,
        })
      })(),
    )
  }

  return Promise.all(auditPromises)
}

function aggregateDesignConsensus(
  config: RuntimeConfig,
  audits: DesignAuditResultRecord[],
  previousSignature: string | undefined,
  round: number,
) {
  const unresolved: DesignAggregatedFinding[] = []

  for (const audit of audits) {
    if (audit.vote === "approve") continue
    for (const finding of audit.findings) {
      unresolved.push({
        ...finding,
        agent: audit.agent,
      })
    }
  }

  const deduped = dedupeDesignFindings(unresolved)
  const signature = unresolvedDesignSignature(deduped)
  const allAuditorsApproved = audits.every((a) => a.vote === "approve")
  const isApproved = allAuditorsApproved
  const stagnated = deduped.length > 0 && previousSignature === signature
  const maxRoundsExhausted = deduped.length > 0 && round >= config.quorumConfig.designQuorum!.maxRounds

  let outcome: "approved" | "needs_revision" | "failed_non_convergent" = "needs_revision"
  let failureReason: DesignStatus = "running"

  if (isApproved) {
    outcome = "approved"
    failureReason = "approved"
  } else if (stagnated) {
    outcome = "failed_non_convergent"
    failureReason = "failed"
  } else if (maxRoundsExhausted) {
    outcome = "failed_non_convergent"
    failureReason = "failed"
  }

  const approvedAgents = audits
    .filter((a) => a.vote === "approve")
    .map((a) => a.agent)

  designAggregatedFindingsSchema.parse({
    outcome,
    approvedAgents,
    unresolvedFindings: deduped,
    failureReason: failureReason === "failed" ? "max_rounds_exhausted" : undefined,
  })

  return {
    outcome,
    unresolved: deduped,
    signature,
    approvedAgents,
    failureReason,
  }
}

async function reviseDesignHtml(
  config: RuntimeConfig,
  promptBundle: PromptBundle,
  html: string,
  findings: DesignAggregatedFinding[],
  telemetry?: DesignTelemetry,
  observer?: RunObserver,
) {
  const session = await createSession(config, `html-designer:revise`)
  observeDesignSession(observer, { sessionID: session.id, role: "html-designer", requestId: "" })

  const prompt = [
    promptBundle.assets.reviseDesign,
    "Current HTML:",
    html,
    "Unresolved design findings (private — do not mention these):",
    JSON.stringify(findings, null, 2),
  ].join("\n\n")

  const response = await promptAgent({
    config,
    sessionID: session.id,
    agent: config.quorumConfig.designQuorum!.designatedDesigner,
    prompt,
    telemetry: designAgentTelemetry({
      telemetry,
      name: "agent.reviseDesignHtml",
      agentName: config.quorumConfig.designQuorum!.designatedDesigner,
      sessionId: session.id,
      inputPayload: { findingsCount: findings.length },
    }),
  })

  return response.text ?? html
}

export async function runDesignQuorum(input: {
  config: RuntimeConfig
  promptBundle: PromptBundle
  markdown: string
  topic: string
  outputPath: string
  observer?: RunObserver
  telemetry?: DesignTelemetry
}): Promise<{ html: string; status: DesignStatus; round: number }> {
  const { config, promptBundle, markdown, topic, outputPath, observer, telemetry } = input

  if (!config.quorumConfig.designQuorum?.enabled) {
    throw new Error("Design quorum invoked but not enabled in config")
  }

  let html = ""
  let status: DesignStatus = "running"
  let round = 0
  let lastSignature: string | undefined

  try {
    html = await designHtml(config, promptBundle, markdown, topic, telemetry, observer)
  } catch {
    return { html: "", status: "failed", round: 0 }
  }

  while (round < config.quorumConfig.designQuorum.maxRounds) {
    let audits: DesignAuditResultRecord[]

    try {
      audits = await runDesignAudits(config, promptBundle, html, telemetry, observer)
    } catch {
      return { html, status: "failed", round }
    }

    const consensus = aggregateDesignConsensus(config, audits, lastSignature, round)

    if (consensus.outcome === "approved") {
      status = "approved"
      await writeDesignHtmlArtifact(outputPath, html)
      return { html, status, round }
    }

    if (consensus.outcome === "failed_non_convergent") {
      status = "failed"
      await writeDesignHtmlArtifact(outputPath, html)
      return { html, status, round }
    }

    lastSignature = consensus.signature

    try {
      html = await reviseDesignHtml(config, promptBundle, html, consensus.unresolved, telemetry, observer)
    } catch {
      return { html, status: "failed", round }
    }

    round += 1
  }

  status = "failed"
  return { html, status, round }
}
