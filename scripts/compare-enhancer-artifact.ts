#!/usr/bin/env bun
/**
 * Download the interactive-enhancer Cursor cloud artifact for a run and compare
 * it to the on-disk design-html-<role>.html file.
 *
 * Usage:
 *   bun run scripts/compare-enhancer-artifact.ts [runDir] [agentId] [htmlBasename]
 *
 * Defaults target the US-Mexico border run from 2026-07-07.
 */

import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Agent } from "@cursor/sdk"
import { config as loadEnv } from "dotenv"

loadEnv()

const DEFAULT_RUN_DIR =
  "/home/mac/.local/share/qurom/runs/about-the-u-s-mexico-border-c7242d33-aac9-4345-9227-239f7466285e"
const DEFAULT_AGENT_ID = "bc-1a70b421-b5d7-492d-ab51-536c334dd9f5"
const DEFAULT_HTML_BASENAME = "design-html-interactive-enhancer.html"

function sha256(data: Buffer | string) {
  return createHash("sha256").update(data).digest("hex")
}

function artifactMatchesPath(actual: string, expectedBasename: string) {
  return actual === expectedBasename || actual.endsWith(`/${expectedBasename}`)
}

function summarizeDiff(local: string, remote: string) {
  const localLines = local.split("\n")
  const remoteLines = remote.split("\n")
  let samePrefix = 0
  while (
    samePrefix < localLines.length
    && samePrefix < remoteLines.length
    && localLines[samePrefix] === remoteLines[samePrefix]
  ) {
    samePrefix += 1
  }

  let sameSuffix = 0
  while (
    sameSuffix < localLines.length - samePrefix
    && sameSuffix < remoteLines.length - samePrefix
    && localLines[localLines.length - 1 - sameSuffix]
      === remoteLines[remoteLines.length - 1 - sameSuffix]
  ) {
    sameSuffix += 1
  }

  const localDiffLines = localLines.length - samePrefix - sameSuffix
  const remoteDiffLines = remoteLines.length - samePrefix - sameSuffix

  return {
    localLines: localLines.length,
    remoteLines: remoteLines.length,
    samePrefixLines: samePrefix,
    sameSuffixLines: sameSuffix,
    localChangedLines: localDiffLines,
    remoteChangedLines: remoteDiffLines,
  }
}

async function main() {
  const runDir = process.argv[2] ?? DEFAULT_RUN_DIR
  const agentId = process.argv[3] ?? DEFAULT_AGENT_ID
  const htmlBasename = process.argv[4] ?? DEFAULT_HTML_BASENAME
  const localPath = join(runDir, htmlBasename)
  const downloadPath = join(runDir, `cursor-download-${htmlBasename}`)

  const apiKey = process.env.CURSOR_API_KEY
  if (!apiKey) {
    console.error("CURSOR_API_KEY is not set (check .env or environment).")
    process.exit(1)
  }

  console.log(`Run dir:     ${runDir}`)
  console.log(`Agent id:    ${agentId}`)
  console.log(`Local HTML:  ${localPath}`)
  console.log("")

  const localFile = Bun.file(localPath)
  if (!(await localFile.exists())) {
    console.error(`Local file not found: ${localPath}`)
    process.exit(1)
  }
  const localText = await localFile.text()
  const localHash = sha256(localText)

  console.log("Connecting to Cursor agent…")
  const agent = await Agent.resume(agentId, { apiKey })

  try {
    const artifacts = await agent.listArtifacts()
    console.log(`Artifacts (${artifacts.length}):`)
    for (const artifact of artifacts) {
      console.log(`  - ${artifact.path} (${artifact.sizeBytes} bytes, ${artifact.updatedAt})`)
    }
    console.log("")

    const match = artifacts.find((artifact) => artifactMatchesPath(artifact.path, htmlBasename))
    if (!match) {
      console.error(`No artifact named ${htmlBasename} (or */${htmlBasename}) on agent ${agentId}.`)
      process.exit(2)
    }

    console.log(`Downloading ${match.path}…`)
    const remoteBuffer = await agent.downloadArtifact(match.path)
    await mkdir(runDir, { recursive: true })
    await writeFile(downloadPath, remoteBuffer)

    const remoteText = remoteBuffer.toString("utf8")
    const remoteHash = sha256(remoteBuffer)

    console.log("")
    console.log("Comparison")
    console.log("----------")
    console.log(`Local size:    ${localText.length} bytes`)
    console.log(`Remote size:   ${remoteText.length} bytes`)
    console.log(`Local sha256:  ${localHash}`)
    console.log(`Remote sha256: ${remoteHash}`)
    console.log(`Download saved: ${downloadPath}`)
    console.log("")

    if (localHash === remoteHash) {
      console.log("Result: IDENTICAL")
      return
    }

    console.log("Result: DIFFERENT")
    const diff = summarizeDiff(localText, remoteText)
    console.log(JSON.stringify(diff, null, 2))

    const previewLines = 12
    const localPreview = localText.split("\n").slice(0, previewLines).join("\n")
    const remotePreview = remoteText.split("\n").slice(0, previewLines).join("\n")
    console.log("")
    console.log(`Local first ${previewLines} lines:`)
    console.log(localPreview)
    console.log("")
    console.log(`Remote first ${previewLines} lines:`)
    console.log(remotePreview)
  } finally {
    await agent[Symbol.asyncDispose]()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
