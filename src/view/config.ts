import { loadRuntimeConfig, type QuorumConfig } from "../config"
import { applyCursorUsageImport, parseCursorUsageCsv, type CursorUsageImportSummary } from "../cursor-usage-import"
import { defaultOpenCodeDbPath } from "../data-paths"
import {
  applyOpenCodeUsageImport,
  isOpenCodeDbConfigured,
  type OpenCodeUsageImportSummary,
} from "../opencode-usage-import"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { deleteMcpServer, listConfigSummary, loadMcpRegistryFromStore, normalizeQuorumConfig, saveMcpServer, setEnabledMcpServers, updatePromptAsset, updateQuorumConfig, updateRoleBinding } from "../config-store"
import { promptAssetDefs, type PromptAssetKey } from "../prompt-asset-defs"
import { availableProviderIds, configuredAgentRoles, providerConfigForm } from "../providers/registry"
import { getProviderLifecycle } from "../providers/lifecycle"
import { rolesUsingProvider, validateProviderPrerequisites } from "../providers/registry"
import { DEFAULT_PROVIDER } from "../role-registry"
import type { AgentProviderId, ProviderConfigFormDescriptor, ProviderConfigFormParameter } from "../providers/types"
import { card, section, summaryRow, summaryTable } from "./html"
import { layout } from "./layout"
import { configNavbarOptions } from "./config-nav"
import { readActiveOpencodeAgent, renderOpencodeAgentReadonly } from "./opencode-agent-display"
import { parseQuorumConfigForm, quorumConfigFormScript, renderQuorumConfigForm } from "./quorum-config-form"
import { escapeHtml } from "./utils"
import { mcpServerSchema, type McpServer } from "../mcp-config"

function parseOptionsJson(text: string | undefined) {
  if (!text) return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}

let lastProviderValidation: { ok: boolean; message: string } | undefined
let lastCursorUsageImport: CursorUsageImportSummary | undefined
let lastOpenCodeUsageImport: OpenCodeUsageImportSummary | undefined
let lastMcpError: string | undefined

function parsePairs(value: string) {
  return Object.fromEntries(value.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const index = line.indexOf("=")
    if (index < 1) throw new Error(`Expected KEY=value, received ${JSON.stringify(line)}`)
    return [line.slice(0, index).trim(), line.slice(index + 1)]
  }))
}

