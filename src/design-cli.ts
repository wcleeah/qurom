import { loadRuntimeConfig } from "./config"
import { loadPromptBundle } from "./prompt-assets"
import { prepareConfiguredProviders } from "./providers/registry"
import { createEventBus, runDesignPipeline } from "./runner"

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.error("Usage: bun run design <run-directory>")
    console.error("Example: bun run design runs/my-topic-abc123")
    process.exit(1)
  }

  const runId = args[0]

  const config = await loadRuntimeConfig()

  if (!config.quorumConfig.designQuorum?.enabled) {
    console.error("Design quorum is not enabled in quorum.config.json (set designQuorum.enabled: true)")
    process.exit(1)
  }

  const stopProviders = await prepareConfiguredProviders(config)

  try {
    console.log(`Loading prompt bundle...`)
    const promptBundle = await loadPromptBundle(config)

    console.log(`Resuming design quorum for ${runId}...`)
    const bus = createEventBus()
    const result = await runDesignPipeline({ config, promptBundle, runId, bus })
    const outputPath = result.outputPath ?? runId

    if (result.designStatus === "approved") {
      console.log(`✅ Design approved after ${result.designRound ?? 0} round(s) → ${outputPath}/final.html`)
    } else {
      console.log(`⚠️  Design pipeline finished with status: ${result.designStatus ?? result.status} after ${result.designRound ?? result.round} round(s)`)
      console.log(`   HTML written to ${outputPath}/final.html`)
    }
  } finally {
    await stopProviders().catch(() => {})
  }
}

main().catch((error) => {
  console.error("Design quorum failed:", error instanceof Error ? error.message : String(error))
  process.exit(1)
})
