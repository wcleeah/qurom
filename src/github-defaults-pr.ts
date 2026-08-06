import { mkdir } from "node:fs/promises"
import { dirname, relative, resolve } from "node:path"

import { resolveQuorumDataDir } from "./data-paths"

export type DefaultsPrResult =
  | { status: "skipped"; reason: string }
  | { status: "unchanged"; reason: string }
  | { status: "created"; prUrl: string; branch: string; number: number }
  | { status: "updated"; prUrl: string; branch: string; number: number }
  | { status: "error"; message: string }

export type DefaultsPrInfo = {
  number: number
  url: string
  branch: string
  state: "open" | "closed" | "merged"
  paths: string[]
  title: string
}

type StoredDefaultsPr = {
  number: number
  url: string
  branch: string
  paths: string[]
}

type GitHubContentFile = {
  path: string
  content: string // utf-8 text or base64 for binary
  encoding: "utf-8" | "base64"
}

const STABLE_BRANCH = "qurom/defaults-pending"
const TITLE_PREFIX = "chore(defaults):"
const DEFAULTS_PR_TITLE = "chore(defaults): update shipped defaults"

let writeQueue: Promise<unknown> = Promise.resolve()

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn)
  writeQueue = run.then(() => undefined, () => undefined)
  return run
}

function enabled(): boolean {
  const flag = process.env.QUORUM_DEFAULTS_GIT_PR?.trim()
  if (flag === "0" || flag?.toLowerCase() === "false") return false
  if (flag === "1" || flag?.toLowerCase() === "true") return true
  // Default off unless explicitly enabled.
  return false
}

function repoSlug(): string | undefined {
  const explicit = process.env.QUORUM_GITHUB_REPO?.trim()
  if (explicit) return explicit
  return undefined
}

function token(): string | undefined {
  return process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || undefined
}

function baseBranch(): string {
  return process.env.QUORUM_GITHUB_PR_BASE?.trim() || "main"
}

function statePath(): string {
  return resolve(resolveQuorumDataDir(process.env.QUORUM_DATA_DIR), "defaults-pr.json")
}

async function readStoredState(): Promise<StoredDefaultsPr | undefined> {
  const file = Bun.file(statePath())
  if (!(await file.exists())) return undefined
  try {
    const parsed = JSON.parse(await file.text()) as Partial<StoredDefaultsPr>
    if (
      typeof parsed.number !== "number" ||
      typeof parsed.url !== "string" ||
      typeof parsed.branch !== "string" ||
      !Array.isArray(parsed.paths)
    ) {
      return undefined
    }
    return {
      number: parsed.number,
      url: parsed.url,
      branch: parsed.branch,
      paths: parsed.paths.filter((path): path is string => typeof path === "string"),
    }
  } catch {
    return undefined
  }
}

async function writeStoredState(state: StoredDefaultsPr | undefined): Promise<void> {
  const path = statePath()
  if (!state) {
    const file = Bun.file(path)
    if (await file.exists()) {
      const { unlink } = await import("node:fs/promises")
      await unlink(path).catch(() => undefined)
    }
    return
  }
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, `${JSON.stringify(state, null, 2)}\n`)
}

