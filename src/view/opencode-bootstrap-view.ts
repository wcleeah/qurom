import { assessOpencodeBootstrap, applyOpencodeBootstrap, type OpencodeBootstrapDecision } from "../opencode-bootstrap"
import { loadRuntimeConfig } from "../config"
import { escapeHtml } from "./utils"

export async function renderOpencodeBootstrapBanner(): Promise<string> {
  const config = await loadRuntimeConfig()
  const assessment = await assessOpencodeBootstrap(config.env.OPENCODE_DIRECTORY)
  if (assessment.status === "matches") return ""

  const detail = assessment.status === "absent" || assessment.status === "empty"
    ? `${assessment.missing.length} agent file(s) missing from .opencode/agents/`
    : [
        assessment.missing.length > 0 ? `missing: ${assessment.missing.join(", ")}` : "",
        assessment.differing.length > 0 ? `changed: ${assessment.differing.join(", ")}` : "",
      ].filter(Boolean).join(" · ")

  return `<div class="section opencode-bootstrap-banner">
  <h2>OpenCode agents</h2>
  <p class="muted-note">Local <code>.opencode/agents/</code> ${escapeHtml(assessment.status === "absent" || assessment.status === "empty" ? "needs setup" : "differs from shipped defaults")}.${detail ? ` ${escapeHtml(detail)}.` : ""}</p>
  <div class="form-actions row-inline">
    <form method="POST" action="/api/opencode-bootstrap"><input type="hidden" name="decision" value="seed" /><button type="submit" class="btn btn-secondary">Seed missing</button></form>
    <form method="POST" action="/api/opencode-bootstrap"><input type="hidden" name="decision" value="overwrite" /><button type="submit" class="btn btn-secondary">Overwrite all</button></form>
    <form method="POST" action="/api/opencode-bootstrap"><input type="hidden" name="decision" value="keep" /><button type="submit" class="btn btn-secondary">Keep local</button></form>
  </div>
</div>`
}

export async function handleOpencodeBootstrapPost(req: Request): Promise<Response> {
  const config = await loadRuntimeConfig()
  const raw = await req.text()
  const params = new URLSearchParams(raw)
  const decision = params.get("decision") as OpencodeBootstrapDecision | null
  if (decision !== "seed" && decision !== "overwrite" && decision !== "keep") {
    return new Response("Invalid decision", { status: 400 })
  }
  await applyOpencodeBootstrap(decision, config.env.OPENCODE_DIRECTORY)
  const referer = req.headers.get("referer")
  return new Response(null, {
    status: 303,
    headers: { Location: referer ?? "/" },
  })
}
