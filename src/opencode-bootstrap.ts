import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

import { defaultsOpencodeAgentsDir, opencodeAgentsDir } from "./data-paths"

export type OpencodeBootstrapDecision = "seed" | "overwrite" | "keep"

export type OpencodeBootstrapAssessment = {
  status: "absent" | "empty" | "matches" | "differs"
  missing: string[]
  differing: string[]
}

async function listAgentFiles(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue
      files.set(entry.name, await readFile(join(dir, entry.name), "utf8"))
    }
  } catch {
    // Directory missing.
  }
  return files
}

export async function assessOpencodeBootstrap(workspaceDir?: string): Promise<OpencodeBootstrapAssessment> {
  const targetDir = opencodeAgentsDir(workspaceDir)
  const defaultsDir = defaultsOpencodeAgentsDir(workspaceDir)
  const defaults = await listAgentFiles(defaultsDir)
  const local = await listAgentFiles(targetDir)

  if (defaults.size === 0) {
    return { status: "matches", missing: [], differing: [] }
  }

  if (local.size === 0) {
    try {
      await readdir(targetDir)
      return { status: "empty", missing: [...defaults.keys()], differing: [] }
    } catch {
      return { status: "absent", missing: [...defaults.keys()], differing: [] }
    }
  }

  const missing: string[] = []
  const differing: string[] = []
  for (const [name, content] of defaults) {
    const localContent = local.get(name)
    if (localContent === undefined) {
      missing.push(name)
      continue
    }
    if (localContent !== content) {
      differing.push(name)
    }
  }

  if (missing.length > 0 || differing.length > 0) {
    return { status: "differs", missing, differing }
  }
  return { status: "matches", missing: [], differing: [] }
}

export async function applyOpencodeBootstrap(
  decision: OpencodeBootstrapDecision,
  workspaceDir?: string,
): Promise<void> {
  if (decision === "keep") return

  const targetDir = opencodeAgentsDir(workspaceDir)
  const defaultsDir = defaultsOpencodeAgentsDir(workspaceDir)
  const defaults = await listAgentFiles(defaultsDir)
  if (defaults.size === 0) return

  await mkdir(targetDir, { recursive: true })

  if (decision === "overwrite") {
    for (const [name, content] of defaults) {
      await writeFile(join(targetDir, name), content, "utf8")
    }
    return
  }

  const assessment = await assessOpencodeBootstrap(workspaceDir)
  const toCopy = decision === "seed"
    ? [...defaults.keys()]
    : assessment.missing

  for (const name of toCopy) {
    const content = defaults.get(name)
    if (!content) continue
    const dest = join(targetDir, name)
    if (!(await Bun.file(dest).exists())) {
      await writeFile(dest, content, "utf8")
    }
  }
}

function envBootstrapDecision(): OpencodeBootstrapDecision | undefined {
  const raw = process.env.QUORUM_OPENCODE_BOOTSTRAP?.trim().toLowerCase()
  if (raw === "seed" || raw === "overwrite" || raw === "keep") return raw
  return undefined
}

export async function promptOpencodeBootstrapInteractive(
  assessment: OpencodeBootstrapAssessment,
): Promise<OpencodeBootstrapDecision> {
  if (assessment.status === "absent" || assessment.status === "empty") {
    console.log("\nOpenCode agent definitions are not set up locally.")
    console.log(`Seed ${assessment.missing.length} agent file(s) from defaults into .opencode/agents/?`)
    const rl = createInterface({ input, output })
    try {
      const answer = (await rl.question("[Y/n] ")).trim().toLowerCase()
      return answer === "n" || answer === "no" ? "keep" : "seed"
    } finally {
      rl.close()
    }
  }

  console.log("\nLocal .opencode/agents/ differs from shipped defaults.")
  if (assessment.missing.length > 0) {
    console.log(`Missing: ${assessment.missing.map((name) => basename(name)).join(", ")}`)
  }
  if (assessment.differing.length > 0) {
    console.log(`Changed: ${assessment.differing.map((name) => basename(name)).join(", ")}`)
  }
  console.log("Overwrite local OpenCode agents with defaults? [y/N/k]")
  console.log("  y = overwrite all")
  console.log("  k = keep local (add only missing files)")
  console.log("  N = keep local unchanged")

  const rl = createInterface({ input, output })
  try {
    const answer = (await rl.question("> ")).trim().toLowerCase()
    if (answer === "y" || answer === "yes") return "overwrite"
    if (answer === "k") return "seed"
    return "keep"
  } finally {
    rl.close()
  }
}

export async function resolveOpencodeBootstrap(input: { interactive: boolean; workspaceDir?: string }): Promise<void> {
  const envDecision = envBootstrapDecision()
  if (envDecision) {
    await applyOpencodeBootstrap(envDecision, input.workspaceDir)
    return
  }

  const assessment = await assessOpencodeBootstrap(input.workspaceDir)
  if (assessment.status === "matches") return

  let decision: OpencodeBootstrapDecision
  if (input.interactive && process.stdin.isTTY) {
    decision = await promptOpencodeBootstrapInteractive(assessment)
  } else if (assessment.status === "absent" || assessment.status === "empty") {
    decision = "seed"
  } else {
    console.warn(
      "[qurom] Local .opencode/agents/ differs from defaults; keeping local files. "
      + "Set QUORUM_OPENCODE_BOOTSTRAP=overwrite to refresh, or run the TUI to choose interactively.",
    )
    decision = "keep"
  }

  await applyOpencodeBootstrap(decision, input.workspaceDir)
}