async function gh<T>(
  path: string,
  init?: RequestInit & { token: string },
): Promise<{ ok: boolean; status: number; json: T; text: string }> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${init?.token}`,
      "User-Agent": "qurom-defaults-pr",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  })
  const text = await response.text()
  let json = undefined as T
  try {
    json = text ? (JSON.parse(text) as T) : (undefined as T)
  } catch {
    // non-JSON
  }
  return { ok: response.ok, status: response.status, json, text }
}

function credentials():
  | { ok: true; auth: string; owner: string; repo: string }
  | { ok: false; reason: string } {
  const auth = token()
  if (!auth) return { ok: false, reason: "GITHUB_TOKEN is not set" }
  const slug = repoSlug()
  if (!slug) return { ok: false, reason: "QUORUM_GITHUB_REPO is not set" }
  const [owner, repo] = slug.split("/")
  if (!owner || !repo) return { ok: false, reason: `Invalid QUORUM_GITHUB_REPO: ${slug}` }
  return { ok: true, auth, owner, repo }
}

function isDefaultsPrHead(headRef: string | undefined): boolean {
  return Boolean(headRef?.startsWith("qurom/defaults-"))
}

function isDefaultsPrTitle(title: string | undefined): boolean {
  return Boolean(title?.startsWith(TITLE_PREFIX))
}

async function readWorkspaceFiles(
  workspaceDir: string,
  relativePaths: string[],
): Promise<GitHubContentFile[]> {
  const files: GitHubContentFile[] = []
  const seen = new Set<string>()
  for (const rel of relativePaths) {
    const normalized = rel.split("\\").join("/")
    if (seen.has(normalized)) continue
    seen.add(normalized)
    const abs = resolve(workspaceDir, normalized)
    const root = resolve(workspaceDir)
    if (abs !== root && !abs.startsWith(root + "/")) {
      throw new Error(`Path traversal blocked: ${rel}`)
    }
    const file = Bun.file(abs)
    if (!(await file.exists())) continue
    const isBinary = normalized.endsWith(".sqlite")
    if (isBinary) {
      const buf = Buffer.from(await file.arrayBuffer())
      files.push({
        path: relative(root, abs).split("\\").join("/"),
        content: buf.toString("base64"),
        encoding: "base64",
      })
    } else {
      files.push({
        path: relative(root, abs).split("\\").join("/"),
        content: await file.text(),
        encoding: "utf-8",
      })
    }
  }
  return files
}

async function listPrFiles(
  owner: string,
  repo: string,
  number: number,
  auth: string,
): Promise<string[]> {
  const paths: string[] = []
  let page = 1
  while (page <= 20) {
    const response = await gh<Array<{ filename: string }>>(
      `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
      { token: auth },
    )
    if (!response.ok) {
      throw new Error(`Failed to list PR files: ${response.status} ${response.text}`)
    }
    const batch = response.json ?? []
    for (const file of batch) {
      if (file.filename) paths.push(file.filename)
    }
    if (batch.length < 100) break
    page += 1
  }
  return paths
}

async function fetchPull(
  owner: string,
  repo: string,
  number: number,
  auth: string,
): Promise<{
  number: number
  html_url: string
  title: string
  state: string
  merged_at: string | null
  head: { ref: string }
} | undefined> {
  const response = await gh<{
    number: number
    html_url: string
    title: string
    state: string
    merged_at: string | null
    head: { ref: string }
  }>(`/repos/${owner}/${repo}/pulls/${number}`, { token: auth })
  if (response.status === 404) return undefined
  if (!response.ok) {
    throw new Error(`Failed to fetch PR #${number}: ${response.status} ${response.text}`)
  }
  return response.json
}

function prState(pr: { state: string; merged_at: string | null }): "open" | "closed" | "merged" {
  if (pr.merged_at) return "merged"
  if (pr.state === "open") return "open"
  return "closed"
}

async function discoverOpenDefaultsPr(
  owner: string,
  repo: string,
  auth: string,
): Promise<{ number: number; html_url: string; title: string; head: { ref: string } } | undefined> {
  const base = baseBranch()
  const response = await gh<Array<{
    number: number
    html_url: string
    title: string
    head: { ref: string; label?: string }
    base: { ref: string }
  }>>(`/repos/${owner}/${repo}/pulls?state=open&base=${encodeURIComponent(base)}&per_page=50`, {
    token: auth,
  })
  if (!response.ok) {
    throw new Error(`Failed to list open PRs: ${response.status} ${response.text}`)
  }
  const matches = (response.json ?? []).filter((pr) =>
    isDefaultsPrHead(pr.head.ref) || isDefaultsPrTitle(pr.title),
  )
  if (matches.length === 0) return undefined
  // Prefer the stable branch, then the lowest number (oldest pending).
  matches.sort((a, b) => {
    if (a.head.ref === STABLE_BRANCH && b.head.ref !== STABLE_BRANCH) return -1
    if (b.head.ref === STABLE_BRANCH && a.head.ref !== STABLE_BRANCH) return 1
    return a.number - b.number
  })
  return matches[0]
}

