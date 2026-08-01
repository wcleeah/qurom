import { readdir, stat } from "node:fs/promises"
import { join, resolve } from "node:path"

import { quorumDataPaths } from "./data-paths"

const homeRailway = process.env.HOME ? join(process.env.HOME, ".railway", "bin", "railway") : ""
const railwayBin =
  Bun.which("railway") ?? (homeRailway && (await Bun.file(homeRailway).exists()) ? homeRailway : null)

if (!railwayBin) {
  console.error("Railway CLI not found. Install it or add ~/.railway/bin to PATH.")
  process.exit(1)
}

const dryRun = process.argv.includes("--dry-run")
const skipRuns = process.argv.includes("--skip-runs")
const skipConfig = process.argv.includes("--skip-config")

const paths = quorumDataPaths(process.env.QUORUM_DATA_DIR)

async function runRailway(args: string[], opts?: { allowFailure?: boolean }) {
  console.log(`$ railway ${args.join(" ")}`)
  if (dryRun) return { exitCode: 0, stdout: "" }
  const proc = Bun.spawn([railwayBin!, ...args], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (stdout.trim()) process.stdout.write(stdout)
  if (stderr.trim()) process.stderr.write(stderr)
  if (exitCode !== 0 && !opts?.allowFailure) {
    throw new Error(`railway ${args.join(" ")} failed with exit code ${exitCode}`)
  }
  return { exitCode, stdout, stderr }
}

async function listRemoteRuns(): Promise<Set<string>> {
  const { exitCode, stdout } = await runRailway(["volume", "files", "list", "/runs", "--json"], {
    allowFailure: true,
  })
  if (exitCode !== 0) return new Set()
  try {
    const parsed = JSON.parse(stdout) as { entries?: Array<{ name?: string; type?: string }> } | string[]
    if (Array.isArray(parsed)) {
      return new Set(parsed.map(String))
    }
    const names = (parsed.entries ?? [])
      .filter((entry) => entry.type === "directory" || entry.type === "dir" || !entry.type)
      .map((entry) => entry.name)
      .filter((name): name is string => Boolean(name))
    return new Set(names)
  } catch {
    // Fallback: treat non-JSON listing lines as names
    return new Set(
      stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/\/$/, "").split(/\s+/).pop()!)
        .filter((name) => name && name !== "." && name !== ".."),
    )
  }
}

async function upload(localPath: string, remotePath: string, overwrite: boolean) {
  const args = ["volume", "files", "upload", localPath, remotePath, "--json"]
  if (overwrite) args.push("--overwrite")
  await runRailway(args)
}

async function main() {
  console.log(`Local data dir: ${paths.root}`)
  if (dryRun) console.log("Dry run — no uploads will be performed.")

  // Confirm linked Railway context.
  await runRailway(["status", "--json"])

  if (!skipConfig) {
    const configDb = paths.configDb
    if (!(await Bun.file(configDb).exists())) {
      throw new Error(`Missing local config DB at ${configDb}`)
    }
    console.log(`Uploading config DB → /quorum-config.sqlite (overwrite)`)
    await upload(configDb, "/quorum-config.sqlite", true)
  } else {
    console.log("Skipping config upload (--skip-config)")
  }

  if (!skipRuns) {
    const runsDir = paths.runsDir
    let entries: string[] = []
    try {
      entries = (await readdir(runsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort()
    } catch (error) {
      throw new Error(`Cannot read local runs dir ${runsDir}: ${error instanceof Error ? error.message : String(error)}`)
    }

    const remoteRuns = await listRemoteRuns()
    console.log(`Local runs: ${entries.length}; remote runs listed: ${remoteRuns.size}`)

    for (const name of entries) {
      const localRun = resolve(runsDir, name)
      const st = await stat(localRun)
      if (!st.isDirectory()) continue
      if (remoteRuns.has(name)) {
        console.log(`Skip existing remote run: ${name}`)
        continue
      }
      console.log(`Uploading run ${name} → /runs/${name}`)
      await upload(localRun, `/runs/${name}`, false)
    }
  } else {
    console.log("Skipping runs upload (--skip-runs)")
  }

  console.log("migrate:prod complete.")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
