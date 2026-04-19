import { describe, expect, test } from "bun:test"
import type { SpawnSyncReturns } from "node:child_process"
import { draftPathFor, openInEditor, resolveEditorCommand, type EditorDeps } from "../src/tui/editor"

const makeDeps = (overrides: Partial<EditorDeps> & { fileContent?: string; fileExists?: boolean } = {}) => {
  const calls: {
    suspend: number
    resume: number
    spawn: Array<{ cmd: string; args: string[] }>
    mkdir: string[]
    write: Array<{ path: string; data: string }>
    read: string[]
  } = { suspend: 0, resume: 0, spawn: [], mkdir: [], write: [], read: [] }

  const renderer = {
    suspend: () => {
      calls.suspend += 1
    },
    resume: () => {
      calls.resume += 1
    },
  }

  let exists = overrides.fileExists ?? overrides.fileContent !== undefined
  let content = overrides.fileContent ?? ""

  const deps: Partial<EditorDeps> = {
    spawnSync: (cmd, args) => {
      calls.spawn.push({ cmd, args })
      return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null } as SpawnSyncReturns<Buffer>
    },
    existsSync: () => exists,
    mkdirSync: (p) => {
      calls.mkdir.push(p)
    },
    readFileSync: () => content,
    writeFileSync: (p, data) => {
      calls.write.push({ path: p, data })
      exists = true
      content = data
    },
    env: {},
    ...overrides,
  }

  return { renderer, deps, calls, setContent: (c: string) => (content = c) }
}

describe("openInEditor", () => {
  test("returns exit-code when editor exits non-zero", async () => {
    const { renderer, deps } = makeDeps({
      spawnSync: () => ({ status: 130, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null }) as SpawnSyncReturns<Buffer>,
    })
    const result = await openInEditor({ requestId: "r1", renderer, artifactRoot: "/tmp/runs", deps })
    expect(result).toEqual({ ok: false, reason: "exit-code", code: 130 })
  })

  test("returns empty when file is whitespace-only after save", async () => {
    const { renderer, deps } = makeDeps({ fileContent: "   \n  \t\n" })
    deps.spawnSync = () => ({ status: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null }) as SpawnSyncReturns<Buffer>
    const result = await openInEditor({ requestId: "r1", renderer, artifactRoot: "/tmp/runs", deps })
    expect(result).toEqual({ ok: false, reason: "empty" })
  })

  test("returns ok with content and path when file is non-empty after save", async () => {
    const { renderer, deps } = makeDeps({ fileContent: "hello world" })
    deps.spawnSync = () => ({ status: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null }) as SpawnSyncReturns<Buffer>
    const result = await openInEditor({ requestId: "r2", renderer, artifactRoot: "/tmp/runs", deps })
    expect(result).toEqual({ ok: true, content: "hello world", path: "/tmp/runs/.drafts/r2.md" })
  })

  test("editor command resolution honours VISUAL > EDITOR > vi", () => {
    expect(resolveEditorCommand({ VISUAL: "code -w", EDITOR: "nano" })).toBe("code -w")
    expect(resolveEditorCommand({ EDITOR: "nano" })).toBe("nano")
    expect(resolveEditorCommand({})).toBe("vi")
  })

  test("creates draft path under artifactRoot/.drafts and ensures parent dir", async () => {
    const { renderer, deps, calls } = makeDeps()
    await openInEditor({ requestId: "abc-123", renderer, artifactRoot: "/data/runs", deps })
    expect(draftPathFor("/data/runs", "abc-123")).toBe("/data/runs/.drafts/abc-123.md")
    expect(calls.mkdir).toContain("/data/runs/.drafts")
    expect(calls.spawn[0]?.args[0]).toBe("/data/runs/.drafts/abc-123.md")
  })

  test("suspends before spawn and resumes after, even when spawn throws", async () => {
    const order: string[] = []
    const { deps } = makeDeps()
    deps.spawnSync = () => {
      order.push("spawn")
      throw new Error("boom")
    }
    const renderer = {
      suspend: () => {
        order.push("suspend")
      },
      resume: () => {
        order.push("resume")
      },
    }
    const result = await openInEditor({ requestId: "r1", renderer, artifactRoot: "/tmp/runs", deps })
    expect(order).toEqual(["suspend", "spawn", "resume"])
    expect(result).toEqual({ ok: false, reason: "exit-code" })
  })
})
