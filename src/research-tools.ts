import type { RuntimeConfig } from "./config"

export function buildResearchToolHint(config: RuntimeConfig): string {
  const lines = ["Research tool preferences:"]

  for (const tool of config.quorumConfig.researchTools.prefer) {
    lines.push(`- Prefer ${tool} when it matches the task.`)
  }

  lines.push(
    `- Preferred web search provider: ${config.quorumConfig.researchTools.webSearchProvider}. Favor online sources over local files when gathering evidence.`,
    "- Do not use Exa Agent or other Exa subagent/delegation tools. Use Exa only for direct search or fetch.",
  )
  return lines.join("\n")
}
