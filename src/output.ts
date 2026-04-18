import { mkdir } from "node:fs/promises"

export async function ensureArtifactDir(path: string) {
  await mkdir(path, { recursive: true })
  await Bun.write(`${path}/.gitkeep`, "")
}
