import { loadRuntimeConfig } from "../config"
import { listConfigSummary, updatePromptAsset, updateRoleBinding } from "../config-store"
import { validateProviderPrerequisites } from "../providers/registry"
import { card, section, summaryRow, summaryTable } from "./html"
import { layout } from "./layout"
import { escapeHtml } from "./utils"

function nav() {
  return `<div class="run-nav">
  <a href="/">Runs</a>
  <a href="/config">Config</a>
  <a href="/config/roles">Roles</a>
  <a href="/config/prompts">Prompts</a>
</div>`
}

export async function renderConfigIndex(): Promise<Response> {
  const config = await loadRuntimeConfig()
  const summary = await listConfigSummary(config.env)
  const validation = await validateProviderPrerequisites(config)
    .then(() => "valid")
    .catch((error) => `invalid: ${error instanceof Error ? error.message : String(error)}`)

  const body = [
    nav(),
    `<div class="header-bar"><h1>Configuration</h1><p class="muted-note">Active profile: ${escapeHtml(summary.profile.name)}</p></div>`,
    section("Status", card(summaryTable([
      summaryRow("Profile", escapeHtml(summary.profile.name)),
      summaryRow("Validation", escapeHtml(validation)),
      summaryRow("Roles", String(summary.roles.length)),
      summaryRow("Prompt assets", String(summary.prompts.length)),
      summaryRow("Providers", escapeHtml(summary.config?.agentRuntime.defaultProvider ?? "unknown")),
    ]))),
    `<form method="POST" action="/config/validate"><button type="submit">Validate providers</button></form>`,
  ].join("\n")

  return new Response(layout("Configuration", body), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function renderConfigRoles(): Promise<Response> {
  const config = await loadRuntimeConfig()
  const summary = await listConfigSummary(config.env)
  const bindingByRole = new Map(summary.bindings.map((b) => [b.role, b]))
  const rows = summary.roles.map((role) => {
    const binding = bindingByRole.get(role.role)
    return `<div class="card">
  <h3>${escapeHtml(role.role)}</h3>
  <form method="POST" action="/config/roles/${encodeURIComponent(role.role)}">
    <label>Provider <input name="provider" value="${escapeHtml(binding?.provider ?? "opencode")}"></label>
    <label>Provider agent <input name="providerAgent" value="${escapeHtml(binding?.provider_agent ?? role.role)}"></label>
    <label>Model <input name="model" value="${escapeHtml(binding?.model ?? "")}"></label>
    <label>Variant <input name="variant" value="${escapeHtml(binding?.variant ?? "")}"></label>
    <label>Output mode <input name="outputMode" value="${escapeHtml(binding?.output_mode ?? "")}"></label>
    <button type="submit">Save</button>
  </form>
  <details><summary>Definition</summary><pre>${escapeHtml(role.content)}</pre></details>
</div>`
  })

  return new Response(layout("Config Roles", `${nav()}<div class="header-bar"><h1>Roles</h1></div>${rows.join("\n")}`), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function renderConfigPrompts(): Promise<Response> {
  const config = await loadRuntimeConfig()
  const summary = await listConfigSummary(config.env)
  const rows = summary.prompts.map((prompt) => `<div class="card">
  <h3>${escapeHtml(prompt.key)} <span class="tiny-text muted-text">v${prompt.version}</span></h3>
  <form method="POST" action="/config/prompts/${encodeURIComponent(prompt.key)}">
    <textarea name="content" rows="14" style="width:100%;font-family:var(--font-mono);">${escapeHtml(prompt.content)}</textarea>
    <button type="submit">Save prompt</button>
  </form>
</div>`)

  return new Response(layout("Config Prompts", `${nav()}<div class="header-bar"><h1>Prompts</h1></div>${rows.join("\n")}`), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function handleConfigPost(req: Request, path: string): Promise<Response | undefined> {
  const config = await loadRuntimeConfig()
  if (path === "/config/validate") {
    await validateProviderPrerequisites(config)
    return new Response(null, { status: 303, headers: { Location: "/config" } })
  }

  const roleMatch = path.match(/^\/config\/roles\/(.+)$/)
  if (roleMatch) {
    const params = new URLSearchParams(await req.text())
    await updateRoleBinding(config.env, decodeURIComponent(roleMatch[1]), {
      provider: params.get("provider")?.trim() || undefined,
      providerAgent: params.get("providerAgent")?.trim() || undefined,
      model: params.get("model")?.trim() || undefined,
      variant: params.get("variant")?.trim() || undefined,
      outputMode: params.get("outputMode")?.trim() || undefined,
    })
    return new Response(null, { status: 303, headers: { Location: "/config/roles" } })
  }

  const promptMatch = path.match(/^\/config\/prompts\/(.+)$/)
  if (promptMatch) {
    const params = new URLSearchParams(await req.text())
    await updatePromptAsset(config.env, decodeURIComponent(promptMatch[1]), params.get("content") ?? "")
    return new Response(null, { status: 303, headers: { Location: "/config/prompts" } })
  }

  return undefined
}
