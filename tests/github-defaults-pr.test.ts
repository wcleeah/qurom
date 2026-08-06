import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash as nodeCreateHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getPendingDefaultsPr, openDefaultsPullRequest } from "../src/github-defaults-pr"

function createHash(value: string) {
  return nodeCreateHash("sha1").update(value).digest("hex").slice(0, 12)
}

type MockCall = {
  method: string
  path: string
  body?: unknown
}

let dir: string
let originalFetch: typeof fetch
let calls: MockCall[]
let envBackup: Record<string, string | undefined>

function setPrEnv() {
  process.env.QUORUM_DEFAULTS_GIT_PR = "1"
  process.env.GITHUB_TOKEN = "test-token"
  process.env.QUORUM_GITHUB_REPO = "acme/qurom"
  process.env.QUORUM_GITHUB_PR_BASE = "main"
  process.env.QUORUM_DATA_DIR = dir
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-defaults-pr-"))
  envBackup = {
    QUORUM_DEFAULTS_GIT_PR: process.env.QUORUM_DEFAULTS_GIT_PR,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GH_TOKEN: process.env.GH_TOKEN,
    QUORUM_GITHUB_REPO: process.env.QUORUM_GITHUB_REPO,
    QUORUM_GITHUB_PR_BASE: process.env.QUORUM_GITHUB_PR_BASE,
    QUORUM_DATA_DIR: process.env.QUORUM_DATA_DIR,
  }
  setPrEnv()
  calls = []
  originalFetch = globalThis.fetch
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(dir, { recursive: true, force: true })
})

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function installFetch(handler: (method: string, path: string, body?: unknown) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const path = url.replace("https://api.github.com", "")
    const method = (init?.method ?? "GET").toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path, body })
    return handler(method, path, body)
  }) as typeof fetch
}

