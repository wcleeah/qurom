import { loadRuntimeConfig, type QuorumConfig } from "../config"
import {
  applyDefaultsOpencodeAgent,
  listDefaultsOpencodeAgents,
  listDefaultsPrompts,
  listDefaultsRoleBindings,
  listDefaultsSummary,
  loadDefaultsQuorumConfig,
  readDefaultsQuorumConfig,
  updateDefaultsOpencodeAgent,
  updateDefaultsPrompt,
  updateDefaultsPrompts,
  updateDefaultsQuorumConfig,
  updateDefaultsRoleBinding,
} from "../defaults-store"
import {
  normalizeQuorumConfig,
  updatePromptAsset,
  updateQuorumConfig,
  updateRoleBinding,
} from "../config-store"
import { getPendingDefaultsPr, openDefaultsPullRequest, type DefaultsPrInfo } from "../github-defaults-pr"
import { promptAssetDefs, promptAssetFiles, type PromptAssetKey } from "../prompt-asset-defs"
import { defaultsConfigDbPath } from "../data-paths"
import { availableProviderIds, configuredAgentRoles, providerConfigForm } from "../providers/registry"
import { DEFAULT_PROVIDER } from "../role-registry"
import type { AgentProviderId, ProviderConfigFormDescriptor, ProviderConfigFormParameter } from "../providers/types"
import { card, section } from "./html"
import { layout } from "./layout"
import { configNavbarOptions } from "./config-nav"
import { readDefaultsOpencodeAgent, renderOpencodeAgentReadonly } from "./opencode-agent-display"
import { parseQuorumConfigForm, quorumConfigFormScript, renderQuorumConfigForm } from "./quorum-config-form"
import { escapeHtml } from "./utils"

function parseOptionsJson(text: string | undefined) {
  if (!text) return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}

function applyButton(path: string, label: string) {
  return `<button type="submit" class="btn btn-secondary" formaction="${escapeHtml(path)}" formmethod="post">${escapeHtml(label)}</button>`
}

