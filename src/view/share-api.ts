import { access } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"

import { resolveRunName, safeFilePath } from "./paths"
import {
  ensureShareLink,
  getShareLinkByRun,
  revokeShareLink,
  sharePathForToken,
} from "./share-store"

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

async function resolveRun(runRef: string): Promise<string | null> {
  return resolveRunName(runRef)
}

async function hasFinalHtml(runName: string): Promise<boolean> {
  try {
    await access(safeFilePath(runName, "final.html"), fsConstants.R_OK)
    return true
  } catch {
    return false
  }
}

export async function handleShareApi(req: Request, path: string): Promise<Response | undefined> {
  const match = path.match(/^\/api\/runs\/(.+?)\/share\/?$/)
  if (!match) return undefined

  const runRef = decodeURIComponent(match[1])
  const runName = await resolveRun(runRef)
  if (!runName) return json({ error: "Run not found" }, 404)

  if (req.method === "GET") {
    const link = await getShareLinkByRun(runName)
    if (!link) return json({ ok: true, token: null, url: null })
    return json({ ok: true, token: link.token, url: sharePathForToken(link.token) })
  }

  if (req.method === "POST") {
    if (!(await hasFinalHtml(runName))) {
      return json({ error: "final.html is required before creating a share link" }, 400)
    }
    const link = await ensureShareLink(runName)
    return json({ ok: true, token: link.token, url: sharePathForToken(link.token) })
  }

  if (req.method === "DELETE") {
    const revoked = await revokeShareLink(runName)
    return json({ ok: true, revoked })
  }

  return json({ error: "Method not allowed" }, 405)
}
