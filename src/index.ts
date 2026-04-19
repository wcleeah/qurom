import { loadRuntimeConfig } from "./config"
import { createGraph } from "./graph"
import { ensureArtifactDir } from "./output"
import { validateRuntimePrerequisites } from "./opencode"
import { inputRequestSchema } from "./schema"
import { createTelemetryEnrichment } from "./telemetry-enrichment"
import { createTelemetry } from "./telemetry"

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const inlineTopicArg = args.find((arg) => arg.startsWith("--topic="))
  const inlineFileArg = args.find((arg) => arg.startsWith("--file="))
  const topicFlagIndex = args.indexOf("--topic")
  const fileFlagIndex = args.indexOf("--file")

  const hasTopicInput = Boolean(inlineTopicArg) || topicFlagIndex >= 0
  const hasFileInput = Boolean(inlineFileArg) || fileFlagIndex >= 0

  if (hasTopicInput && hasFileInput) {
    throw new Error("Use either --topic or --file, not both.")
  }

  if (inlineTopicArg) {
    const topic = inlineTopicArg.slice("--topic=".length).trim()
    if (!topic) throw new Error("--topic requires a non-empty value.")
    return { inputMode: "topic" as const, topic }
  }

  if (inlineFileArg) {
    const documentPath = inlineFileArg.slice("--file=".length).trim()
    if (!documentPath) throw new Error("--file requires a path.")
    return { inputMode: "document" as const, documentPath }
  }

  if (topicFlagIndex >= 0) {
    const topic = args[topicFlagIndex + 1]?.trim()
    if (!topic) throw new Error("--topic requires a non-empty value.")
    return { inputMode: "topic" as const, topic }
  }

  if (fileFlagIndex >= 0) {
    const documentPath = args[fileFlagIndex + 1]?.trim()
    if (!documentPath) throw new Error("--file requires a path.")
    return { inputMode: "document" as const, documentPath }
  }

  const positionalTopic = args.join(" ").trim()
  if (!positionalTopic) return undefined
  return { inputMode: "topic" as const, topic: positionalTopic }
}

const config = await loadRuntimeConfig()

await ensureArtifactDir(config.quorumConfig.artifactDir)

const requestInput = parseArgs(process.argv)
const prerequisites = await validateRuntimePrerequisites(config)

if (!requestInput) {
  console.log(
    JSON.stringify(
      {
        status: "ready_for_phase_4",
        designatedDrafter: config.quorumConfig.designatedDrafter,
        auditors: config.quorumConfig.auditors,
        verifiedSkill: prerequisites.skill.name,
        verifiedAgents: prerequisites.agents
          .map((agent) => agent.name)
          .filter((name) => [config.quorumConfig.designatedDrafter, ...config.quorumConfig.auditors].includes(name)),
        artifactDir: config.quorumConfig.artifactDir,
        checkpointPath: config.env.QUORUM_CHECKPOINT_PATH,
        supportedInputs: ["--topic", "--file"],
      },
      null,
      2,
    ),
  )

  process.exit(0)
}

const request = inputRequestSchema.parse(requestInput)
const requestId = crypto.randomUUID()
const progress = createTelemetryEnrichment(config)
const telemetry = await createTelemetry(config, {
  requestId,
  inputMode: request.inputMode,
  topic: request.inputMode === "topic" ? request.topic : undefined,
  documentPath: request.inputMode === "document" ? request.documentPath : undefined,
})
progress.setTelemetryRun(telemetry)

await progress.start()

if (telemetry.warning) {
  console.log(`[telemetry] ${telemetry.warning}`)
}

try {
  const result = await telemetry.runWithRootObservation(async () => {
    const runResult = await createGraph(config, prerequisites.skill.content, {
      observer: {
        onNodeStart(node) {
          progress.trackNodeStart(node)
        },
        onNodeEnd(node) {
          progress.trackNodeEnd(node)
        },
        onSessionCreated({ sessionID, role }) {
          progress.trackSession(sessionID, role)
        },
      },
      telemetry: {
        run: telemetry,
        trackSessionObservation(sessionID, observation) {
          progress.trackTelemetry(sessionID, observation)
        },
      },
    }).invoke(
      {
        ...request,
        requestId,
      },
      {
        configurable: {
          thread_id: requestId,
        },
      },
    )

    await telemetry.updateTrace({
      output: {
        requestId: runResult.requestId,
        outcome: runResult.status,
        round: runResult.round,
        approvedAgents: runResult.approvedAgents,
        unresolvedFindings: runResult.unresolvedFindings.length,
        failureReason: runResult.failureReason,
        outputPath: runResult.outputPath,
      },
      metadata: {
        requestId: runResult.requestId,
        status: runResult.status,
        round: runResult.round,
        approvedAgents: runResult.approvedAgents,
        unresolvedFindings: runResult.unresolvedFindings.length,
        failureReason: runResult.failureReason,
        outputPath: runResult.outputPath,
        traced: telemetry.enabled,
      },
    })

    return runResult
  })

  if (result.outputPath) {
    await progress.persistArtifacts(result.outputPath)
  }

  console.log(
    JSON.stringify(
      {
        requestId: result.requestId,
        outcome: result.status,
        round: result.round,
        approvedAgents: result.approvedAgents,
        unresolvedFindings: result.unresolvedFindings.length,
        failureReason: result.failureReason,
        outputPath: result.outputPath,
        traceId: telemetry.traceId,
        capturedSessionIds: progress.trackedSessionIds(),
      },
      null,
      2,
    ),
  )
} finally {
  await telemetry.shutdown()
  await progress.stop()
}
