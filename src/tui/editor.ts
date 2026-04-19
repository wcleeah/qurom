import { spawnSync as defaultSpawnSync, type SpawnSyncReturns } from "node:child_process"
import {
  existsSync as defaultExistsSync,
  mkdirSync as defaultMkdirSync,
  readFileSync as defaultReadFileSync,
  writeFileSync as defaultWriteFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

export type EditorResult =
  | { ok: true; content: string; path: string }
  | { ok: false; reason: "cancelled" | "empty" | "exit-code"; code?: number }

export interface RendererLike {
  suspend(): Promise<void> | void
  resume(): Promise<void> | void
}

export interface EditorDeps {
  spawnSync: (cmd: string, args: string[], opts: { stdio: "inherit"; shell: false }) => SpawnSyncReturns<Buffer>
  existsSync: (p: string) => boolean
  mkdirSync: (p: string, opts: { recursive: true }) => void
  readFileSync: (p: string, enc: "utf8") => string
  writeFileSync: (p: string, data: string) => void
  env: NodeJS.ProcessEnv
}

const defaultDeps: EditorDeps = {
  spawnSync: defaultSpawnSync as EditorDeps["spawnSync"],
  existsSync: defaultExistsSync,
  mkdirSync: defaultMkdirSync,
  readFileSync: defaultReadFileSync as EditorDeps["readFileSync"],
  writeFileSync: defaultWriteFileSync as EditorDeps["writeFileSync"],
  env: process.env,
}

export interface OpenInEditorArgs {
  requestId: string
  renderer: RendererLike
  artifactRoot: string
  deps?: Partial<EditorDeps>
}

export const resolveEditorCommand = (env: NodeJS.ProcessEnv): string => env.VISUAL ?? env.EDITOR ?? "vi"

export const draftPathFor = (artifactRoot: string, requestId: string): string =>
  join(artifactRoot, ".drafts", `${requestId}.md`)

export const openInEditor = async ({ requestId, renderer, artifactRoot, deps }: OpenInEditorArgs): Promise<EditorResult> => {
  const d: EditorDeps = { ...defaultDeps, ...deps }
  const cmd = resolveEditorCommand(d.env)
  const path = draftPathFor(artifactRoot, requestId)
  d.mkdirSync(dirname(path), { recursive: true })
  if (!d.existsSync(path)) d.writeFileSync(path, "")

  await renderer.suspend()
  let status: number | null = 0
  let spawnError: Error | undefined
  try {
    const result = d.spawnSync(cmd, [path], { stdio: "inherit", shell: false })
    status = result.status
    if (result.error) spawnError = result.error
  } catch (err) {
    spawnError = err as Error
  } finally {
    await renderer.resume()
  }

  if (spawnError) return { ok: false, reason: "exit-code" }
  if (status !== 0) return { ok: false, reason: "exit-code", code: status ?? undefined }
  const content = d.readFileSync(path, "utf8")
  if (content.trim().length === 0) return { ok: false, reason: "empty" }
  return { ok: true, content, path }
}
