import { loadRuntimeConfig } from "./config"
import { loadPromptBundle } from "./prompt-assets"
import { runDesignForExistingRun } from "./design-quorum"

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.error("Usage: bun run design <run-directory>")
    console.error("Example: bun run design runs/my-topic-abc123")
    process.exit(1)
  }

  const runDir = args[0]

  const config = await loadRuntimeConfig()

  if (!config.quorumConfig.designQuorum?.enabled) {
    console.error("Design quorum is not enabled in quorum.config.json (set designQuorum.enabled: true)")
    process.exit(1)
  }

  console.log(`Loading prompt bundle...`)
  const promptBundle = await loadPromptBundle(config)

  console.log(`Running design quorum for ${runDir}...`)
  const result = await runDesignForExistingRun({ config, promptBundle, runDir })

  if (result.status === "approved") {
    console.log(`✅ Design approved after ${result.round} round(s) → ${runDir}/final.html`)
  } else {
    console.log(`⚠️  Design pipeline finished with status: ${result.status} after ${result.round} round(s)`)
    console.log(`   HTML written to ${runDir}/final.html`)
  }
}

main().catch((error) => {
  console.error("Design quorum failed:", error instanceof Error ? error.message : String(error))
  process.exit(1)
})
