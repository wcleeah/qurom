import { loadRuntimeConfig } from "./config"
import { createGraph } from "./graph"
import { ensureArtifactDir } from "./output"
import { validateRuntimePrerequisites } from "./opencode"
import { inputRequestSchema } from "./schema"

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const topicFlagIndex = args.indexOf("--topic")
  const fileFlagIndex = args.indexOf("--file")

  if (topicFlagIndex >= 0 && fileFlagIndex >= 0) {
    throw new Error("Use either --topic or --file, not both.")
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
        status: "ready_for_phase_3_5",
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
const result = await createGraph(config, prerequisites.skill.content).invoke(request, {
  configurable: {
    thread_id: crypto.randomUUID(),
  },
})

console.log(JSON.stringify(result, null, 2))
