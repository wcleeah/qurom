import { loadRuntimeConfig } from "./config"
import { ensureArtifactDir } from "./output"
import { verifyRequiredSkill } from "./opencode"

const config = await loadRuntimeConfig()

await ensureArtifactDir(config.quorumConfig.artifactDir)
const skill = await verifyRequiredSkill(config)

console.log(
  JSON.stringify(
    {
      status: "ready_for_phase_2",
      designatedDrafter: config.quorumConfig.designatedDrafter,
      auditors: config.quorumConfig.auditors,
      verifiedSkill: skill.name,
      artifactDir: config.quorumConfig.artifactDir,
    },
    null,
    2,
  ),
)
