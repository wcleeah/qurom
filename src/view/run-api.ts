import { inputRequestSchema } from "../schema"
import { readRunSourceDocument } from "../document-input"
import { parseRerunInterviewMode } from "../run-rerun"
import {
  RunManagerError,
  getRunManager,
  isRunManagedActive,
  toRunManagerError,
} from "../run-manager"
import {
  archiveRunDirectory,
  resolveArchiveRunName,
  resolveRunName,
  safeRunPath,
  unarchiveRunDirectory,
} from "./paths"

function wantsJson(req: Request, url: URL): boolean {
  return url.searchParams.get("json") === "1"
    || (req.headers.get("accept") ?? "").includes("application/json")
}

function redirectOrJson(
  req: Request,
  url: URL,
  location: string,
  body: Record<string, unknown>,
): Response {
  if (wantsJson(req, url)) {
    return Response.json(body)
  }
  return new Response(null, {
    status: 303,
    headers: { Location: location },
  })
}

function errorResponse(error: unknown, req?: Request, url?: URL): Response {
  const mapped = toRunManagerError(error)
  if (mapped instanceof RunManagerError) {
    if (req && url && !wantsJson(req, url)) {
      return new Response(null, {
        status: 303,
        headers: { Location: `/?error=${encodeURIComponent(mapped.message)}` },
      })
    }
    return Response.json({ error: mapped.message }, { status: mapped.status })
  }
  const message = error instanceof Error ? error.message : String(error)
  if (req && url && !wantsJson(req, url)) {
    return new Response(null, {
      status: 303,
      headers: { Location: `/?error=${encodeURIComponent(message)}` },
    })
  }
  return Response.json({ error: message }, { status: 500 })
}

