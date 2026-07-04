import { stat } from "node:fs/promises"
import { handleConfigPost, renderConfigIndex, renderConfigPrompts, renderConfigRoles } from "./config"
import {
  handleConfigDefaultsPost,
  renderConfigDefaultsBindings,
  renderConfigDefaultsIndex,
  renderConfigDefaultsOpencode,
  renderConfigDefaultsPrompts,
  renderConfigDefaultsRoles,
} from "./config-defaults"
import {
  createHtmlReaderHighlight,
  deleteHtmlReaderHighlight,
} from "./html-highlights-store"
import {
  handleDeleteAskThread,
  handleListAskMessages,
  handleListAskThreads,
  handlePostAskMessage,
} from "./html-ask-routes"
import { setHtmlReaderNotes } from "./html-notes-store"
import { renderIndex, renderNodePage, renderFilesPage, renderRun, serveRawFile } from "./pages"
import { handleOpencodeBootstrapPost } from "./opencode-bootstrap-view"
import { handleRunApi } from "./run-api"
import { resolveRunName, safeFilePath, HOST, PORT, safeRunPath } from "./paths"
import { setRunStarred } from "./starred-store"
import { viewServerAdminEnabled } from "./server-options"
import { MARKED_UMD_PATH, MARKED_UMD_URL } from "./html-viewer-markdown"

async function resolveRunDir(runName: string): Promise<{ runName: string; runDir: string }> {
  const resolved = await resolveRunName(runName)
  if (!resolved) throw new Error("Run not found")
  return { runName: resolved, runDir: safeRunPath(resolved) }
}

function defaultsRoutesDisabled() {
  return !viewServerAdminEnabled()
}