export async function renderConfigMcp(error = lastMcpError): Promise<Response> {
  const config = await loadRuntimeConfig()
  const registry = await loadMcpRegistryFromStore(config.env)
  const enabled = new Set(registry.enabled)
  const serverCards = registry.servers.map((server) => {
    const shared = `<input type="hidden" name="previousName" value="${escapeHtml(server.name)}">
<label class="form-field"><span>Name</span><input class="form-input" name="name" required value="${escapeHtml(server.name)}"></label>`
    const fields = server.type === "local"
      ? `${shared}<input type="hidden" name="type" value="local">
<label class="form-field"><span>Command</span><input class="form-input" name="command" required value="${escapeHtml(server.command)}"></label>
<label class="form-field"><span>Arguments (one per line)</span><textarea name="args" rows="3">${escapeHtml(server.args.join("\n"))}</textarea></label>
<label class="form-field"><span>Environment (KEY=value per line)</span><textarea name="environment" rows="3">${escapeHtml(Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join("\n"))}</textarea></label>
<label class="form-field"><span>Working directory</span><input class="form-input" name="cwd" value="${escapeHtml(server.cwd ?? "")}"></label>`
      : `${shared}<input type="hidden" name="type" value="remote">
<label class="form-field"><span>URL</span><input class="form-input" type="url" name="url" required value="${escapeHtml(server.url)}"></label>
<label class="form-field"><span>Headers (KEY=value per line)</span><textarea name="headers" rows="3">${escapeHtml(Object.entries(server.headers).map(([k, v]) => `${k}=${v}`).join("\n"))}</textarea></label>
<label class="form-field"><span>OAuth client ID</span><input class="form-input" name="clientId" value="${escapeHtml(server.oauth && typeof server.oauth === "object" ? server.oauth.clientId ?? "" : "")}"></label>
<label class="form-field"><span>OAuth client secret</span><input class="form-input" name="clientSecret" value="${escapeHtml(server.oauth && typeof server.oauth === "object" ? server.oauth.clientSecret ?? "" : "")}"></label>
<label class="form-field"><span>OAuth scopes (space-separated)</span><input class="form-input" name="scopes" value="${escapeHtml(server.oauth && typeof server.oauth === "object" ? server.oauth.scopes?.join(" ") ?? "" : "")}"></label>`
    return card(`<h3>${escapeHtml(server.name)} <span class="tiny-text muted-text">${server.type}</span></h3>
<form class="config-form" method="POST" action="/config/mcp/save">${fields}<div class="form-actions"><button class="btn btn-primary">Save</button></div></form>
<form method="POST" action="/config/mcp/delete"><input type="hidden" name="name" value="${escapeHtml(server.name)}"><button class="btn" type="submit">Delete</button></form>`)
  }).join("\n")
  const enableRows = registry.servers.map((server) =>
    `<label class="form-checkbox"><input type="checkbox" name="enabled" value="${escapeHtml(server.name)}"${enabled.has(server.name) ? " checked" : ""}><span>${escapeHtml(server.name)}</span></label>`).join("")
  const create = (type: "local" | "remote") => `<form class="config-form" method="POST" action="/config/mcp/save">
<input type="hidden" name="type" value="${type}"><label class="form-field"><span>Name</span><input class="form-input" name="name" required></label>
${type === "local"
  ? '<label class="form-field"><span>Command</span><input class="form-input" name="command" required></label><label class="form-field"><span>Arguments (one per line)</span><textarea name="args"></textarea></label><label class="form-field"><span>Environment (KEY=value per line)</span><textarea name="environment"></textarea></label><label class="form-field"><span>Working directory</span><input class="form-input" name="cwd"></label>'
  : '<label class="form-field"><span>URL</span><input class="form-input" type="url" name="url" required></label><label class="form-field"><span>Headers (KEY=value per line)</span><textarea name="headers"></textarea></label><label class="form-field"><span>OAuth client ID</span><input class="form-input" name="clientId"></label><label class="form-field"><span>OAuth client secret</span><input class="form-input" name="clientSecret"></label><label class="form-field"><span>OAuth scopes</span><input class="form-input" name="scopes"></label>'}
<div class="form-actions"><button class="btn btn-primary">Add ${type} server</button></div></form>`
  const body = `<div class="header-bar"><div class="header-main"><h1>MCP Registry</h1></div></div>
${error ? `<div class="outcome-banner failed">${escapeHtml(error)}</div>` : ""}
${section("Globally enabled servers", `<form method="POST" action="/config/mcp/enabled">${enableRows || '<p class="muted-text">No servers registered.</p>'}<div class="form-actions"><button class="btn btn-primary">Save enabled servers</button></div></form>`)}
${section("Registered servers", serverCards || '<p class="muted-text">No servers registered.</p>')}
${section("Add local server", create("local"))}${section("Add remote server", create("remote"))}`
  return new Response(layout("MCP Registry", body, { navbar: configNavbarOptions("MCP", "mcp") }), { headers: { "content-type": "text/html; charset=utf-8" } })
}

function mcpServerFromParams(params: URLSearchParams): McpServer {
  const name = params.get("name") ?? ""
  if (params.get("type") === "local") {
    return mcpServerSchema.parse({
      name, type: "local", command: params.get("command") ?? "",
      args: (params.get("args") ?? "").split(/\r?\n/).filter(Boolean),
      env: parsePairs(params.get("environment") ?? ""),
      cwd: params.get("cwd")?.trim() || undefined,
    })
  }
  const clientId = params.get("clientId")?.trim()
  return mcpServerSchema.parse({
    name, type: "remote", url: params.get("url") ?? "", headers: parsePairs(params.get("headers") ?? ""),
    oauth: clientId ? {
      clientId,
      clientSecret: params.get("clientSecret")?.trim() || undefined,
      scopes: params.get("scopes")?.split(/\s+/).filter(Boolean),
    } : undefined,
  })
}