export async function renderConfigDefaultsIndex(options?: {
  error?: string
  draftConfig?: QuorumConfig
  defaultsPrUrl?: string
}): Promise<Response> {
  const config = await loadRuntimeConfig()
  const summary = await listDefaultsSummary(config.env.QUORUM_WORKSPACE_DIRECTORY)
  const defaultsConfig = options?.draftConfig ?? await loadDefaultsQuorumConfig(config.env.QUORUM_WORKSPACE_DIRECTORY)
  const pending = await getPendingDefaultsPr()
  const quorumChip = pendingPrChip("defaults/quorum.config.json", pending)
  const quorumConfigForm = renderQuorumConfigForm({
    action: "/config/defaults/quorum",
    config: defaultsConfig,
    submitLabel: "Save defaults quorum config",
    error: options?.error,
    extraActionsHtml: applyButton("/config/defaults/apply/quorum", "Apply to active profile"),
  })

  const overviewCards = [
    card(`<h3>Prompts</h3><p class="tiny-text muted-text">${summary.prompts.length} shipped full call-site prompts.</p><a href="/config/defaults/prompts">Edit defaults prompts →</a>`),
    card(`<h3>Role provider bindings</h3><p class="tiny-text muted-text">Default provider assignments stored in <code>defaults/quorum-config.sqlite</code>.</p><a href="/config/defaults/bindings">Edit defaults bindings →</a>`),
    card(`<h3>OpenCode agents</h3><p class="tiny-text muted-text">${summary.opencodeAgents.length} shipped OpenCode agent frontmatter files (model/permissions; bootstrap source for <code>.opencode/agents/</code>).</p><a href="/config/defaults/opencode">Edit defaults OpenCode agents →</a>`),
  ].join("\n")

  const body = [
    `<div class="header-bar"><div class="header-main"><h1>Default resources</h1><div class="meta-row"><span class="meta-item">Directory: <code>${escapeHtml(summary.root)}</code></span>${quorumChip}</div></div></div>`,
    defaultsPrBanner(pending, options?.defaultsPrUrl),
    section("Overview", overviewCards),
    section("Quorum policy", quorumConfigForm),
  ].join("\n")

  return new Response(layout("Default resources", body, {
    extraHead: quorumConfigFormScript,
    navbar: configNavbarOptions("Default resources", "defaults"),
  }), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

function defaultsPrBanner(pr: DefaultsPrInfo | undefined, flashUrl?: string): string {
  const url = flashUrl || pr?.url
  if (!url) return ""
  const label = pr?.state === "open"
    ? `Pending defaults PR #${pr.number}`
    : "Defaults pull request"
  return `<div class="outcome-banner needs-revision">${escapeHtml(label)}: <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></div>`
}

function pendingPrChip(path: string, pending: DefaultsPrInfo | undefined): string {
  if (!pending || pending.state !== "open") return ""
  if (!pending.paths.includes(path)) return ""
  return `<span class="status-chip pending-pr" title="Included in open defaults PR #${pending.number}"><a href="${escapeHtml(pending.url)}" target="_blank" rel="noopener">PR pending</a></span>`
}

function promptUpdatesFromParams(params: URLSearchParams): Array<{ key: string; content: string }> {
  const updates: Array<{ key: string; content: string }> = []
  for (const [name, value] of params.entries()) {
    if (!name.startsWith("content:")) continue
    const key = name.slice("content:".length)
    if (!(key in promptAssetFiles)) continue
    updates.push({ key, content: value })
  }
  return updates
}

function promptContentFromParams(params: URLSearchParams, key: string): string {
  return params.get(`content:${key}`) ?? params.get("content") ?? ""
}

export async function renderConfigDefaultsPrompts(options?: {
  defaultsPrUrl?: string
}): Promise<Response> {
  const config = await loadRuntimeConfig()
  const workspaceDir = config.env.QUORUM_WORKSPACE_DIRECTORY
  const [prompts, pending] = await Promise.all([
    listDefaultsPrompts(workspaceDir),
    getPendingDefaultsPr(),
  ])
  const promptByKey = new Map(prompts.map((prompt) => [prompt.key, prompt]))
  const roles = [...new Set(Object.values(promptAssetDefs).map((def) => def.role))].sort()
  const sections = roles.map((role) => {
    const cards = (Object.entries(promptAssetDefs) as Array<[PromptAssetKey, (typeof promptAssetDefs)[PromptAssetKey]]>)
      .filter(([, def]) => def.role === role)
      .map(([key, def]) => {
        const prompt = promptByKey.get(key)
        const content = prompt?.content ?? ""
        const rel = `defaults/prompts/${def.file}`
        const chip = pendingPrChip(rel, pending)
        return card(`<h3>${escapeHtml(def.label)} <span class="tiny-text muted-text">${escapeHtml(key)}</span> ${chip}</h3>
  <p class="tiny-text muted-text"><code>defaults/prompts/${escapeHtml(def.file)}</code></p>
  <textarea name="content:${escapeHtml(key)}" rows="14">${escapeHtml(content)}</textarea>
  <div class="form-actions">
    <button type="submit" class="btn btn-primary" formaction="/config/defaults/prompts/${encodeURIComponent(key)}">Save default</button>
    ${applyButton(`/config/defaults/apply/prompts/${encodeURIComponent(key)}`, "Apply to active")}
  </div>`)
      })
    return section(role, cards.join("\n"))
  })

  const body = [
    `<div class="header-bar"><div class="header-main"><h1>Default prompts</h1><p class="tiny-text muted-text">Full call-site prompts. Graph only fills template placeholders.</p></div></div>`,
    defaultsPrBanner(pending, options?.defaultsPrUrl),
    `<form class="config-form prompts-batch-form" method="POST" action="/config/defaults/prompts">
  <div class="prompts-batch-actions form-actions">
    <button type="submit" class="btn btn-primary">Save all</button>
  </div>
  ${sections.join("\n")}
</form>`,
  ].join("\n")

  return new Response(layout("Default prompts", body, {
    navbar: configNavbarOptions("Default prompts", "defaults"),
  }), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function renderConfigDefaultsOpencode(options?: { defaultsPrUrl?: string }): Promise<Response> {
  const config = await loadRuntimeConfig()
  const agents = await listDefaultsOpencodeAgents(config.env.QUORUM_WORKSPACE_DIRECTORY)
  const pending = await getPendingDefaultsPr()
  const cards = agents.map((agent) => {
    const rel = `defaults/opencode/agents/${agent.role}.md`
    const chip = pendingPrChip(rel, pending)
    const form = `<form class="config-form" method="POST" action="/config/defaults/opencode/${encodeURIComponent(agent.role)}">
  <p class="tiny-text muted-text"><code>defaults/opencode/agents/${escapeHtml(agent.role)}.md</code> — frontmatter only (model/permissions). Behavioral prompts live under defaults/prompts/. Runtime copies go to <code>.opencode/agents/</code> on disk.</p>
  <textarea name="content" rows="16">${escapeHtml(agent.content)}</textarea>
  <div class="form-actions"><button type="submit" class="btn btn-primary">Save default</button></div>
</form>`
    return card(`<h3>${escapeHtml(agent.role)} ${chip}</h3>${form}`)
  })

  const body = [
    `<div class="header-bar"><div class="header-main"><h1>Default OpenCode agents</h1></div></div>`,
    defaultsPrBanner(pending, options?.defaultsPrUrl),
    section("Shipped OpenCode agent definitions", cards.join("\n") || "<p class=\"muted-text\">No defaults OpenCode agents found.</p>"),
  ].join("\n")

  return new Response(layout("Default OpenCode agents", body, {
    navbar: configNavbarOptions("Default OpenCode agents", "defaults"),
  }), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function renderConfigDefaultsBindings(options?: { defaultsPrUrl?: string }): Promise<Response> {
  const config = await loadRuntimeConfig()
  const workspaceDir = config.env.QUORUM_WORKSPACE_DIRECTORY
  const defaultsConfig = await loadDefaultsQuorumConfig(workspaceDir)
  const defaultsRuntime = { ...config, quorumConfig: defaultsConfig }
  const bindingByRole = new Map((await listDefaultsRoleBindings(workspaceDir)).map((binding) => [binding.role, binding]))
  const providerIds = availableProviderIds()
  const roles = configuredAgentRoles(defaultsRuntime)
  const descriptors = new Map(await Promise.all(providerIds.map(async (id) => [id, await providerConfigForm(defaultsRuntime, id as AgentProviderId)] as const)))
  const pending = await getPendingDefaultsPr()
  const bindingsChip = pendingPrChip(relativeDefaultsDb(workspaceDir), pending)

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

  const providerFields = (
    role: string,
    binding: {
      provider?: string
      providerAgent?: string
      model?: string
      variant?: string
      options?: Record<string, unknown>
    } | undefined,
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
    const options = binding?.options ?? {}
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
      controls.push(field("Provider agent / role label", "providerAgent", binding?.providerAgent ?? "", "OpenCode: agent name. Cursor: optional label only.", role, !active))
    }
    if (fields.model === "select" && descriptor.modelOptions?.length) {
      controls.push(selectField("Model", "model", model, descriptor.modelOptions, "Loaded from the provider catalog for this account.", !active))
    } else if (fields.model !== false) {
      controls.push(field("Model", "model", model, "Provider model id. Cursor requires this for local runs.", "composer-2.5", !active))
    }
    if (fields.variant) {
      controls.push(field("Variant", "variant", binding?.variant ?? "", "Provider-specific variant. Mostly used by OpenCode today.", "unset", !active))
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
      : ""

    const help = "Cursor binding defaults. Behavioral prompts are edited under Defaults → Prompts."

    return `<div class="provider-fields"${active ? "" : " hidden"} data-provider-fields="${escapeHtml(descriptor.providerId)}">
  <p class="tiny-text muted-text">${escapeHtml(help)}</p>
  ${warnings}<div class="form-fields-grid">${controls.join("\n")}</div>${parameterBlock}
</div>`
  }

  const opencodeAgentHtmlByRole = new Map(await Promise.all(
    roles.map(async (role) => [role, renderOpencodeAgentReadonly(await readDefaultsOpencodeAgent(workspaceDir, role))] as const),
  ))
  const cards = roles.map((role) => {
    const row = bindingByRole.get(role)
    const binding = row
      ? {
          provider: row.provider ?? undefined,
          providerAgent: row.provider_agent ?? undefined,
          model: row.model ?? undefined,
          variant: row.variant ?? undefined,
          options: parseOptionsJson(row.options_json),
        }
      : undefined
    const currentProvider = binding?.provider ?? DEFAULT_PROVIDER
    const opencodeActive = currentProvider === "opencode"
    const opencodeAgentHtml = opencodeAgentHtmlByRole.get(role) ?? ""
    const providerFormBlocks = providerIds
      .map((id) => providerFields(role, binding, descriptors.get(id)!, id === currentProvider, opencodeAgentHtml))
      .join("\n")
    const form = `<form class="config-form" method="POST" action="/config/defaults/bindings/${encodeURIComponent(role)}">
  <p class="tiny-text muted-text">Binding stored in <code>defaults/quorum-config.sqlite</code>${opencodeActive ? "; agent definition below from <code>defaults/opencode/agents/</code>" : ""}.</p>
  ${providerTabs(role, currentProvider)}
  ${providerFormBlocks}
  <div class="form-actions" data-save-actions${opencodeActive ? " hidden" : ""}><button type="submit" class="btn btn-primary">Save default binding</button></div>
  <div class="form-actions">${applyButton(`/config/defaults/apply/bindings/${encodeURIComponent(role)}`, "Apply to active")}</div>
</form>`
    return card(`<div data-role-card><h3>${escapeHtml(role)} ${bindingsChip}</h3>${form}</div>`)
  })

  const body = [
    `<div class="header-bar"><div class="header-main"><h1>Default role bindings</h1></div></div>`,
    defaultsPrBanner(pending, options?.defaultsPrUrl),
    section("Shipped provider bindings", cards.join("\n")),
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
      var saveActions = form.querySelector("[data-save-actions]");
      if (saveActions) saveActions.hidden = provider === "opencode";
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

  return new Response(layout("Default role bindings", body, {
    extraHead: roleFormScript,
    navbar: configNavbarOptions("Default role bindings", "defaults"),
  }), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

async function maybeOpenDefaultsPr(
  workspaceDir: string,
  changedRelativePaths: string[],
  summary: string,
): Promise<string | undefined> {
  const result = await openDefaultsPullRequest({ workspaceDir, changedRelativePaths, summary })
  if (result.status === "created" || result.status === "updated") {
    console.log(`Defaults PR ${result.status}: ${result.prUrl}`)
    return result.prUrl
  }
  if (result.status === "error") {
    console.error(`Defaults PR failed: ${result.message}`)
  } else {
    console.log(`Defaults PR skipped: ${result.reason}`)
  }
  return undefined
}

function redirect(location: string, prUrl?: string): Response {
  const url = prUrl
    ? `${location}${location.includes("?") ? "&" : "?"}defaultsPr=${encodeURIComponent(prUrl)}`
    : location
  return new Response(null, { status: 303, headers: { Location: url } })
}

export async function handleConfigDefaultsPost(req: Request, path: string): Promise<Response | undefined> {
  const config = await loadRuntimeConfig()
  const workspaceDir = config.env.QUORUM_WORKSPACE_DIRECTORY

  if (path === "/config/defaults/quorum") {
    const params = new URLSearchParams(await req.text())
    try {
      const parsed = normalizeQuorumConfig(parseQuorumConfigForm(params))
      await updateDefaultsQuorumConfig(workspaceDir, JSON.stringify(parsed, null, 2))
      const prUrl = await maybeOpenDefaultsPr(workspaceDir, ["defaults/quorum.config.json"], "update quorum.config.json")
      return redirect("/config/defaults", prUrl)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      let draftConfig
      try {
        draftConfig = parseQuorumConfigForm(params)
      } catch {
        draftConfig = await loadDefaultsQuorumConfig(workspaceDir)
      }
      return renderConfigDefaultsIndex({ error: message, draftConfig })
    }
  }

  if (path === "/config/defaults/apply/quorum") {
    const content = await readDefaultsQuorumConfig(workspaceDir)
    await updateQuorumConfig(config.env, content)
    return renderConfigDefaultsIndex()
  }

  const applyPromptMatch = path.match(/^\/config\/defaults\/apply\/prompts\/(.+)$/)
  if (applyPromptMatch) {
    const key = decodeURIComponent(applyPromptMatch[1])
    const params = new URLSearchParams(await req.text())
    let content = promptContentFromParams(params, key)
    if (!content.trim()) {
      const prompts = await listDefaultsPrompts(workspaceDir)
      const prompt = prompts.find((entry) => entry.key === key)
      if (!prompt) throw new Error(`Unknown defaults prompt ${JSON.stringify(key)}`)
      content = prompt.content
    }
    await updatePromptAsset(config.env, key, content)
    return renderConfigDefaultsPrompts()
  }

  const applyBindingMatch = path.match(/^\/config\/defaults\/apply\/bindings\/(.+)$/)
  if (applyBindingMatch) {
    const role = decodeURIComponent(applyBindingMatch[1])
    const raw = await req.text()
    if (raw.trim()) {
      const params = new URLSearchParams(raw)
      const provider = params.get("provider")?.trim() || undefined
      const options: Record<string, unknown> = {}
      if (provider === "cursor") {
        const modelParams = [...params.entries()]
          .filter(([key, value]) => key.startsWith("modelParam:") && value.trim())
          .map(([key, value]) => ({ id: key.slice("modelParam:".length), value: value.trim() }))
        if (modelParams.length > 0) options.modelParams = modelParams
      }
      await updateRoleBinding(config.env, role, {
        provider,
        providerAgent: params.get("providerAgent")?.trim() || undefined,
        model: params.get("model")?.trim() || undefined,
        variant: params.get("variant")?.trim() || undefined,
        outputMode: params.get("outputMode")?.trim() || undefined,
        options,
      })
      if ((provider ?? "opencode") === "opencode") {
        await applyDefaultsOpencodeAgent(workspaceDir, role)
      }
    } else {
      const binding = (await listDefaultsRoleBindings(workspaceDir)).find((entry) => entry.role === role)
      if (!binding) throw new Error(`Unknown defaults binding ${JSON.stringify(role)}`)
      await updateRoleBinding(config.env, role, {
        provider: binding.provider ?? undefined,
        providerAgent: binding.provider_agent ?? undefined,
        model: binding.model ?? undefined,
        variant: binding.variant ?? undefined,
        outputMode: binding.output_mode ?? undefined,
        options: parseOptionsJson(binding.options_json),
      })
      if ((binding.provider ?? "opencode") === "opencode") {
        await applyDefaultsOpencodeAgent(workspaceDir, role)
      }
    }
    return renderConfigDefaultsBindings()
  }

  if (path === "/config/defaults/prompts") {
    const params = new URLSearchParams(await req.text())
    const updates = promptUpdatesFromParams(params)
    const paths = await updateDefaultsPrompts(workspaceDir, updates)
    const prUrl = paths.length > 0
      ? await maybeOpenDefaultsPr(workspaceDir, paths, `update ${paths.length} prompt(s)`)
      : undefined
    return redirect("/config/defaults/prompts", prUrl)
  }

  const promptMatch = path.match(/^\/config\/defaults\/prompts\/(.+)$/)
  if (promptMatch) {
    const params = new URLSearchParams(await req.text())
    const key = decodeURIComponent(promptMatch[1])
    await updateDefaultsPrompt(workspaceDir, key, promptContentFromParams(params, key))
    const filename = promptAssetFiles[key as PromptAssetKey]
    const rel = filename ? `defaults/prompts/${filename}` : undefined
    const prUrl = rel
      ? await maybeOpenDefaultsPr(workspaceDir, [rel], `update prompt ${key}`)
      : undefined
    return redirect("/config/defaults/prompts", prUrl)
  }

  const bindingMatch = path.match(/^\/config\/defaults\/bindings\/(.+)$/)
  if (bindingMatch) {
    const params = new URLSearchParams(await req.text())
    const role = decodeURIComponent(bindingMatch[1])
    const provider = params.get("provider")?.trim() || undefined
    const options: Record<string, unknown> = {}
    if (provider === "cursor") {
      const modelParams = [...params.entries()]
        .filter(([key, value]) => key.startsWith("modelParam:") && value.trim())
        .map(([key, value]) => ({ id: key.slice("modelParam:".length), value: value.trim() }))
      if (modelParams.length > 0) options.modelParams = modelParams
    }
    await updateDefaultsRoleBinding(workspaceDir, role, {
      provider,
      providerAgent: params.get("providerAgent")?.trim() || undefined,
      model: params.get("model")?.trim() || undefined,
      variant: params.get("variant")?.trim() || undefined,
      options,
    })
    const dbRel = relativeDefaultsDb(workspaceDir)
    const prUrl = await maybeOpenDefaultsPr(workspaceDir, [dbRel], `update defaults binding ${role}`)
    return redirect("/config/defaults/bindings", prUrl)
  }

  const opencodeMatch = path.match(/^\/config\/defaults\/opencode\/(.+)$/)
  if (opencodeMatch) {
    const params = new URLSearchParams(await req.text())
    const role = decodeURIComponent(opencodeMatch[1])
    await updateDefaultsOpencodeAgent(workspaceDir, role, params.get("content") ?? "")
    const prUrl = await maybeOpenDefaultsPr(
      workspaceDir,
      [`defaults/opencode/agents/${role}.md`],
      `update OpenCode agent ${role}`,
    )
    return redirect("/config/defaults/opencode", prUrl)
  }

  return undefined
}

function relativeDefaultsDb(workspaceDir: string): string {
  const abs = defaultsConfigDbPath(workspaceDir)
  const prefix = workspaceDir.replace(/\/$/, "") + "/"
  if (abs.startsWith(prefix)) return abs.slice(prefix.length)
  return "defaults/quorum-config.sqlite"
}
