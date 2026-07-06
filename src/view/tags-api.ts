import { loadRuntimeConfig } from "../config"
import { createAgentRuntime } from "../agent-runtime/runtime"
import { getProviderLifecycle } from "../providers/lifecycle"
import { TAGGER_ROLE } from "../role-registry"
import { tagArticle } from "../tagger"
import {
  addArticleTag,
  addNoteTag,
  listAllTags,
  listArticleTags,
  listNoteTags,
  propagateArticleTagsToNotes,
  removeArticleTag,
  removeNoteTag,
} from "../tags-store"
import { getLibraryNote } from "./library-notes-store"
import { resolveRunName, safeFilePath, safeRunPath } from "./paths"

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

async function resolveRun(runRef: string): Promise<string> {
  const resolved = await resolveRunName(runRef)
  if (!resolved) throw new Error("Run not found")
  return resolved
}

function wantsJson(req: Request): boolean {
  return (req.headers.get("accept") ?? "").includes("application/json")
}

function redirectRun(runName: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: `/runs/${encodeURIComponent(runName)}` },
  })
}

export async function handleTagsApi(req: Request, path: string): Promise<Response | undefined> {
  if (path === "/api/tags" && req.method === "GET") {
    const tags = await listAllTags()
    return json({ tags })
  }

  const articleTagsMatch = path.match(/^\/api\/runs\/(.+?)\/tags(?:\/([^/]+))?$/)
  if (articleTagsMatch) {
    const runName = await resolveRun(decodeURIComponent(articleTagsMatch[1]))
    const slug = articleTagsMatch[2] ? decodeURIComponent(articleTagsMatch[2]) : undefined

    if (req.method === "GET" && !slug) {
      return json({ tags: await listArticleTags(runName) })
    }

    if (req.method === "POST" && !slug) {
      const raw = await req.text()
      let tag = ""
      if (raw.trim().startsWith("{")) {
        const body = JSON.parse(raw) as { tag?: unknown }
        tag = typeof body.tag === "string" ? body.tag : ""
      } else {
        tag = new URLSearchParams(raw).get("tag") ?? ""
      }
      if (!tag.trim()) return json({ error: "tag is required" }, 400)
      const tags = await addArticleTag(runName, tag)
      return json({ ok: true, tags })
    }

    if (req.method === "DELETE" && slug) {
      const removed = await removeArticleTag(runName, slug)
      if (!removed) return json({ error: "Tag not found or not removable" }, 404)
      return json({ ok: true, tags: await listArticleTags(runName) })
    }
  }

  const retagMatch = path.match(/^\/api\/runs\/(.+?)\/retag$/)
  if (retagMatch && req.method === "POST") {
    const runName = await resolveRun(decodeURIComponent(retagMatch[1]))
    const runDir = safeRunPath(runName)
    const finalPath = safeFilePath(runName, "final.md")
    const finalFile = Bun.file(finalPath)
    if (!(await finalFile.exists())) {
      return json({ error: "final.md not found" }, 404)
    }

    const config = await loadRuntimeConfig()
    const lifecycle = getProviderLifecycle()
    const release = await lifecycle.acquireForRoles(config, [TAGGER_ROLE])
    try {
      let requestTopic: string | undefined
      try {
        const requestJson = await Bun.file(safeFilePath(runName, "request.json")).json() as {
          topic?: string
          inputSummary?: { title?: string }
        }
        requestTopic = requestJson.inputSummary?.title ?? requestJson.topic
      } catch {
        requestTopic = undefined
      }

      const runtime = createAgentRuntime(config)
      const result = await tagArticle({
        config,
        runName,
        outputPath: runDir,
        markdown: await finalFile.text(),
        topic: requestTopic,
        runtime,
      })
      if (!wantsJson(req)) return redirectRun(runName)
      return json({ ok: true, tags: result.tags })
    } finally {
      await release()
    }
  }

  const propagateMatch = path.match(/^\/api\/runs\/(.+?)\/tags\/propagate$/)
  if (propagateMatch && req.method === "POST") {
    const runName = await resolveRun(decodeURIComponent(propagateMatch[1]))
    const result = await propagateArticleTagsToNotes(runName)
    if (!wantsJson(req)) return redirectRun(runName)
    return json({ ok: true, ...result })
  }

  const noteTagsMatch = path.match(/^\/api\/library\/notes\/([^/]+)\/tags(?:\/([^/]+))?$/)
  if (noteTagsMatch) {
    const noteId = decodeURIComponent(noteTagsMatch[1])
    const slug = noteTagsMatch[2] ? decodeURIComponent(noteTagsMatch[2]) : undefined
    const note = await getLibraryNote(noteId)
    if (!note) return json({ error: "Note not found" }, 404)

    if (req.method === "GET" && !slug) {
      return json({ tags: await listNoteTags(noteId) })
    }

    if (req.method === "POST" && !slug) {
      const config = await loadRuntimeConfig()
      const maxNoteTags = config.quorumConfig.tagging?.maxNoteTags ?? 8
      const raw = await req.text()
      let tag = ""
      if (raw.trim().startsWith("{")) {
        const body = JSON.parse(raw) as { tag?: unknown }
        tag = typeof body.tag === "string" ? body.tag : ""
      } else {
        tag = new URLSearchParams(raw).get("tag") ?? ""
      }
      if (!tag.trim()) return json({ error: "tag is required" }, 400)
      const tags = await addNoteTag(noteId, tag, maxNoteTags)
      return json({ ok: true, tags })
    }

    if (req.method === "DELETE" && slug) {
      const removed = await removeNoteTag(noteId, slug)
      if (!removed) return json({ error: "Tag not found" }, 404)
      return json({ ok: true, tags: await listNoteTags(noteId) })
    }
  }

  return undefined
}