describe("openDefaultsPullRequest grouping", () => {
  test("creates a stable-branch PR and reuses it on later saves", async () => {
    await Bun.write(join(dir, "defaults/prompts/a.md"), "alpha\n")
    await Bun.write(join(dir, "defaults/prompts/b.md"), "bravo\n")

    let prOpen = false
    let branchSha: string | undefined
    const prFiles = new Set<string>()

    installFetch((method, path, body) => {
      if (method === "GET" && path === "/repos/acme/qurom/git/ref/heads/main") {
        return jsonResponse(200, { object: { sha: "base-sha" } })
      }
      if (method === "GET" && path === "/repos/acme/qurom/git/commits/base-sha") {
        return jsonResponse(200, { tree: { sha: "base-tree" } })
      }
      if (method === "POST" && path === "/repos/acme/qurom/git/blobs") {
        return jsonResponse(201, { sha: `blob-${String(body?.content).slice(0, 8)}` })
      }
      if (method === "POST" && path === "/repos/acme/qurom/git/trees") {
        return jsonResponse(201, { sha: `tree-${(body?.tree as unknown[]).length}` })
      }
      if (method === "POST" && path === "/repos/acme/qurom/git/commits") {
        return jsonResponse(201, { sha: `commit-${createHash(String(body?.message))}` })
      }
      if (method === "GET" && path.startsWith("/repos/acme/qurom/git/ref/heads/qurom/defaults-pending")) {
        if (!branchSha) return jsonResponse(404, { message: "Not Found" })
        return jsonResponse(200, { object: { sha: branchSha } })
      }
      if (method === "POST" && path === "/repos/acme/qurom/git/refs") {
        branchSha = body?.sha
        return jsonResponse(201, {})
      }
      if (method === "PATCH" && path === "/repos/acme/qurom/git/refs/heads/qurom/defaults-pending") {
        branchSha = body?.sha
        expect(body?.force).toBe(true)
        return jsonResponse(200, {})
      }
      if (method === "GET" && path.startsWith("/repos/acme/qurom/pulls?state=open")) {
        if (!prOpen) return jsonResponse(200, [])
        return jsonResponse(200, [{
          number: 42,
          html_url: "https://github.com/acme/qurom/pull/42",
          title: "chore(defaults): update shipped defaults",
          head: { ref: "qurom/defaults-pending" },
          base: { ref: "main" },
        }])
      }
      if (method === "POST" && path === "/repos/acme/qurom/pulls") {
        prOpen = true
        for (const line of String(body?.body ?? "").split("\n")) {
          const match = line.match(/`([^`]+)`/)
          if (match) prFiles.add(match[1])
        }
        return jsonResponse(201, {
          html_url: "https://github.com/acme/qurom/pull/42",
          number: 42,
        })
      }
      if (method === "GET" && path === "/repos/acme/qurom/pulls/42") {
        return jsonResponse(200, {
          number: 42,
          html_url: "https://github.com/acme/qurom/pull/42",
          title: "chore(defaults): update shipped defaults",
          state: "open",
          merged_at: null,
          head: { ref: "qurom/defaults-pending" },
        })
      }
      if (method === "GET" && path.startsWith("/repos/acme/qurom/pulls/42/files")) {
        return jsonResponse(200, [...prFiles].map((filename) => ({ filename })))
      }
      if (method === "PATCH" && path === "/repos/acme/qurom/pulls/42") {
        prFiles.clear()
        for (const line of String(body?.body ?? "").split("\n")) {
          const match = line.match(/`([^`]+)`/)
          if (match) prFiles.add(match[1])
        }
        return jsonResponse(200, {
          html_url: "https://github.com/acme/qurom/pull/42",
          number: 42,
        })
      }
      return jsonResponse(500, { message: `Unhandled ${method} ${path}` })
    })

    const created = await openDefaultsPullRequest({
      workspaceDir: dir,
      changedRelativePaths: ["defaults/prompts/a.md"],
      summary: "update prompt a",
    })
    expect(created).toMatchObject({
      status: "created",
      number: 42,
      branch: "qurom/defaults-pending",
    })

    const updated = await openDefaultsPullRequest({
      workspaceDir: dir,
      changedRelativePaths: ["defaults/prompts/b.md"],
      summary: "update prompt b",
    })
    expect(updated).toMatchObject({
      status: "updated",
      number: 42,
    })
    expect(prFiles.has("defaults/prompts/a.md")).toBe(true)
    expect(prFiles.has("defaults/prompts/b.md")).toBe(true)

    const pending = await getPendingDefaultsPr()
    expect(pending).toMatchObject({
      number: 42,
      state: "open",
    })
    expect(pending?.paths).toContain("defaults/prompts/a.md")
    expect(pending?.paths).toContain("defaults/prompts/b.md")

    const forcePatches = calls.filter((call) =>
      call.method === "PATCH" && call.path.includes("/git/refs/heads/qurom/defaults-pending"),
    )
    expect(forcePatches.length).toBeGreaterThanOrEqual(1)
  })

  test("clears stored PR after merge and opens a new one", async () => {
    await Bun.write(join(dir, "defaults/prompts/a.md"), "alpha\n")

    let phase: "merged" | "create" = "merged"
    installFetch((method, path, body) => {
      if (method === "GET" && path === "/repos/acme/qurom/pulls/7") {
        return jsonResponse(200, {
          number: 7,
          html_url: "https://github.com/acme/qurom/pull/7",
          title: "chore(defaults): update shipped defaults",
          state: "closed",
          merged_at: "2026-01-01T00:00:00Z",
          head: { ref: "qurom/defaults-pending" },
        })
      }
      if (method === "GET" && /^\/repos\/acme\/qurom\/pulls\/\d+$/.test(path) && path !== "/repos/acme/qurom/pulls/7") {
        return jsonResponse(404, { message: "Not Found" })
      }
      if (method === "GET" && path.startsWith("/repos/acme/qurom/pulls?state=open")) {
        return jsonResponse(200, [])
      }
      if (method === "GET" && path === "/repos/acme/qurom/git/ref/heads/main") {
        return jsonResponse(200, { object: { sha: "base-sha" } })
      }
      if (method === "GET" && path === "/repos/acme/qurom/git/commits/base-sha") {
        return jsonResponse(200, { tree: { sha: "base-tree" } })
      }
      if (method === "POST" && path === "/repos/acme/qurom/git/blobs") {
        return jsonResponse(201, { sha: "blob-1" })
      }
      if (method === "POST" && path === "/repos/acme/qurom/git/trees") {
        return jsonResponse(201, { sha: "tree-1" })
      }
      if (method === "POST" && path === "/repos/acme/qurom/git/commits") {
        return jsonResponse(201, { sha: "commit-1" })
      }
      if (method === "GET" && path.startsWith("/repos/acme/qurom/git/ref/heads/")) {
        return jsonResponse(404, { message: "Not Found" })
      }
      if (method === "POST" && path === "/repos/acme/qurom/git/refs") {
        return jsonResponse(201, {})
      }
      if (method === "POST" && path === "/repos/acme/qurom/pulls") {
        phase = "create"
        return jsonResponse(201, {
          html_url: "https://github.com/acme/qurom/pull/8",
          number: 8,
        })
      }
      return jsonResponse(500, { message: `Unhandled ${method} ${path}`, body })
    })

    await Bun.write(join(dir, "defaults-pr.json"), JSON.stringify({
      number: 7,
      url: "https://github.com/acme/qurom/pull/7",
      branch: "qurom/defaults-pending",
      paths: ["defaults/prompts/a.md"],
    }))

    const result = await openDefaultsPullRequest({
      workspaceDir: dir,
      changedRelativePaths: ["defaults/prompts/a.md"],
      summary: "update prompt a",
    })
    expect(result).toMatchObject({ status: "created", number: 8 })
    expect(phase).toBe("create")
  })
})