async function resolveOpenDefaultsPr(
  owner: string,
  repo: string,
  auth: string,
): Promise<DefaultsPrInfo | undefined> {
  const stored = await readStoredState()
  if (stored) {
    const pr = await fetchPull(owner, repo, stored.number, auth)
    if (pr && prState(pr) === "open") {
      const paths = uniquePaths([...(await listPrFiles(owner, repo, pr.number, auth)), ...stored.paths])
      const info: DefaultsPrInfo = {
        number: pr.number,
        url: pr.html_url,
        branch: pr.head.ref,
        state: "open",
        paths,
        title: pr.title,
      }
      await writeStoredState({
        number: info.number,
        url: info.url,
        branch: info.branch,
        paths: info.paths,
      })
      return info
    }
    await writeStoredState(undefined)
  }

  const discovered = await discoverOpenDefaultsPr(owner, repo, auth)
  if (!discovered) return undefined
  const paths = await listPrFiles(owner, repo, discovered.number, auth)
  const info: DefaultsPrInfo = {
    number: discovered.number,
    url: discovered.html_url,
    branch: discovered.head.ref,
    state: "open",
    paths,
    title: discovered.title,
  }
  await writeStoredState({
    number: info.number,
    url: info.url,
    branch: info.branch,
    paths: info.paths,
  })
  return info
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => path.split("\\").join("/")))].sort()
}

function prBody(paths: string[], summary: string): string {
  return [
    "Automated PR from Qurom defaults editor.",
    "",
    `Latest change: ${summary}`,
    "",
    "Changed paths:",
    ...paths.map((path) => `- \`${path}\``),
  ].join("\n")
}

async function createCommitOnBase(input: {
  owner: string
  repo: string
  auth: string
  files: GitHubContentFile[]
  message: string
}): Promise<{ commitSha: string; baseSha: string }> {
  const base = baseBranch()
  const ref = await gh<{ object: { sha: string } }>(`/repos/${input.owner}/${input.repo}/git/ref/heads/${base}`, {
    token: input.auth,
  })
  if (!ref.ok) {
    throw new Error(`Failed to read base branch ${base}: ${ref.status} ${ref.text}`)
  }
  const baseSha = ref.json.object.sha

  const commitInfo = await gh<{ tree: { sha: string } }>(
    `/repos/${input.owner}/${input.repo}/git/commits/${baseSha}`,
    { token: input.auth },
  )
  if (!commitInfo.ok) {
    throw new Error(`Failed to read base commit: ${commitInfo.status} ${commitInfo.text}`)
  }
  const baseTreeSha = commitInfo.json.tree.sha

  const blobShas: Array<{ path: string; sha: string; mode: "100644"; type: "blob" }> = []
  for (const file of input.files) {
    const blob = await gh<{ sha: string }>(`/repos/${input.owner}/${input.repo}/git/blobs`, {
      token: input.auth,
      method: "POST",
      body: JSON.stringify({
        content: file.content,
        encoding: file.encoding,
      }),
    })
    if (!blob.ok) {
      throw new Error(`Failed to create blob for ${file.path}: ${blob.status} ${blob.text}`)
    }
    blobShas.push({ path: file.path, sha: blob.json.sha, mode: "100644", type: "blob" })
  }

  const tree = await gh<{ sha: string }>(`/repos/${input.owner}/${input.repo}/git/trees`, {
    token: input.auth,
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: blobShas,
    }),
  })
  if (!tree.ok) {
    throw new Error(`Failed to create tree: ${tree.status} ${tree.text}`)
  }

  const commit = await gh<{ sha: string }>(`/repos/${input.owner}/${input.repo}/git/commits`, {
    token: input.auth,
    method: "POST",
    body: JSON.stringify({
      message: input.message,
      tree: tree.json.sha,
      parents: [baseSha],
    }),
  })
  if (!commit.ok) {
    throw new Error(`Failed to create commit: ${commit.status} ${commit.text}`)
  }
  return { commitSha: commit.json.sha, baseSha }
}

