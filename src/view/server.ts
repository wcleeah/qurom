import { HOST, PORT, safeRunPath } from "./paths"
import { renderIndex, renderNodePage, renderRun, serveRawFile } from "./pages"
import { handleConfigPost, renderConfigIndex, renderConfigPrompts, renderConfigRoles } from "./config"

export function startViewServer(): void {
  Bun.serve({
    port: PORT,
    hostname: HOST,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url)
      const path = url.pathname

      if (path === "/") {
        try {
          return await renderIndex()
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
              : answers.join("\n\n")
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
