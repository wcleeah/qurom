import { resolve } from "node:path"

import { exportStaticSite } from "./view/static-export"

function outputArgument(args: string[]): string {
  const outputFlag = args.findIndex((arg) => arg === "--output" || arg === "-o")
  if (outputFlag >= 0) {
    const value = args[outputFlag + 1]
    if (!value) throw new Error(`${args[outputFlag]} requires a directory`)
    return value
  }
  const positional = args.find((arg) => !arg.startsWith("-"))
  return positional ?? "dist/static"
}

try {
  const outputDir = resolve(outputArgument(process.argv.slice(2)))
  const result = await exportStaticSite(outputDir)
  console.log(`Exported ${result.runCount} successful run${result.runCount === 1 ? "" : "s"} to ${result.outputDir}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
