#!/usr/bin/env bun
/**
 * Recover a run stranded at interactiveEnhance when the Cursor cloud agent finished
 * but Qurom never passed run.wait(). Uses the downloaded cloud artifact (or re-downloads).
 *
 * Usage:
 *   bun run scripts/recover-stranded-design-run.ts [runDir] [round] [htmlBasename]
 */

import { copyFile, rename, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { writeDesignHtmlArtifact } from "../src/output"
import type { NodeHistoryEntry } from "../src/view/types"

const DEFAULT_RUN_DIR =
  "/home/mac/.local/share/qurom/runs/about-the-u-s-mexico-border-c7242d33-aac9-4345-9227-239f7466285e"

async function readJson<T>(path: string): Promise<T> {
  return await Bun.file(path).json() as T
}

async function main() {
  const runDir = process.argv[2] ?? DEFAULT_RUN_DIR
  const round = Number(process.argv[3] ?? "0")
  const htmlBasename = process.argv[4] ?? "design-html-interactive-enhancer.html"
  const htmlPath = join(runDir, htmlBasename)
  const downloadPath = join(runDir, `cursor-download-${htmlBasename}`)

  const downloadFile = Bun.file(downloadPath)
  if (!(await downloadFile.exists())) {
    console.error(`Missing cloud download at ${downloadPath}`)
    console.error("Run scripts/compare-enhancer-artifact.ts first.")
    process.exit(1)
  }

  const html = await downloadFile.text()
  if (!/<\/html>\s*$/i.test(html.trim())) {
    console.error("Downloaded HTML does not end with </html>; refusing to recover.")
    process.exit(1)
  }

  const localFile = Bun.file(htmlPath)
  if (await localFile.exists()) {
    const local = await localFile.text()
    if (local !== html) {
      await rename(htmlPath, join(runDir, `${htmlBasename}.pre-recovery`))
      console.log(`Backed up stale ${htmlBasename} → ${htmlBasename}.pre-recovery`)
    }
  }

  await copyFile(downloadPath, htmlPath)
  await writeDesignHtmlArtifact(runDir, html)
  console.log(`Wrote ${htmlBasename} and final.html`)

  const nodeHistoryPath = join(runDir, "node-history.json")
  const nodeHistory = await readJson<NodeHistoryEntry[]>(nodeHistoryPath).catch(() => [] as NodeHistoryEntry[])

  const runStatusPath = join(runDir, "run-status.json")
  const runStatus = await readJson<Record<string, unknown>>(runStatusPath).catch(() => ({}))

  const enhanceStartedAt = typeof runStatus.nodeStartedAt === "number"
    ? runStatus.nodeStartedAt
    : Date.now() - 600_000
  const enhanceCompletedAt = (await Bun.file(downloadPath).stat()).mtimeMs
  const finalizeCompletedAt = Date.now()

  const filtered = nodeHistory.filter((entry) =>
    entry.node !== "interactiveEnhance" && entry.node !== "finalizeDesign")

  const completedHistory: NodeHistoryEntry[] = [
    ...filtered,
    {
      node: "interactiveEnhance",
      startedAt: enhanceStartedAt,
      completedAt: enhanceCompletedAt,
      durationMs: Math.max(0, enhanceCompletedAt - enhanceStartedAt),
      status: "completed",
      round,
      researchPhase: "approved",
    },
    {
      node: "finalizeDesign",
      startedAt: enhanceCompletedAt,
      completedAt: finalizeCompletedAt,
      durationMs: Math.max(0, finalizeCompletedAt - enhanceCompletedAt),
      status: "completed",
      round,
      researchPhase: "approved",
    },
  ]

  await writeFile(nodeHistoryPath, JSON.stringify(completedHistory))

  const snapshot = {
    ...runStatus,
    phase: "complete",
    agents: {},
    node: undefined,
    nodeStartedAt: undefined,
    nodeHistory: completedHistory,
  }
  delete snapshot.node
  delete snapshot.nodeStartedAt
  delete snapshot.agents

  await writeFile(runStatusPath, JSON.stringify(snapshot))

  try {
    await unlink(join(runDir, "live-status.json"))
  } catch {
    // already removed
  }

  console.log(`Recovered run at ${runDir}`)
  console.log("Open final.html in the dashboard or resume is no longer needed.")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