function renderCursorUsageImportSection(importSummary?: CursorUsageImportSummary) {
  const summary = importSummary ?? lastCursorUsageImport
  const summaryHtml = summary
    ? `<div class="outcome-banner approved">Imported ${escapeHtml(summary.sourceFile)}: matched ${summary.matchedCalls}/${summary.metadataCalls} Cursor calls across ${summary.runsUpdated} run(s). Unmatched: ${summary.unmatchedCalls}.</div>`
    : `<p class="tiny-text muted-text">Upload a Cursor usage CSV export to backfill token usage, cost (when present in the CSV), and models for cloud agent calls in existing runs.</p>`

  return section("Cursor usage import", `${summaryHtml}
<form class="config-form" method="POST" action="/config/cursor-usage-import" enctype="multipart/form-data">
  <label class="form-field"><span>Usage CSV</span><input class="form-input" type="file" name="csv" accept=".csv,text/csv" required><small>Export from Cursor settings → Usage. Matches by Cloud Agent ID and call order.</small></label>
  <div class="form-actions"><button type="submit" class="btn btn-primary">Import usage into runs</button></div>
</form>`)
}

function renderOpenCodeUsageImportSection(importSummary?: OpenCodeUsageImportSummary) {
  const summary = importSummary ?? lastOpenCodeUsageImport
  const dbPath = defaultOpenCodeDbPath()
  const dbAvailable = isOpenCodeDbConfigured(dbPath)
  const statusHtml = dbAvailable
    ? `<p class="tiny-text muted-text">Creates or fills <code>session-telemetry.json</code> for OpenCode runs by reading session IDs from each run's debug log and looking up usage in OpenCode's local database at <code>${escapeHtml(dbPath)}</code>.</p>`
    : `<div class="outcome-banner failed">OpenCode database not found at <code>${escapeHtml(dbPath)}</code>. Run OpenCode locally first, or set <code>OPENCODE_DB</code> to the correct path.</div>`
  const summaryHtml = summary
    ? `<div class="outcome-banner approved">Backfilled ${summary.matchedSessions}/${summary.sessionsNeedingBackfill} OpenCode session(s) across ${summary.runsUpdated} run(s). Unmatched: ${summary.unmatchedSessions}.</div>`
    : ""

  return section("OpenCode usage backfill", `${statusHtml}
${summaryHtml}
<form class="config-form" method="POST" action="/config/opencode-usage-import">
  <div class="form-actions"><button type="submit" class="btn btn-primary"${dbAvailable ? "" : " disabled"}>Backfill OpenCode usage from local DB</button></div>
</form>`)
}

