import { mkdir } from "node:fs/promises"

export async function ensureArtifactDir(path: string) {
  await mkdir(path, { recursive: true })
  await Bun.write(`${path}/.gitkeep`, "")
}

export async function ensureRunDir(root: string, requestId: string) {
  const runDir = `${root}/${requestId}`
  await mkdir(runDir, { recursive: true })
  return runDir
}

export async function writeApprovedArtifacts(
  runDir: string,
  input: {
    draft: string
    summary: Record<string, unknown>
  },
) {
  await Bun.write(`${runDir}/final.md`, input.draft)
  await Bun.write(`${runDir}/summary.json`, JSON.stringify(input.summary, null, 2))
}

export async function writeFailedArtifacts(
  runDir: string,
  input: {
    draft: string
    summary: Record<string, unknown>
  },
) {
  await Bun.write(`${runDir}/latest-draft.md`, input.draft)
  await Bun.write(`${runDir}/failure.json`, JSON.stringify(input.summary, null, 2))
}
