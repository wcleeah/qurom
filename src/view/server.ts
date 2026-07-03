import { stat } from "node:fs/promises"
import { handleConfigPost, renderConfigIndex, renderConfigPrompts, renderConfigRoles } from "./config"
import {
  createHtmlReaderHighlight,
  deleteHtmlReaderHighlight,
} from "./html-highlights-store"
import { setHtmlReaderNotes } from "./html-notes-store"
import { renderIndex, renderNodePage, renderRun, serveRawFile } from "./pages"
import { safeFilePath, HOST, PORT, safeRunPath } from "./paths"
import { setRunStarred } from "./starred-store"

export function startViewServer(): void {
  Bun.serve({
    port: PORT,
    hostname: HOST,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url)
      const path = url.pathname

      if (path === "/") {
        try {
          return await renderIndex(url.searchParams)
        } catch (e) {
          console.error("GET / error:", e)
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

      if (path.startsWith("/config/") && req.method === "POST") {
        try {
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
          const runDir = safeRunPath(runName)
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
          await setRunStarred(runName, starred)
          const wantsJson =
            url.searchParams.get("json") === "1"
            || (req.headers.get("accept") ?? "").includes("application/json")
          if (wantsJson) {
            return Response.json({ ok: true, starred })
          }
          const referer = req.headers.get("referer")
          return new Response(null, {
            status: 303,
            headers: { Location: referer ?? `/runs/${encodeURIComponent(runName)}` },
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
          const runDir = safeRunPath(runName)
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
            headers: { Location: `/runs/${encodeURIComponent(runName)}` },
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
          const runDir = safeRunPath(runName)
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
          const resolved = safeFilePath(runName, file)
          const fileStat = await stat(resolved)
          if (!fileStat.isFile()) {
            return new Response("Not found", { status: 404 })
          }
          const result = await setHtmlReaderNotes(runName, file, notes)
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
          const runDir = safeRunPath(runName)
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
            const resolved = safeFilePath(runName, file)
            const fileStat = await stat(resolved)
            if (!fileStat.isFile()) {
              return new Response("Not found", { status: 404 })
            }
            const highlight = await createHtmlReaderHighlight({
              runName,
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
            const resolved = safeFilePath(runName, file)
            const fileStat = await stat(resolved)
            if (!fileStat.isFile()) {
              return new Response("Not found", { status: 404 })
            }
            const deleted = await deleteHtmlReaderHighlight(runName, file, highlightId)
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