export async function renderConfigIndex(options?: {
  error?: string
  draftConfig?: QuorumConfig
  importSummary?: CursorUsageImportSummary
  opencodeImportSummary?: OpenCodeUsageImportSummary
}): Promise<Response> {
  const config = await loadRuntimeConfig()
  const summary = await listConfigSummary(config.env)
  const validation = lastProviderValidation
  const validationLabel = validation
    ? (validation.ok ? "valid" : escapeHtml(validation.message))
    : "not checked — click Validate providers"
  const isValid = validation?.ok === true
  const quorumConfig = options?.draftConfig ?? summary.config ?? config.quorumConfig

  const statusCard = `<div class="structured-card">
  <div class="outcome-banner ${validation ? (isValid ? "approved" : "failed") : "needs-revision"}">${validation ? (isValid ? "Providers valid" : "Validation failed") : "Providers not validated"}</div>
  ${summaryTable([
    summaryRow("Profile", escapeHtml(summary.profile.name)),
    summaryRow("Validation", validationLabel),
    summaryRow("Roles", String(summary.bindings.length)),
    summaryRow("Prompt assets", String(summary.prompts.length)),
    summaryRow("Data directory", escapeHtml(config.env.QUORUM_DATA_DIR)),
    summaryRow("Config database", escapeHtml(config.env.QUORUM_CONFIG_DB_PATH)),
    summaryRow("Checkpoints database", escapeHtml(config.env.QUORUM_CHECKPOINT_PATH)),
    summaryRow("Runs directory", escapeHtml(config.env.QUORUM_RUNS_DIR)),
    summaryRow("Default provider", escapeHtml(DEFAULT_PROVIDER)),
  ])}
</div>`
  const quorumConfigForm = renderQuorumConfigForm({
    action: "/config/quorum",
    config: quorumConfig,
    submitLabel: "Save quorum config",
    researchToolIds: config.mcpRegistry.enabled,
    error: options?.error,
  })

  const body = [
    `<div class="header-bar"><div class="header-main"><h1>Configuration</h1><div class="meta-row"><span class="meta-item">Active profile: <strong>${escapeHtml(summary.profile.name)}</strong></span></div></div></div>`,
    section("Status", statusCard),
    `<form class="config-form" method="POST" action="/config/validate"><div class="form-actions"><button type="submit" class="btn btn-primary">Validate providers</button></div></form>`,
    renderCursorUsageImportSection(options?.importSummary),
    renderOpenCodeUsageImportSection(options?.opencodeImportSummary),
    section("Quorum policy", quorumConfigForm),
  ].join("\n")

  return new Response(layout("Configuration", body, {
    extraHead: quorumConfigFormScript,
    navbar: configNavbarOptions("Configuration", "overview"),
  }), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function renderConfigRoles(): Promise<Response> {
  const config = await loadRuntimeConfig()
  const summary = await listConfigSummary(config.env)
  const bindingByRole = new Map(summary.bindings.map((b) => [b.role, b]))
  const providerIds = availableProviderIds()
  const roles = configuredAgentRoles(config)
  const field = (label: string, name: string, value: string, help: string, placeholder = "unset", disabled = false) =>
    `<label class="form-field"><span>${label}</span><input class="form-input" name="${name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"${disabled ? " disabled" : ""}><small>${escapeHtml(help)}</small></label>`

  const providerTabs = (role: string, current: string) => {
    const options = providerIds.includes(current) ? providerIds : [current, ...providerIds]
    const tabs = options
      .map((id, i) => {
        const inputId = `provider-${encodeURIComponent(role)}-${i}`
        const checked = id === current ? " checked" : ""
        return `<input type="radio" class="provider-tab-input" id="${inputId}" name="provider" value="${escapeHtml(id)}"${checked}><label class="provider-tab" for="${inputId}">${escapeHtml(id)}</label>`
      })
      .join("")
    return `<div class="form-field"><span>Provider</span><div class="provider-tabs">${tabs}</div></div>`
  }

  const selectField = (label: string, name: string, value: string, options: Array<{ id: string; label: string }>, help: string, disabled = false) => {
    const optionHtml = [
      value && !options.some((option) => option.id === value)
        ? `<option value="${escapeHtml(value)}" selected>${escapeHtml(value)} (saved)</option>`
        : "",
      ...options.map((option) => `<option value="${escapeHtml(option.id)}"${option.id === value ? " selected" : ""}>${escapeHtml(option.label)}</option>`),
    ].join("")
    return `<label class="form-field"><span>${label}</span><select class="form-input" name="${name}"${disabled ? " disabled" : ""}>${optionHtml}</select><small>${escapeHtml(help)}</small></label>`
  }

  const providerHelp = (provider: string) => {
    if (provider === "cursor") {
      return "Cursor runs this role through the Cursor Agent SDK. Behavioral prompts are edited on the Prompts tab."
    }
    if (provider === "opencode") {
      return "OpenCode runs this role through the named provider agent. Edit .opencode/agents/<role>.md on disk for model and permissions. Behavioral prompts are on the Prompts tab."
    }
    return "This provider controls which runtime executes the role."
  }

  const providerFields = (
    role: string,
    binding: (typeof summary.bindings)[number] | undefined,
    descriptor: ProviderConfigFormDescriptor,
    active: boolean,
    opencodeAgentHtml: string,
  ) => {
    if (descriptor.providerId === "opencode") {
      return `<div class="provider-fields"${active ? "" : " hidden"} data-provider-fields="opencode">
  ${opencodeAgentHtml}
</div>`
    }

    const fields = descriptor.fields ?? { providerAgent: true, model: "text", variant: true, outputMode: true }
    const options = parseOptionsJson(binding?.options_json)
    const savedParams = new Map(
      (Array.isArray(options.modelParams) ? options.modelParams : [])
        .filter((entry): entry is { id: string; value: string } =>
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof (entry as { id?: unknown }).id === "string" &&
          typeof (entry as { value?: unknown }).value === "string")
        .map((param) => [param.id, param.value]),
    )
    const model = binding?.model ?? ""
    const selectedModelParameters = descriptor.parametersByModel?.[model] ?? []
    const warnings = descriptor.warnings?.length
      ? `<div class="outcome-banner failed">${descriptor.warnings.map(escapeHtml).join("<br>")}</div>`
      : ""

    const controls: string[] = []
    if (fields.providerAgent !== false) {
      controls.push(field("Provider agent / role label", "providerAgent", binding?.provider_agent ?? "", "OpenCode: agent name. Cursor: optional label only.", role, !active))
    }
    if (fields.model === "select" && descriptor.modelOptions?.length) {
      controls.push(selectField("Model", "model", model, descriptor.modelOptions, "Loaded from the provider catalog for this account.", !active))
    } else if (fields.model !== false) {
      controls.push(field("Model", "model", model, "Provider model id. Cursor requires this for local runs.", "composer-2.5", !active))
    }
    if (fields.variant) {
      controls.push(field("Variant", "variant", binding?.variant ?? "", "Provider-specific variant. Mostly used by OpenCode today.", "unset", !active))
    }
    if (fields.outputMode) {
      controls.push(field("Output mode", "outputMode", binding?.output_mode ?? "", "Reserved for structured output preference; leave unset unless a provider documents it.", "unset", !active))
    }

    const parameterControls = selectedModelParameters.map((parameter: ProviderConfigFormParameter) => {
      const saved = savedParams.get(parameter.id) ?? parameter.values[0]?.value ?? ""
      if (parameter.values.length === 0) {
        return field(parameter.label, `modelParam:${parameter.id}`, saved, `Cursor model parameter ${parameter.id}.`, "unset", !active)
      }
      return selectField(parameter.label, `modelParam:${parameter.id}`, saved, parameter.values.map((value) => ({ id: value.value, label: value.label })), `Cursor model parameter ${parameter.id}.`, !active)
    })

    const parameterBlock = parameterControls.length
      ? `<div class="form-fields-grid">${parameterControls.join("\n")}</div>`
      : descriptor.providerId === "cursor"
        ? `<p class="tiny-text muted-text">No parameter controls are exposed for the selected Cursor model.</p>`
        : ""

    return `<div class="provider-fields"${active ? "" : " hidden"} data-provider-fields="${escapeHtml(descriptor.providerId)}">
  <p class="tiny-text muted-text">${escapeHtml(providerHelp(descriptor.providerId))}</p>
  ${warnings}<div class="form-fields-grid">${controls.join("\n")}</div>${parameterBlock}
</div>`
  }

  const descriptors = new Map(await Promise.all(providerIds.map(async (id) => [id, await providerConfigForm(config, id as AgentProviderId)] as const)))
  const opencodeAgentHtmlByRole = new Map(await Promise.all(
    roles.map(async (role) => [role, renderOpencodeAgentReadonly(await readActiveOpencodeAgent(config.env.OPENCODE_DIRECTORY, role))] as const),
  ))
  const cards = await Promise.all(roles.map(async (role) => {
    const binding = bindingByRole.get(role)
    const currentProvider = binding?.provider ?? DEFAULT_PROVIDER
    const opencodeAgentHtml = opencodeAgentHtmlByRole.get(role) ?? ""
    const providerFormBlocks = providerIds
      .map((id) => providerFields(role, binding, descriptors.get(id)!, id === currentProvider, opencodeAgentHtml))
      .join("\n")
    const opencodeActive = currentProvider === "opencode"
    const form = `<form class="config-form" method="POST" action="/config/roles/${encodeURIComponent(role)}">
  ${providerTabs(role, currentProvider)}
  ${providerFormBlocks}
  <div class="form-actions" data-save-actions${opencodeActive ? " hidden" : ""}><button type="submit" class="btn btn-primary">Save provider binding</button></div>
</form>`
    return card(`<div data-role-card><h3>${escapeHtml(role)}</h3>${form}</div>`)
  }))

  const body = [
    `<div class="header-bar"><div class="header-main"><h1>Roles</h1></div></div>`,
    section("Role provider bindings", cards.join("\n")),
  ].join("\n")

  const roleFormScript = `<script>
(function(){
  function init(){
  document.querySelectorAll("form.config-form").forEach(function(form){
    if (!form.querySelector("input[name='provider']")) return;
    var radios = form.querySelectorAll("input[name='provider']");
    function sync(){
      var checked = form.querySelector("input[name='provider']:checked");
      var provider = checked ? checked.value : "";
      form.querySelectorAll("[data-provider-fields]").forEach(function(block){
        var active = block.getAttribute("data-provider-fields") === provider;
        block.hidden = !active;
        block.querySelectorAll("input,select,textarea").forEach(function(input){
          input.disabled = !active;
        });
      });
      var isOpencode = provider === "opencode";
      var saveActions = form.querySelector("[data-save-actions]");
      if (saveActions) saveActions.hidden = isOpencode;
    }
    radios.forEach(function(radio){ radio.addEventListener("change", sync); });
    sync();
  });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
</script>`
  return new Response(layout("Config Roles", body, {
    extraHead: roleFormScript,
    navbar: configNavbarOptions("Roles", "roles"),
  }), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function renderConfigPrompts(): Promise<Response> {
  const config = await loadRuntimeConfig()
  const summary = await listConfigSummary(config.env)
  const promptByKey = new Map(summary.prompts.map((prompt) => [prompt.key, prompt]))
  const roles = [...new Set(Object.values(promptAssetDefs).map((def) => def.role))].sort()
  const sections = roles.map((role) => {
    const cards = (Object.entries(promptAssetDefs) as Array<[PromptAssetKey, (typeof promptAssetDefs)[PromptAssetKey]]>)
      .filter(([, def]) => def.role === role)
      .map(([key, def]) => {
        const prompt = promptByKey.get(key)
        const content = prompt?.content ?? ""
        const version = prompt?.version ?? 0
        const form = `<form class="config-form" method="POST" action="/config/prompts/${encodeURIComponent(key)}">
  <p class="tiny-text muted-text"><code>${escapeHtml(def.file)}</code></p>
  <textarea name="content" rows="14">${escapeHtml(content)}</textarea>
  <div class="form-actions"><button type="submit" class="btn btn-primary">Save prompt</button></div>
</form>`
        return card(`<h3>${escapeHtml(def.label)} <span class="tiny-text muted-text">${escapeHtml(key)} v${version}</span></h3>${form}`)
      })
    return section(role, cards.join("\n"))
  })

  const body = [
    `<div class="header-bar"><div class="header-main"><h1>Prompts</h1><p class="tiny-text muted-text">Each file is the full prompt for that call site. The graph only fills template placeholders.</p></div></div>`,
    ...sections,
  ].join("\n")

  return new Response(layout("Config Prompts", body, {
    navbar: configNavbarOptions("Prompts", "prompts"),
  }), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function handleConfigPost(req: Request, path: string): Promise<Response | undefined> {
  const config = await loadRuntimeConfig()

  if (path.startsWith("/config/mcp/")) {
    try {
      const params = new URLSearchParams(await req.text())
      if (path === "/config/mcp/save") await saveMcpServer(config.env, mcpServerFromParams(params), params.get("previousName") ?? undefined)
      else if (path === "/config/mcp/delete") await deleteMcpServer(config.env, params.get("name") ?? "")
      else if (path === "/config/mcp/enabled") await setEnabledMcpServers(config.env, params.getAll("enabled"))
      else return undefined
      await getProviderLifecycle().shutdown()
      lastMcpError = undefined
      return new Response(null, { status: 303, headers: { Location: "/config/mcp" } })
    } catch (error) {
      lastMcpError = error instanceof Error ? error.message : String(error)
      return renderConfigMcp(lastMcpError)
    }
  }

  if (path === "/config/cursor-usage-import") {
    try {
      const form = await req.formData()
      const file = form.get("csv")
      if (!(file instanceof File)) {
        return renderConfigIndex({ error: "Upload a CSV file in the csv field." })
      }
      const text = await file.text()
      const totalCsvRows = Math.max(0, text.trim().split(/\r?\n/).length - 1)
      const rows = parseCursorUsageCsv(text)
      if (rows.length === 0) {
        return renderConfigIndex({ error: "No Cloud Agent ID rows found in CSV." })
      }

      const importsDir = join(config.env.QUORUM_DATA_DIR, "usage-imports")
      await mkdir(importsDir, { recursive: true })
      const archiveName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]+/g, "-")}`
      await Bun.write(join(importsDir, archiveName), text)

      const summary = await applyCursorUsageImport({
        runsDir: config.env.QUORUM_RUNS_DIR,
        rows,
        sourceFile: file.name,
        totalCsvRows,
      })
      lastCursorUsageImport = summary
      return renderConfigIndex({ importSummary: summary })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return renderConfigIndex({ error: message })
    }
  }

  if (path === "/config/opencode-usage-import") {
    try {
      const summary = await applyOpenCodeUsageImport({
        runsDir: config.env.QUORUM_RUNS_DIR,
      })
      lastOpenCodeUsageImport = summary
      return renderConfigIndex({ opencodeImportSummary: summary })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return renderConfigIndex({ error: message })
    }
  }

  if (path === "/config/validate") {
    const lifecycle = getProviderLifecycle()
    let release: (() => Promise<void>) | undefined
    try {
      if (rolesUsingProvider(config, "opencode").length > 0) {
        release = await lifecycle.acquire(config, "opencode")
      }
      await validateProviderPrerequisites(config)
      lastProviderValidation = { ok: true, message: "valid" }
    } catch (error) {
      lastProviderValidation = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }
    } finally {
      if (release) await release()
    }
    return new Response(null, { status: 303, headers: { Location: "/config" } })
  }

  if (path === "/config/quorum") {
    const params = new URLSearchParams(await req.text())
    try {
      const parsed = normalizeQuorumConfig(parseQuorumConfigForm(params))
      await updateQuorumConfig(config.env, JSON.stringify(parsed, null, 2))
      return new Response(null, { status: 303, headers: { Location: "/config" } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      let draftConfig
      try {
        draftConfig = parseQuorumConfigForm(params)
      } catch {
        draftConfig = config.quorumConfig
      }
      return renderConfigIndex({ error: message, draftConfig })
    }
  }

  const roleMatch = path.match(/^\/config\/roles\/(.+)$/)
  if (roleMatch) {
    const params = new URLSearchParams(await req.text())
    const provider = params.get("provider")?.trim() || undefined
    const options: Record<string, unknown> = {}
    if (provider === "cursor") {
      const modelParams = [...params.entries()]
        .filter(([key, value]) => key.startsWith("modelParam:") && value.trim())
        .map(([key, value]) => ({ id: key.slice("modelParam:".length), value: value.trim() }))
      if (modelParams.length > 0) options.modelParams = modelParams
    }
    await updateRoleBinding(config.env, decodeURIComponent(roleMatch[1]), {
      provider,
      providerAgent: params.get("providerAgent")?.trim() || undefined,
      model: params.get("model")?.trim() || undefined,
      variant: params.get("variant")?.trim() || undefined,
      outputMode: params.get("outputMode")?.trim() || undefined,
      options,
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
