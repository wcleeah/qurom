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
  requestId?: string
  path?: string
  renderer: RendererLike
  artifactRoot: string
  mode?: OpenInEditorMode
  deps?: Partial<EditorDeps>
}

export type OpenInEditorMode = "edit" | "view"

export const resolveEditorCommand = (env: NodeJS.ProcessEnv): string => env.VISUAL ?? env.EDITOR ?? "vi"

function editorArgsForMode(command: string, path: string, mode: OpenInEditorMode): { cmd: string; args: string[] } {
  if (mode === "edit") return { cmd: command, args: [path] }

  const normalized = command.trim()
  if (normalized === "vi" || normalized === "vim" || normalized === "nvim") {
    return { cmd: normalized, args: ["-R", path] }
  }
  if (normalized === "nano") {
    return { cmd: normalized, args: ["-v", path] }
  }
  if (normalized === "hx") {
    return { cmd: normalized, args: ["--readonly", path] }
  }

  return { cmd: "less", args: [path] }
}

export const draftPathFor = (artifactRoot: string, requestId: string): string =>
  join(artifactRoot, ".drafts", `${requestId}.md`)

export const openInEditor = async ({ requestId, path, renderer, artifactRoot, mode = "edit", deps }: OpenInEditorArgs): Promise<EditorResult> => {
  const d: EditorDeps = { ...defaultDeps, ...deps }
  const cmd = resolveEditorCommand(d.env)
  const draftPath = path ?? (requestId ? draftPathFor(artifactRoot, requestId) : undefined)
  if (!draftPath) throw new Error("openInEditor requires requestId or path")
  d.mkdirSync(dirname(draftPath), { recursive: true })
  if (!d.existsSync(draftPath)) d.writeFileSync(draftPath, "")

  await renderer.suspend()
  let status: number | null = 0
  let spawnError: Error | undefined
  try {
    const launch = editorArgsForMode(cmd, draftPath, mode)
    const result = d.spawnSync(launch.cmd, launch.args, { stdio: "inherit", shell: false })
    status = result.status
    if (result.error) spawnError = result.error
  } catch (err) {
    spawnError = err as Error
  } finally {
    await renderer.resume()
  }

  if (spawnError) return { ok: false, reason: "exit-code" }
  if (status !== 0) return { ok: false, reason: "exit-code", code: status ?? undefined }
  const content = d.readFileSync(draftPath, "utf8")
  if (content.trim().length === 0) return { ok: false, reason: "empty" }
  return { ok: true, content, path: draftPath }
}