export async function handleRunApi(req: Request, path: string, url: URL): Promise<Response | undefined> {
  if (path === "/api/status" && req.method === "GET") {
    return Response.json(getRunManager().status())
  }

  if (path === "/api/rerun-queue" && req.method === "GET") {
    const queue = await getRunManager().listRerunQueue()
    return Response.json({
      paused: queue.paused,
      items: queue.items.map((item) => ({
        id: item.id,
        interview: item.interview,
        sourceRunName: item.sourceRunName,
        topic: item.topic,
        createdAt: item.createdAt,
      })),
    })
  }

  if (path === "/api/rerun-queue/clear" && req.method === "POST") {
    try {
      const cleared = await getRunManager().clearRerunQueue()
      return redirectOrJson(req, url, "/", { ok: true, cleared })
    } catch (error) {
      return errorResponse(error, req, url)
    }
  }

  if (path === "/api/rerun-queue/pause" && req.method === "POST") {
    try {
      const queue = await getRunManager().setRerunQueuePaused(true)
      return redirectOrJson(req, url, "/", { ok: true, paused: queue.paused })
    } catch (error) {
      return errorResponse(error, req, url)
    }
  }

  if (path === "/api/rerun-queue/resume" && req.method === "POST") {
    try {
      const queue = await getRunManager().setRerunQueuePaused(false)
      return redirectOrJson(req, url, "/", { ok: true, paused: queue.paused })
    } catch (error) {
      return errorResponse(error, req, url)
    }
  }

  const queueRemoveMatch = path.match(/^\/api\/rerun-queue\/(.+?)\/remove$/)
  if (queueRemoveMatch && req.method === "POST") {
    try {
      const removed = await getRunManager().removeRerunQueueItem(decodeURIComponent(queueRemoveMatch[1]))
      return redirectOrJson(req, url, "/", { ok: true, removed })
    } catch (error) {
      return errorResponse(error, req, url)
    }
  }

  if (path === "/api/runs" && req.method === "POST") {
    try {
      const raw = await req.text()
      let body: unknown
      if (raw.trim().startsWith("{")) {
        body = JSON.parse(raw)
      } else {
        const params = new URLSearchParams(raw)
        body = {
          inputMode: params.get("inputMode") ?? "topic",
          topic: params.get("topic") ?? undefined,
          documentPath: params.get("documentPath") ?? undefined,
          documentText: params.get("documentText") ?? undefined,
        }
      }
      const request = inputRequestSchema.parse(body)
      const { runId, runPath } = await getRunManager().startResearch(request)
      return redirectOrJson(req, url, `/runs/${encodeURIComponent(runPath)}`, { ok: true, runId, runPath })
    } catch (error) {
      return errorResponse(error, req, url)
    }
  }

  const restartMatch = path.match(/^\/api\/runs\/(.+?)\/restart-from-source$/)
  if (restartMatch && req.method === "POST") {
    try {
      const runRef = decodeURIComponent(restartMatch[1])
      const runName = await resolveRunName(runRef)
      if (!runName) {
        throw new RunManagerError(`Run not found: ${runRef}`, 404)
      }
      const runDir = safeRunPath(runName)
      const documentText = await readRunSourceDocument(runDir)
      if (!documentText?.trim()) {
        throw new RunManagerError("This run has no saved source document (input.md).", 404)
      }
      const { runId, runPath } = await getRunManager().startResearch({
        inputMode: "document",
        documentText,
      })
      return redirectOrJson(req, url, `/runs/${encodeURIComponent(runPath)}`, { ok: true, runId, runPath })
    } catch (error) {
      return errorResponse(error, req, url)
    }
  }

  const rerunMatch = path.match(/^\/api\/runs\/(.+?)\/rerun$/)
  if (rerunMatch && req.method === "POST") {
    try {
      const runRef = decodeURIComponent(rerunMatch[1])
      const raw = await req.text()
      let interviewRaw: unknown = url.searchParams.get("interview")
      if (raw.trim()) {
        if (raw.trim().startsWith("{")) {
          const body = JSON.parse(raw) as { interview?: unknown }
          interviewRaw = body.interview ?? interviewRaw
        } else {
          interviewRaw = new URLSearchParams(raw).get("interview") ?? interviewRaw
        }
      }
      const interview = parseRerunInterviewMode(interviewRaw)
      const result = await getRunManager().rerunResearch(runRef, { interview })
      if (result.kind === "queued") {
        return redirectOrJson(req, url, "/", {
          ok: true,
          queued: true,
          queueId: result.queueId,
          sourceRunName: result.sourceRunName,
          topic: result.topic,
          interview: result.interview,
        })
      }
      return redirectOrJson(req, url, `/runs/${encodeURIComponent(result.runPath)}`, {
        ok: true,
        runId: result.runId,
        runPath: result.runPath,
        interview,
      })
    } catch (error) {
      return errorResponse(error, req, url)
    }
  }

  const resumeMatch = path.match(/^\/api\/runs\/(.+?)\/resume$/)
  if (resumeMatch && req.method === "POST") {
    try {
      const runId = decodeURIComponent(resumeMatch[1])
      const result = await getRunManager().resumeResearch(runId)
      return redirectOrJson(
        req,
        url,
        `/runs/${encodeURIComponent(result.runId)}`,
        { ok: true, runId: result.runId },
      )
    } catch (error) {
      return errorResponse(error, req, url)
    }
  }

  const cancelMatch = path.match(/^\/api\/runs\/(.+?)\/cancel$/)
  if (cancelMatch && req.method === "POST") {
    try {
      const runId = decodeURIComponent(cancelMatch[1])
      const cancelled = await getRunManager().cancel(runId)
      if (wantsJson(req, url)) {
        return Response.json({ ok: true, cancelled })
      }
      const referer = req.headers.get("referer")
      return new Response(null, {
        status: 303,
        headers: { Location: referer ?? `/runs/${encodeURIComponent(runId)}` },
      })
    } catch (error) {
      return errorResponse(error, req, url)
    }
  }

  const archiveMatch = path.match(/^\/api\/runs\/(.+?)\/archive$/)
  if (archiveMatch && req.method === "POST") {
    try {
      const runRef = decodeURIComponent(archiveMatch[1])
      const runName = await resolveRunName(runRef)
      if (!runName) {
        throw new RunManagerError(`Run not found: ${runRef}`, 404)
      }
      if (isRunManagedActive(runName) || isRunManagedActive(runRef)) {
        throw new RunManagerError("Cannot archive an active run", 409)
      }
      const archivedPath = await archiveRunDirectory(runName)
      return redirectOrJson(req, url, "/", { ok: true, runName, archivedPath })
    } catch (error) {
      return errorResponse(error, req, url)
    }
  }

  const unarchiveMatch = path.match(/^\/api\/runs\/(.+?)\/unarchive$/)
  if (unarchiveMatch && req.method === "POST") {
    try {
      const runRef = decodeURIComponent(unarchiveMatch[1])
      const runName = await resolveArchiveRunName(runRef)
      if (!runName) {
        throw new RunManagerError(`Archived run not found: ${runRef}`, 404)
      }
      try {
        await unarchiveRunDirectory(runName)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.startsWith("Cannot unarchive:")) {
          throw new RunManagerError(message, 409)
        }
        if (message.startsWith("Archived run not found:")) {
          throw new RunManagerError(message, 404)
        }
        throw error
      }
      return redirectOrJson(req, url, `/runs/${encodeURIComponent(runName)}`, {
        ok: true,
        runName,
        restoredPath: safeRunPath(runName),
      })
    } catch (error) {
      return errorResponse(error, req, url)
    }
  }

  return undefined
}
