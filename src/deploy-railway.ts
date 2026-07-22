import { join, resolve } from "node:path"

import { exportStaticSite } from "./view/static-export"

const outputDir = resolve("dist/static")
const homeRailway = process.env.HOME ? join(process.env.HOME, ".railway", "bin", "railway") : ""
const railway = Bun.which("railway") ?? (homeRailway && await Bun.file(homeRailway).exists() ? homeRailway : null)

if (!railway) {
  console.error("Railway CLI not found. Install it or add ~/.railway/bin to PATH.")
  process.exit(1)
}

const exported = await exportStaticSite(outputDir)
console.log(`Exported ${exported.runCount} successful run${exported.runCount === 1 ? "" : "s"} to ${outputDir}`)
console.log("Uploading static bundle to the linked Railway service...")

const deployment = Bun.spawn([
  railway,
  "up",
  outputDir,
  "--path-as-root",
  "--no-gitignore",
  "--yes",
], {
  cwd: process.cwd(),
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

const exitCode = await deployment.exited
if (exitCode !== 0) {
  console.error(`Railway deployment failed with exit code ${exitCode}`)
  process.exit(exitCode)
}