export function startViewServer(): void {
  Bun.serve({
    port: PORT,
    hostname: HOST,
    async fetch(req, server): Promise<Response> {
      const url = new URL(req.url)
      const path = url.pathname

      if (path === MARKED_UMD_URL) {
        return new Response(Bun.file(MARKED_UMD_PATH), {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
          },
        })
      }

      if (path === "/") {
        try {
          return await renderIndex(url.searchParams)
        } catch (e) {
          console.error("GET / error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      const runApiResponse = await handleRunApi(req, path, url)
      if (runApiResponse) return runApiResponse

      if (path === "/api/opencode-bootstrap" && req.method === "POST") {
        try {
          return await handleOpencodeBootstrapPost(req)
        } catch (e) {
          console.error("POST /api/opencode-bootstrap error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      if (path === "/config") {
        try {
          return await renderConfigIndex()
        } catch (e) {
          console.error("GET /config error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      if (path === "/config/roles") {
        try {
          return await renderConfigRoles()
        } catch (e) {
          console.error("GET /config/roles error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      if (path === "/config/prompts") {
        try {
          return await renderConfigPrompts()
        } catch (e) {
          console.error("GET /config/prompts error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      if (path.startsWith("/config/defaults")) {
        if (defaultsRoutesDisabled()) {
          return new Response("Not found", { status: 404 })
        }
      }

      if (path === "/config/defaults") {
        try {
          return await renderConfigDefaultsIndex()
        } catch (e) {
          console.error("GET /config/defaults error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      if (path === "/config/defaults/prompts") {
        try {
          return await renderConfigDefaultsPrompts()
        } catch (e) {
          console.error("GET /config/defaults/prompts error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      if (path === "/config/defaults/roles") {
        try {
          return await renderConfigDefaultsRoles()
        } catch (e) {
          console.error("GET /config/defaults/roles error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      if (path === "/config/defaults/opencode") {
        try {
          return await renderConfigDefaultsOpencode()
        } catch (e) {
          console.error("GET /config/defaults/opencode error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      if (path === "/config/defaults/bindings") {
        try {
          return await renderConfigDefaultsBindings()
        } catch (e) {
          console.error("GET /config/defaults/bindings error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      if (path.startsWith("/config/") && req.method === "POST") {
        try {
          if (path.startsWith("/config/defaults") && defaultsRoutesDisabled()) {
            return new Response("Not found", { status: 404 })
          }
          const defaultsResponse = await handleConfigDefaultsPost(req, path)
          if (defaultsResponse) return defaultsResponse
          const response = await handleConfigPost(req, path)
          if (response) return response
        } catch (e) {
          console.error("POST /config error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      const starMatch = path.match(/^\/runs\/(.+?)\/star$/)
      if (starMatch && req.method === "POST") {
        const runName = decodeURIComponent(starMatch[1])
        try {
          const { runName: resolvedName, runDir } = await resolveRunDir(runName)
          const runStat = await stat(runDir)
          if (!runStat.isDirectory()) {
            return new Response("Not found", { status: 404 })
          }
          const raw = await req.text()
          let starred = false
          if (raw.trim().startsWith("{")) {
            const parsed = JSON.parse(raw) as { starred?: unknown }
            starred = parsed.starred === true
          } else {
            const params = new URLSearchParams(raw)
            starred = params.get("starred") === "true"
          }
          await setRunStarred(resolvedName, starred)
          const wantsJson =
            url.searchParams.get("json") === "1"
            || (req.headers.get("accept") ?? "").includes("application/json")
          if (wantsJson) {
            return Response.json({ ok: true, starred })
          }
          const referer = req.headers.get("referer")
          return new Response(null, {
            status: 303,
            headers: { Location: referer ?? `/runs/${encodeURIComponent(resolvedName)}` },
          })
        } catch (e) {
          if (e instanceof Error && e.message === "Path traversal blocked") {
            return new Response("Not found", { status: 404 })
          }
          console.error("POST /star error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      const replyMatch = path.match(/^\/runs\/(.+?)\/reply$/)
      if (replyMatch && req.method === "POST") {
        const runName = decodeURIComponent(replyMatch[1])
        try {
          const { runName: resolvedName, runDir } = await resolveRunDir(runName)
          const raw = await req.text()
          const params = new URLSearchParams(raw)
          const answers: string[] = []
          let idx = 0
          while (params.has(`a_${idx}`)) {
            const a = params.get(`a_${idx}`) ?? ""
            if (a.trim().length > 0) answers.push(a.trim())
            idx += 1
          }
          const replyText = answers.length === 0
            ? params.get("reply") ?? raw
            : answers.length === 1
              ? answers[0]!
              : answers.map((answer, answerIndex) => `Answer ${answerIndex + 1}: ${answer}`).join("\n\n")
          await Bun.write(`${runDir}/reader-reply.json`, JSON.stringify({ reply: replyText }))
          return new Response(null, {
            status: 303,
            headers: { Location: `/runs/${encodeURIComponent(resolvedName)}` },
          })
        } catch (e) {
          console.error("POST /reply error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      const htmlNotesMatch = path.match(/^\/runs\/(.+?)\/html-notes$/)
      if (htmlNotesMatch && req.method === "POST") {
        const runName = decodeURIComponent(htmlNotesMatch[1])
        try {
          const { runName: resolvedName, runDir } = await resolveRunDir(runName)
          const runStat = await stat(runDir)
          if (!runStat.isDirectory()) {
            return new Response("Not found", { status: 404 })
          }
          const raw = await req.text()
          let file = ""
          let notes = ""
          if (raw.trim().startsWith("{")) {
            const parsed = JSON.parse(raw) as { file?: unknown; notes?: unknown }
            file = typeof parsed.file === "string" ? parsed.file : ""
            notes = typeof parsed.notes === "string" ? parsed.notes : ""
          } else {
            const params = new URLSearchParams(raw)
            file = params.get("file") ?? ""
            notes = params.get("notes") ?? ""
          }
          if (!file) {
            return new Response("Missing file", { status: 400 })
          }
          const resolved = safeFilePath(resolvedName, file)
          const fileStat = await stat(resolved)
          if (!fileStat.isFile()) {
            return new Response("Not found", { status: 404 })
          }
          const result = await setHtmlReaderNotes(resolvedName, file, notes)
          return Response.json({ ok: true, updatedAt: result.updatedAt })
        } catch (e) {
          if (e instanceof Error && (e.message === "Path traversal blocked" || e.message === "Only HTML files support reader annotations")) {
            return new Response("Not found", { status: 404 })
          }
          console.error("POST /html-notes error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      const htmlHighlightsMatch = path.match(/^\/runs\/(.+?)\/html-highlights(?:\/([^/]+))?$/)
      if (htmlHighlightsMatch) {
        const runName = decodeURIComponent(htmlHighlightsMatch[1])
        const highlightId = htmlHighlightsMatch[2] ? decodeURIComponent(htmlHighlightsMatch[2]) : undefined
        try {
          const { runName: resolvedName, runDir } = await resolveRunDir(runName)
          const runStat = await stat(runDir)
          if (!runStat.isDirectory()) {
            return new Response("Not found", { status: 404 })
          }

          if (req.method === "POST" && !highlightId) {
            const raw = await req.text()
            let file = ""
            let color = ""
            let quote = ""
            let prefix = ""
            let suffix = ""
            if (raw.trim().startsWith("{")) {
              const parsed = JSON.parse(raw) as {
                file?: unknown
                color?: unknown
                quote?: unknown
                prefix?: unknown
                suffix?: unknown
              }
              file = typeof parsed.file === "string" ? parsed.file : ""
              color = typeof parsed.color === "string" ? parsed.color : ""
              quote = typeof parsed.quote === "string" ? parsed.quote : ""
              prefix = typeof parsed.prefix === "string" ? parsed.prefix : ""
              suffix = typeof parsed.suffix === "string" ? parsed.suffix : ""
            } else {
              const params = new URLSearchParams(raw)
              file = params.get("file") ?? ""
              color = params.get("color") ?? ""
              quote = params.get("quote") ?? ""
              prefix = params.get("prefix") ?? ""
              suffix = params.get("suffix") ?? ""
            }
            if (!file) {
              return new Response("Missing file", { status: 400 })
            }
            const resolved = safeFilePath(resolvedName, file)
            const fileStat = await stat(resolved)
            if (!fileStat.isFile()) {
              return new Response("Not found", { status: 404 })
            }
            const highlight = await createHtmlReaderHighlight({
              runName: resolvedName,
              filePath: file,
              color,
              quote,
              prefix,
              suffix,
            })
            return Response.json({ ok: true, highlight })
          }

          if (req.method === "DELETE" && highlightId) {
            const file = url.searchParams.get("file") ?? ""
            if (!file) {
              return new Response("Missing file", { status: 400 })
            }
            const resolved = safeFilePath(resolvedName, file)
            const fileStat = await stat(resolved)
            if (!fileStat.isFile()) {
              return new Response("Not found", { status: 404 })
            }
            const deleted = await deleteHtmlReaderHighlight(resolvedName, file, highlightId)
            if (!deleted) {
              return new Response("Not found", { status: 404 })
            }
            return Response.json({ ok: true })
          }
        } catch (e) {
          if (e instanceof Error && (
            e.message === "Path traversal blocked"
            || e.message === "Only HTML files support reader annotations"
            || e.message === "Highlight quote is required"
            || e.message === "Invalid highlight color"
          )) {
            return new Response(e.message === "Path traversal blocked" ? "Not found" : "Bad request", {
              status: e.message === "Path traversal blocked" ? 404 : 400,
            })
          }
          console.error("HTML highlights error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      const htmlAskThreadsMatch = path.match(/^\/runs\/(.+?)\/html-ask\/threads(?:\/([^/]+))?(?:\/messages)?$/)
      if (htmlAskThreadsMatch) {
        const runName = decodeURIComponent(htmlAskThreadsMatch[1])
        const threadId = htmlAskThreadsMatch[2] ? decodeURIComponent(htmlAskThreadsMatch[2]) : undefined
        const isMessages = path.endsWith("/messages")
        try {
          const file = url.searchParams.get("file") ?? ""
          if (!file) {
            return new Response("Missing file", { status: 400 })
          }
          if (req.method === "GET" && !threadId && !isMessages) {
            return await handleListAskThreads(runName, file)
          }
          if (req.method === "GET" && threadId && isMessages) {
            return await handleListAskMessages(runName, file, threadId)
          }
          if (req.method === "DELETE" && threadId && !isMessages) {
            return await handleDeleteAskThread(runName, file, threadId)
          }
        } catch (e) {
          if (e instanceof Error && (e.message === "Path traversal blocked" || e.message === "Not found" || e.message === "Only HTML files support reader annotations")) {
            return new Response("Not found", { status: 404 })
          }
          console.error("HTML ask threads error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      const htmlAskMessagesMatch = path.match(/^\/runs\/(.+?)\/html-ask\/messages$/)
      if (htmlAskMessagesMatch && req.method === "POST") {
        // Ask streams SSE while the provider agent runs; disable Bun's 10s idle timeout.
        server.timeout(req, 0)
        const runName = decodeURIComponent(htmlAskMessagesMatch[1])
        try {
          return await handlePostAskMessage(req, runName)
        } catch (e) {
          console.error("POST /html-ask/messages error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      const rawMatch = path.match(/^\/runs\/(.+?)\/raw\/(.+)$/)
      if (rawMatch) {
        try {
          return await serveRawFile(
            decodeURIComponent(rawMatch[1]),
            decodeURIComponent(rawMatch[2]),
            url.searchParams,
          )
        } catch (e) {
          console.error("Raw file error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      const filesMatch = path.match(/^\/runs\/(.+?)\/files$/)
      if (filesMatch) {
        try {
          return await renderFilesPage(decodeURIComponent(filesMatch[1]))
        } catch (e) {
          console.error("Files page error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      const nodeMatch = path.match(/^\/runs\/(.+?)\/node\/(.+)$/)
      if (nodeMatch) {
        try {
          return await renderNodePage(decodeURIComponent(nodeMatch[1]), decodeURIComponent(nodeMatch[2]))
        } catch (e) {
          console.error("Node page error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      const runMatch = path.match(/^\/runs\/(.+)$/)
      if (runMatch) {
        try {
          return await renderRun(decodeURIComponent(runMatch[1]))
        } catch (e) {
          console.error("Run detail error:", e)
          return new Response("Internal error", { status: 500 })
        }
      }

      return new Response("Not found", { status: 404 })
    },
  })

  console.log(`Runs viewer running at http://${HOST}:${PORT}`)
  console.log(`   Serving: ${safeRunPath("").replace(/\/$/, "")}`)
}
