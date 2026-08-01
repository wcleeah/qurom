import { createHash } from "node:crypto"
import { relative, resolve } from "node:path"

export type DefaultsPrResult =
  | { status: "skipped"; reason: string }
  | { status: "unchanged"; reason: string }
  | { status: "created"; prUrl: string; branch: string; number: number }
  | { status: "error"; message: string }

type GitHubContentFile = {
  path: string
  content: string // utf-8 text or base64 for binary
  encoding: "utf-8" | "base64"
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

async function gh<T>(
  path: string,
  init?: RequestInit & { token: string },
): Promise<{ ok: boolean; status: number; json: T; text: string }> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${init?.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "qurom-defaults-pr",
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

async function readWorkspaceFiles(
  workspaceDir: string,
  relativePaths: string[],
): Promise<GitHubContentFile[]> {
  const files: GitHubContentFile[] = []
  for (const rel of relativePaths) {
    const abs = resolve(workspaceDir, rel)
    const root = resolve(workspaceDir)
    if (abs !== root && !abs.startsWith(root + "/")) {
      throw new Error(`Path traversal blocked: ${rel}`)
    }
    const file = Bun.file(abs)
    if (!(await file.exists())) continue
    const isBinary = rel.endsWith(".sqlite")
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

function branchNameFor(files: GitHubContentFile[]): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const digest = createHash("sha1")
    .update(files.map((f) => f.path).sort().join("|"))
    .digest("hex")
    .slice(0, 8)
  return `qurom/defaults-${stamp}-${digest}`
}

/**
 * After defaults resources are written on disk, open a GitHub PR with those paths.
 * No-ops when QUORUM_DEFAULTS_GIT_PR is not enabled or credentials are missing.
 */
export async function openDefaultsPullRequest(input: {
  workspaceDir: string
  changedRelativePaths: string[]
  summary: string
}): Promise<DefaultsPrResult> {
  if (!enabled()) return { status: "skipped", reason: "QUORUM_DEFAULTS_GIT_PR is not enabled" }
  const auth = token()
  if (!auth) return { status: "skipped", reason: "GITHUB_TOKEN is not set" }
  const slug = repoSlug()
  if (!slug) return { status: "skipped", reason: "QUORUM_GITHUB_REPO is not set" }

  const [owner, repo] = slug.split("/")
  if (!owner || !repo) return { status: "error", message: `Invalid QUORUM_GITHUB_REPO: ${slug}` }

  try {
    const files = await readWorkspaceFiles(input.workspaceDir, input.changedRelativePaths)
    if (files.length === 0) return { status: "unchanged", reason: "No files to commit" }

    const base = baseBranch()
    const ref = await gh<{ object: { sha: string } }>(`/repos/${owner}/${repo}/git/ref/heads/${base}`, {
      token: auth,
    })
    if (!ref.ok) {
      return { status: "error", message: `Failed to read base branch ${base}: ${ref.status} ${ref.text}` }
    }
    const baseSha = ref.json.object.sha

    const commitInfo = await gh<{ tree: { sha: string } }>(`/repos/${owner}/${repo}/git/commits/${baseSha}`, {
      token: auth,
    })
    if (!commitInfo.ok) {
      return { status: "error", message: `Failed to read base commit: ${commitInfo.status} ${commitInfo.text}` }
    }
    const baseTreeSha = commitInfo.json.tree.sha

    const blobShas: Array<{ path: string; sha: string; mode: "100644"; type: "blob" }> = []
    for (const file of files) {
      const blob = await gh<{ sha: string }>(`/repos/${owner}/${repo}/git/blobs`, {
        token: auth,
        method: "POST",
        body: JSON.stringify({
          content: file.content,
          encoding: file.encoding,
        }),
      })
      if (!blob.ok) {
        return { status: "error", message: `Failed to create blob for ${file.path}: ${blob.status} ${blob.text}` }
      }
      blobShas.push({ path: file.path, sha: blob.json.sha, mode: "100644", type: "blob" })
    }

    const tree = await gh<{ sha: string }>(`/repos/${owner}/${repo}/git/trees`, {
      token: auth,
      method: "POST",
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: blobShas,
      }),
    })
    if (!tree.ok) {
      return { status: "error", message: `Failed to create tree: ${tree.status} ${tree.text}` }
    }

    const message = `chore(defaults): ${input.summary}`
    const commit = await gh<{ sha: string }>(`/repos/${owner}/${repo}/git/commits`, {
      token: auth,
      method: "POST",
      body: JSON.stringify({
        message,
        tree: tree.json.sha,
        parents: [baseSha],
      }),
    })
    if (!commit.ok) {
      return { status: "error", message: `Failed to create commit: ${commit.status} ${commit.text}` }
    }

    const branch = branchNameFor(files)
    const createdRef = await gh(`/repos/${owner}/${repo}/git/refs`, {
      token: auth,
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: commit.json.sha,
      }),
    })
    if (!createdRef.ok) {
      return { status: "error", message: `Failed to create branch ${branch}: ${createdRef.status} ${createdRef.text}` }
    }

    const pr = await gh<{ html_url: string; number: number }>(`/repos/${owner}/${repo}/pulls`, {
      token: auth,
      method: "POST",
      body: JSON.stringify({
        title: message,
        head: branch,
        base,
        body: [
          "Automated PR from Qurom defaults editor.",
          "",
          `Changed paths:`,
          ...files.map((f) => `- \`${f.path}\``),
        ].join("\n"),
      }),
    })
    if (!pr.ok) {
      return { status: "error", message: `Failed to open PR: ${pr.status} ${pr.text}` }
    }

    return {
      status: "created",
      prUrl: pr.json.html_url,
      branch,
      number: pr.json.number,
    }
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) }
  }
}