async function ensureBranchAtSha(input: {
  owner: string
  repo: string
  auth: string
  branch: string
  sha: string
}): Promise<void> {
  const existing = await gh<{ object: { sha: string } }>(
    `/repos/${input.owner}/${input.repo}/git/ref/heads/${input.branch}`,
    { token: input.auth },
  )
  if (existing.ok) {
    if (existing.json.object.sha === input.sha) return
    const updated = await gh(`/repos/${input.owner}/${input.repo}/git/refs/heads/${input.branch}`, {
      token: input.auth,
      method: "PATCH",
      body: JSON.stringify({ sha: input.sha, force: true }),
    })
    if (!updated.ok) {
      throw new Error(`Failed to update branch ${input.branch}: ${updated.status} ${updated.text}`)
    }
    return
  }

  const created = await gh(`/repos/${input.owner}/${input.repo}/git/refs`, {
    token: input.auth,
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${input.branch}`,
      sha: input.sha,
    }),
  })
  if (!created.ok) {
    throw new Error(`Failed to create branch ${input.branch}: ${created.status} ${created.text}`)
  }
}

/**
 * Resolve the open defaults PR (stored number → status fetch → discover), if any.
 */
export async function getPendingDefaultsPr(): Promise<DefaultsPrInfo | undefined> {
  const creds = credentials()
  if (!creds.ok) return undefined
  try {
    return await resolveOpenDefaultsPr(creds.owner, creds.repo, creds.auth)
  } catch (error) {
    console.error("Failed to resolve pending defaults PR:", error)
    return undefined
  }
}

/**
 * After defaults resources are written on disk, open or update a single GitHub PR
 * that groups all unmerged defaults changes. Rebuilds from the latest base tip to
 * avoid stacking conflicts.
 */
export async function openDefaultsPullRequest(input: {
  workspaceDir: string
  changedRelativePaths: string[]
  summary: string
}): Promise<DefaultsPrResult> {
  if (!enabled()) return { status: "skipped", reason: "QUORUM_DEFAULTS_GIT_PR is not enabled" }
  const creds = credentials()
  if (!creds.ok) return { status: "skipped", reason: creds.reason }

  return withWriteLock(async () => {
    try {
      const pending = await resolveOpenDefaultsPr(creds.owner, creds.repo, creds.auth)
      const pathSet = uniquePaths([
        ...input.changedRelativePaths,
        ...(pending?.paths ?? []),
      ])
      const files = await readWorkspaceFiles(input.workspaceDir, pathSet)
      if (files.length === 0) return { status: "unchanged", reason: "No files to commit" }

      const filePaths = files.map((file) => file.path).sort()
      const message = DEFAULTS_PR_TITLE
      const { commitSha } = await createCommitOnBase({
        owner: creds.owner,
        repo: creds.repo,
        auth: creds.auth,
        files,
        message: `${message} — ${input.summary}`,
      })

      if (pending) {
        await ensureBranchAtSha({
          owner: creds.owner,
          repo: creds.repo,
          auth: creds.auth,
          branch: pending.branch,
          sha: commitSha,
        })
        const patched = await gh<{ html_url: string; number: number }>(
          `/repos/${creds.owner}/${creds.repo}/pulls/${pending.number}`,
          {
            token: creds.auth,
            method: "PATCH",
            body: JSON.stringify({
              title: message,
              body: prBody(filePaths, input.summary),
            }),
          },
        )
        if (!patched.ok) {
          return { status: "error", message: `Failed to update PR: ${patched.status} ${patched.text}` }
        }
        await writeStoredState({
          number: pending.number,
          url: pending.url,
          branch: pending.branch,
          paths: filePaths,
        })
        return {
          status: "updated",
          prUrl: pending.url,
          branch: pending.branch,
          number: pending.number,
        }
      }

      const branch = STABLE_BRANCH
      await ensureBranchAtSha({
        owner: creds.owner,
        repo: creds.repo,
        auth: creds.auth,
        branch,
        sha: commitSha,
      })

      const pr = await gh<{ html_url: string; number: number }>(`/repos/${creds.owner}/${creds.repo}/pulls`, {
        token: creds.auth,
        method: "POST",
        body: JSON.stringify({
          title: message,
          head: branch,
          base: baseBranch(),
          body: prBody(filePaths, input.summary),
        }),
      })
      if (!pr.ok) {
        // A PR may already exist for the stable branch (race / discover miss).
        if (pr.status === 422) {
          const discovered = await discoverOpenDefaultsPr(creds.owner, creds.repo, creds.auth)
          if (discovered) {
            await writeStoredState({
              number: discovered.number,
              url: discovered.html_url,
              branch: discovered.head.ref,
              paths: filePaths,
            })
            return {
              status: "updated",
              prUrl: discovered.html_url,
              branch: discovered.head.ref,
              number: discovered.number,
            }
          }
        }
        return { status: "error", message: `Failed to open PR: ${pr.status} ${pr.text}` }
      }

      await writeStoredState({
        number: pr.json.number,
        url: pr.json.html_url,
        branch,
        paths: filePaths,
      })
      return {
        status: "created",
        prUrl: pr.json.html_url,
        branch,
        number: pr.json.number,
      }
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) }
    }
  })
}
