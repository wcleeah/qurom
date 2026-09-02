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
import { deleteMcpServer, listConfigSummary, loadMcpRegistryFromStore, normalizeQuorumConfig, saveMcpServer, setEnabledMcpServers, updatePromptAsset, updatePromptAssets, updateQuorumConfig, updateRoleBinding } from "../config-store"
import { listDefaultsPrompts, updateDefaultsPrompt } from "../defaults-store"
import { openDefaultsPullRequest } from "../github-defaults-pr"
import { promptAssetDefs, promptAssetFiles, type PromptAssetKey } from "../prompt-asset-defs"
import { promptsMatch } from "../prompt-compare"
import { availableProviderIds, configuredAgentRoles, providerConfigForm } from "../providers/registry"
import { getProviderLifecycle } from "../providers/lifecycle"
import { rolesUsingProvider, validateProviderPrerequisites } from "../providers/registry"
import { DEFAULT_PROVIDER } from "../role-registry"
import type { AgentProviderId, ProviderConfigFormDescriptor } from "../providers/types"
import { card, section, summaryRow, summaryTable } from "./html"
import { layout } from "./layout"
import { configNavbarOptions } from "./config-nav"
import { readOpencodeAgentForConfigRoles, renderOpencodeAgentReadonly } from "./opencode-agent-display"
import { promptDiffScript } from "./prompt-diff-script"
import { parseQuorumConfigForm, quorumConfigFormScript, renderQuorumConfigForm } from "./quorum-config-form"
import {
  bindingSelectField,
  bindingTextField,
  configFormSaveResponse,
  modelParamsFromForm,
  renderModelParameterBlocks,
  roleBindingFormScript,
  roleBindingSaveActions,
  savedModelParams,
} from "./role-binding-form"
import { viewServerAdminEnabled } from "./server-options"
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
    const savedParams = savedModelParams(options)
    const model = binding?.model ?? ""
    const warnings = descriptor.warnings?.length
      ? `<div class="outcome-banner failed">${descriptor.warnings.map(escapeHtml).join("<br>")}</div>`
      : ""

    const controls: string[] = []
    if (fields.providerAgent !== false) {
      controls.push(bindingTextField("Provider agent / role label", "providerAgent", binding?.provider_agent ?? "", "OpenCode: agent name. Cursor: optional label only.", role, !active))
    }
    if (fields.model === "select" && descriptor.modelOptions?.length) {
      controls.push(bindingSelectField("Model", "model", model, descriptor.modelOptions, "Loaded from the provider catalog for this account.", !active))
    } else if (fields.model !== false) {
      controls.push(bindingTextField("Model", "model", model, "Provider model id. Cursor requires this for local runs.", "composer-2.5", !active))
    }
    if (fields.variant) {
      controls.push(bindingTextField("Variant", "variant", binding?.variant ?? "", "Provider-specific variant. Mostly used by OpenCode today.", "unset", !active))
    }
    if (fields.outputMode) {
      controls.push(bindingTextField("Output mode", "outputMode", binding?.output_mode ?? "", "Reserved for structured output preference; leave unset unless a provider documents it.", "unset", !active))
    }

    const parameterBlock = renderModelParameterBlocks({
      descriptor,
      savedParams,
      selectedModel: model,
      active,
    })

    return `<div class="provider-fields"${active ? "" : " hidden"} data-provider-fields="${escapeHtml(descriptor.providerId)}">
  <p class="tiny-text muted-text">${escapeHtml(providerHelp(descriptor.providerId))}</p>
  ${warnings}<div class="form-fields-grid">${controls.join("\n")}</div>${parameterBlock}
</div>`
  }

  const descriptors = new Map(await Promise.all(providerIds.map(async (id) => [id, await providerConfigForm(config, id as AgentProviderId)] as const)))
  const opencodeAgentHtmlByRole = new Map(await Promise.all(
    roles.map(async (role) => [role, renderOpencodeAgentReadonly(await readOpencodeAgentForConfigRoles(config.env.OPENCODE_DIRECTORY, role))] as const),
  ))
  const cards = await Promise.all(roles.map(async (role) => {
    const binding = bindingByRole.get(role)
    const currentProvider = binding?.provider ?? DEFAULT_PROVIDER
    const opencodeAgentHtml = opencodeAgentHtmlByRole.get(role) ?? ""
    const providerFormBlocks = providerIds
      .map((id) => providerFields(role, binding, descriptors.get(id)!, id === currentProvider, opencodeAgentHtml))
      .join("\n")
    const opencodeActive = currentProvider === "opencode"
    const form = `<form class="config-form" method="POST" action="/config/roles/${encodeURIComponent(role)}" data-role-binding-form data-autosave="true">
  ${providerTabs(role, currentProvider)}
  ${providerFormBlocks}
  ${roleBindingSaveActions({ hidden: opencodeActive, submitLabel: "Save provider binding" })}
</form>`
    return card(`<div data-role-card><h3>${escapeHtml(role)}</h3>${form}</div>`)
  }))

  const body = [
    `<div class="header-bar"><div class="header-main"><h1>Roles</h1></div></div>`,
    section("Role provider bindings", cards.join("\n")),
  ].join("\n")

  return new Response(layout("Config Roles", body, {
    extraHead: roleBindingFormScript,
    navbar: configNavbarOptions("Roles", "roles"),
  }), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function renderConfigPrompts(options?: { defaultsPrUrl?: string }): Promise<Response> {
  const config = await loadRuntimeConfig()
  const admin = viewServerAdminEnabled()
  const [summary, defaults] = await Promise.all([
    listConfigSummary(config.env),
    listDefaultsPrompts(config.env.QUORUM_WORKSPACE_DIRECTORY),
  ])
  const promptByKey = new Map(summary.prompts.map((prompt) => [prompt.key, prompt]))
  const defaultByKey = new Map(defaults.map((prompt) => [prompt.key, prompt.content]))
  const roles = [...new Set(Object.values(promptAssetDefs).map((def) => def.role))].sort()
  const sections = roles.map((role) => {
    const cards = (Object.entries(promptAssetDefs) as Array<[PromptAssetKey, (typeof promptAssetDefs)[PromptAssetKey]]>)
      .filter(([, def]) => def.role === role)
      .map(([key, def]) => {
        const prompt = promptByKey.get(key)
        const content = prompt?.content ?? ""
        const defaultContent = defaultByKey.get(key) ?? ""
        const version = prompt?.version ?? 0
        const diverted = !promptsMatch(content, defaultContent)
        const status = diverted
          ? `<button type="button" class="status-chip diverted" data-prompt-diff-toggle aria-expanded="false" title="Active prompt differs from shipped default — click to show diff">Modified from default</button>`
          : `<button type="button" class="status-chip matches" data-prompt-diff-toggle aria-expanded="false" title="Active prompt matches shipped default — click to show diff">Matches default</button>`
        const applyDefault = admin
          ? `<button type="submit" class="btn btn-secondary" formaction="/config/prompts/${encodeURIComponent(key)}/apply-default">Apply to default</button>`
          : ""
        return card(`<div data-prompt-card data-prompt-key="${escapeHtml(key)}">
  <h3>${escapeHtml(def.label)} <span class="tiny-text muted-text">${escapeHtml(key)} v${version}</span> ${status}</h3>
  <div class="prompt-diff-panel" data-prompt-diff-panel hidden></div>
  <p class="tiny-text muted-text"><code>${escapeHtml(def.file)}</code></p>
  <textarea name="content:${escapeHtml(key)}" rows="14" data-prompt-active>${escapeHtml(content)}</textarea>
  <textarea hidden data-prompt-default aria-hidden="true">${escapeHtml(defaultContent)}</textarea>
  <div class="form-actions">
    <button type="submit" class="btn btn-primary" formaction="/config/prompts/${encodeURIComponent(key)}">Save prompt</button>
    ${applyDefault}
  </div>
</div>`, "prompt-card")
      })
    return section(role, cards.join("\n"))
  })

  const prBanner = options?.defaultsPrUrl
    ? `<div class="outcome-banner needs-revision">Defaults pull request: <a href="${escapeHtml(options.defaultsPrUrl)}" target="_blank" rel="noopener">${escapeHtml(options.defaultsPrUrl)}</a></div>`
    : ""

  const body = [
    `<div class="header-bar"><div class="header-main"><h1>Prompts</h1><p class="tiny-text muted-text">Each file is the full prompt for that call site. The graph only fills template placeholders. Click the status chip to compare the live textarea with the shipped default.${admin ? " Admin: Apply to default writes the textarea into defaults/prompts and updates the grouped defaults PR." : ""}</p></div></div>`,
    prBanner,
    `<form class="config-form prompts-batch-form" method="POST" action="/config/prompts">
  <div class="prompts-batch-actions form-actions">
    <button type="submit" class="btn btn-primary">Save all</button>
  </div>
  ${sections.join("\n")}
</form>`,
  ].join("\n")

  return new Response(layout("Config Prompts", body, {
    extraHead: promptDiffScript,
    navbar: configNavbarOptions("Prompts", "prompts"),
  }), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

function promptUpdatesFromParams(params: URLSearchParams): Array<{ key: string; content: string }> {
  const updates: Array<{ key: string; content: string }> = []
  for (const [name, value] of params.entries()) {
    if (!name.startsWith("content:")) continue
    const key = name.slice("content:".length)
    if (!(key in promptAssetDefs)) continue
    updates.push({ key, content: value })
  }
  return updates
}

function promptContentFromParams(params: URLSearchParams, key: string): string {
  return params.get(`content:${key}`) ?? params.get("content") ?? ""
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
      const descriptor = await providerConfigForm(config, "cursor")
      const modelParams = modelParamsFromForm(params, descriptor)
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
    return configFormSaveResponse(req, "/config/roles")
  }

  if (path === "/config/prompts") {
    const params = new URLSearchParams(await req.text())
    await updatePromptAssets(config.env, promptUpdatesFromParams(params))
    return new Response(null, { status: 303, headers: { Location: "/config/prompts" } })
  }

  const applyDefaultMatch = path.match(/^\/config\/prompts\/(.+)\/apply-default$/)
  if (applyDefaultMatch) {
    if (!viewServerAdminEnabled()) {
      return new Response("Not found", { status: 404 })
    }
    const params = new URLSearchParams(await req.text())
    const key = decodeURIComponent(applyDefaultMatch[1])
    if (!(key in promptAssetFiles)) {
      throw new Error(`Unknown prompt asset ${JSON.stringify(key)}`)
    }
    const content = promptContentFromParams(params, key)
    const workspaceDir = config.env.QUORUM_WORKSPACE_DIRECTORY
    await updateDefaultsPrompt(workspaceDir, key, content)
    const filename = promptAssetFiles[key as PromptAssetKey]
    const rel = `defaults/prompts/${filename}`
    const result = await openDefaultsPullRequest({
      workspaceDir,
      changedRelativePaths: [rel],
      summary: `apply active prompt ${key} to default`,
    })
    let prUrl: string | undefined
    if (result.status === "created" || result.status === "updated") {
      console.log(`Defaults PR ${result.status}: ${result.prUrl}`)
      prUrl = result.prUrl
    } else if (result.status === "error") {
      console.error(`Defaults PR failed: ${result.message}`)
    } else {
      console.log(`Defaults PR skipped: ${result.reason}`)
    }
    const location = prUrl
      ? `/config/prompts?defaultsPr=${encodeURIComponent(prUrl)}`
      : "/config/prompts"
    return new Response(null, { status: 303, headers: { Location: location } })
  }

  const promptMatch = path.match(/^\/config\/prompts\/(.+)$/)
  if (promptMatch) {
    const params = new URLSearchParams(await req.text())
    const key = decodeURIComponent(promptMatch[1])
    await updatePromptAsset(config.env, key, promptContentFromParams(params, key))
    return new Response(null, { status: 303, headers: { Location: "/config/prompts" } })
  }

  return undefined
}
