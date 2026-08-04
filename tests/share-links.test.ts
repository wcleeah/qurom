import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { handleShareApi } from "../src/view/share-api.ts"
import { serveSharedByToken } from "../src/view/pages.ts"
import {
  ensureShareLink,
  getShareLinkByRun,
  getShareLinkByToken,
  isValidShareToken,
  mintShareToken,
  revokeShareLink,
} from "../src/view/share-store.ts"

let dir: string
let originalDataDir: string | undefined
let originalWorkspace: string | undefined
let originalOpencodeDir: string | undefined
let originalRunsDir: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-share-links-"))
  await mkdir(join(dir, "runs", "alpha-run"), { recursive: true })
  await writeFile(join(dir, "runs", "alpha-run", "final.html"), "<!DOCTYPE html><html><body>Shared</body></html>")

  originalDataDir = process.env.QUORUM_DATA_DIR
  originalWorkspace = process.env.QUORUM_WORKSPACE_DIRECTORY
  originalOpencodeDir = process.env.OPENCODE_DIRECTORY
  originalRunsDir = process.env.QUORUM_RUNS_DIR
  process.env.QUORUM_DATA_DIR = dir
  process.env.QUORUM_WORKSPACE_DIRECTORY = dir
  process.env.OPENCODE_DIRECTORY = dir
  process.env.QUORUM_RUNS_DIR = join(dir, "runs")
})

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.QUORUM_DATA_DIR
  else process.env.QUORUM_DATA_DIR = originalDataDir
  if (originalWorkspace === undefined) delete process.env.QUORUM_WORKSPACE_DIRECTORY
  else process.env.QUORUM_WORKSPACE_DIRECTORY = originalWorkspace
  if (originalOpencodeDir === undefined) delete process.env.OPENCODE_DIRECTORY
  else process.env.OPENCODE_DIRECTORY = originalOpencodeDir
  if (originalRunsDir === undefined) delete process.env.QUORUM_RUNS_DIR
  else process.env.QUORUM_RUNS_DIR = originalRunsDir
  await rm(dir, { recursive: true, force: true })
})

describe("share-store", () => {
  test("mints opaque tokens and stores one per run", async () => {
    const token = mintShareToken()
    expect(isValidShareToken(token)).toBe(true)

    const first = await ensureShareLink("alpha-run")
    const second = await ensureShareLink("alpha-run")
    expect(second.token).toBe(first.token)
    expect(await getShareLinkByToken(first.token)).toEqual(first)
    expect(await getShareLinkByRun("alpha-run")).toEqual(first)

    expect(await revokeShareLink("alpha-run")).toBe(true)
    expect(await getShareLinkByRun("alpha-run")).toBeNull()
    const third = await ensureShareLink("alpha-run")
    expect(third.token).not.toBe(first.token)
  })
})

describe("share-api", () => {
  test("rejects create without final.html", async () => {
    await mkdir(join(dir, "runs", "empty-run"), { recursive: true })
    const resp = await handleShareApi(
      new Request("http://localhost/api/runs/empty-run/share", { method: "POST" }),
      "/api/runs/empty-run/share",
    )
    expect(resp?.status).toBe(400)
  })

  test("get returns null before create and url after", async () => {
    const empty = await handleShareApi(
      new Request("http://localhost/api/runs/alpha-run/share", { method: "GET" }),
      "/api/runs/alpha-run/share",
    )
    expect(await empty!.json()).toEqual({ ok: true, token: null, url: null })

    const created = await handleShareApi(
      new Request("http://localhost/api/runs/alpha-run/share", { method: "POST" }),
      "/api/runs/alpha-run/share",
    )
    const body = await created!.json() as { token: string; url: string }
    const got = await handleShareApi(
      new Request("http://localhost/api/runs/alpha-run/share", { method: "GET" }),
      "/api/runs/alpha-run/share",
    )
    expect(await got!.json()).toEqual({ ok: true, token: body.token, url: body.url })
  })

  test("public resolve 404s when final.html is removed", async () => {
    const link = await ensureShareLink("alpha-run")
    await rm(join(dir, "runs", "alpha-run", "final.html"), { force: true })
    expect((await serveSharedByToken(link.token)).status).toBe(404)
  })
})
