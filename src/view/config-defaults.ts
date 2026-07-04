import { loadRuntimeConfig } from "../config"
import {
  applyDefaultsOpencodeAgent,
  listDefaultsOpencodeAgents,
  listDefaultsPrompts,
  listDefaultsRoleBindings,
  listDefaultsRoleInstructions,
  listDefaultsSummary,
  loadDefaultsQuorumConfig,
  readDefaultsQuorumConfig,
  updateDefaultsOpencodeAgent,
  updateDefaultsPrompt,
  updateDefaultsQuorumConfig,
  updateDefaultsRoleBinding,
  updateDefaultsRoleInstruction,
} from "../defaults-store"
import {
  updatePromptAsset,
  updateQuorumConfig,
  updateRoleBinding,
  updateRoleInstruction,
} from "../config-store"
import { availableProviderIds, configuredAgentRoles, providerConfigForm } from "../providers/registry"
import type { AgentProviderId, ProviderConfigFormDescriptor, ProviderConfigFormParameter } from "../providers/types"
import { card, section } from "./html"
import { layout } from "./layout"
import { configBackLink, configNav } from "./config-nav"
import { readDefaultsOpencodeAgent, renderOpencodeAgentReadonly } from "./opencode-agent-display"
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
  return `<form class="config-form inline-form" method="POST" action="${path}"><button type="submit" class="btn btn-secondary">${escapeHtml(label)}</button></form>`
}

export async function renderConfigDefaultsIndex(): Promise<Response> {
  const config = await loadRuntimeConfig()
  const summary = await listDefaultsSummary(config.env.QUORUM_WORKSPACE_DIRECTORY)
  const quorumConfigForm = `<form class="config-form" method="POST" action="/config/defaults/quorum">
  <p class="tiny-text muted-text">Shipped starter config at <code>${escapeHtml(summary.root)}/quorum.config.json</code>. Used when seeding a new SQLite profile and for lazy migration of missing keys.</p>
  <textarea name="content" rows="24">${escapeHtml(summary.quorumConfig)}</textarea>
  <div class="form-actions">
    <button type="submit" class="btn btn-primary">Save defaults quorum config</button>
    ${applyButton("/config/defaults/apply/quorum", "Apply to active profile")}
  </div>
</form>`

  const overviewCards = [
    card(`<h3>Prompts</h3><p class="tiny-text muted-text">${summary.prompts.length} shipped prompt templates.</p><a href="/config/defaults/prompts">Edit defaults prompts →</a>`),
    card(`<h3>Role instructions</h3><p class="tiny-text muted-text">${summary.roles.length} provider-neutral role instruction files.</p><a href="/config/defaults/roles">Edit defaults roles →</a>`),
    card(`<h3>Role provider bindings</h3><p class="tiny-text muted-text">Default provider assignments stored in <code>defaults/quorum-config.sqlite</code>.</p><a href="/config/defaults/bindings">Edit defaults bindings →</a>`),
    card(`<h3>OpenCode agents</h3><p class="tiny-text muted-text">${summary.opencodeAgents.length} shipped OpenCode agent definitions (bootstrap source for <code>.opencode/agents/</code>).</p><a href="/config/defaults/opencode">Edit defaults OpenCode agents →</a>`),
  ].join("\n")

  const body = [
    configBackLink(),
    configNav("defaults"),
    `<div class="header-bar"><div class="header-main"><h1>Default resources</h1><div class="meta-row"><span class="meta-item">Directory: <code>${escapeHtml(summary.root)}</code></span></div></div></div>`,
    section("Overview", overviewCards),
    section("Quorum config", quorumConfigForm),
  ].join("\n")

  return new Response(layout("Default resources", body), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function renderConfigDefaultsPrompts(): Promise<Response> {
  const config = await loadRuntimeConfig()
  const prompts = await listDefaultsPrompts(config.env.QUORUM_WORKSPACE_DIRECTORY)
  const cards = prompts.map((prompt) => {
    const form = `<form class="config-form" method="POST" action="/config/defaults/prompts/${encodeURIComponent(prompt.key)}">
  <p class="tiny-text muted-text"><code>defaults/prompts/${escapeHtml(prompt.filename)}</code></p>
  <textarea name="content" rows="14">${escapeHtml(prompt.content)}</textarea>
  <div class="form-actions">
    <button type="submit" class="btn btn-primary">Save default</button>
    ${applyButton(`/config/defaults/apply/prompts/${encodeURIComponent(prompt.key)}`, "Apply to active")}
  </div>
</form>`
    return card(`<h3>${escapeHtml(prompt.key)}</h3>${form}`)
  })

  const body = [
    configBackLink(),
    configNav("defaults"),
    `<div class="header-bar"><div class="header-main"><h1>Default prompts</h1></div></div>`,
    section("Shipped prompt templates", cards.join("\n")),
  ].join("\n")

  return new Response(layout("Default prompts", body), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function renderConfigDefaultsRoles(): Promise<Response> {
  const config = await loadRuntimeConfig()
  const roles = await listDefaultsRoleInstructions(config.env.QUORUM_WORKSPACE_DIRECTORY)
  const cards = roles.map((role) => {
    const form = `<form class="config-form" method="POST" action="/config/defaults/roles/${encodeURIComponent(role.role)}">
  <p class="tiny-text muted-text"><code>defaults/roles/${escapeHtml(role.role)}.md</code></p>
  <textarea name="content" rows="12">${escapeHtml(role.content)}</textarea>
  <div class="form-actions">
    <button type="submit" class="btn btn-primary">Save default</button>
    ${applyButton(`/config/defaults/apply/roles/${encodeURIComponent(role.role)}`, "Apply to active")}
  </div>
</form>`
    return card(`<h3>${escapeHtml(role.role)}</h3>${form}`)
  })

  const body = [
    configBackLink(),
    configNav("defaults"),
    `<div class="header-bar"><div class="header-main"><h1>Default role instructions</h1></div></div>`,
    section("Shipped role instructions", cards.join("\n")),
  ].join("\n")

  return new Response(layout("Default roles", body), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function renderConfigDefaultsOpencode(): Promise<Response> {
  const config = await loadRuntimeConfig()
  const agents = await listDefaultsOpencodeAgents(config.env.QUORUM_WORKSPACE_DIRECTORY)
  const cards = agents.map((agent) => {
    const form = `<form class="config-form" method="POST" action="/config/defaults/opencode/${encodeURIComponent(agent.role)}">
  <p class="tiny-text muted-text"><code>defaults/opencode/agents/${escapeHtml(agent.role)}.md</code> — bootstrap source only. Runtime copies go to <code>.opencode/agents/</code> on disk.</p>
  <textarea name="content" rows="16">${escapeHtml(agent.content)}</textarea>
  <div class="form-actions"><button type="submit" class="btn btn-primary">Save default</button></div>
</form>`
    return card(`<h3>${escapeHtml(agent.role)}</h3>${form}`)
  })

  const body = [
    configBackLink(),
    configNav("defaults"),
    `<div class="header-bar"><div class="header-main"><h1>Default OpenCode agents</h1></div></div>`,
    section("Shipped OpenCode agent definitions", cards.join("\n") || "<p class=\"muted-text\">No defaults OpenCode agents found.</p>"),
  ].join("\n")

  return new Response(layout("Default OpenCode agents", body), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function renderConfigDefaultsBindings(): Promise<Response> {
  const config = await loadRuntimeConfig()
  const workspaceDir = config.env.QUORUM_WORKSPACE_DIRECTORY
  const defaultsConfig = await loadDefaultsQuorumConfig(workspaceDir)
  const defaultsRuntime = { ...config, quorumConfig: defaultsConfig }
  const bindingByRole = new Map((await listDefaultsRoleBindings(workspaceDir)).map((binding) => [binding.role, binding]))
  const providerIds = availableProviderIds()
  const roles = configuredAgentRoles(defaultsRuntime)
  const descriptors = new Map(await Promise.all(providerIds.map(async (id) => [id, await providerConfigForm(defaultsRuntime, id as AgentProviderId)] as const)))

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

    const help = "Cursor binding defaults. Role instructions come from defaults/roles/<role>.md."

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
    const currentProvider = binding?.provider ?? defaultsConfig.agentRuntime.defaultProvider ?? "opencode"
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
    return card(`<div data-role-card><h3>${escapeHtml(role)}</h3>${form}</div>`)
  })

  const body = [
    configBackLink(),
    configNav("defaults"),
    `<div class="header-bar"><div class="header-main"><h1>Default role bindings</h1></div></div>`,
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

  return new Response(layout("Default role bindings", body, roleFormScript), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function handleConfigDefaultsPost(req: Request, path: string): Promise<Response | undefined> {
  const config = await loadRuntimeConfig()
  const workspaceDir = config.env.QUORUM_WORKSPACE_DIRECTORY

  if (path === "/config/defaults/quorum") {
    const params = new URLSearchParams(await req.text())
    await updateDefaultsQuorumConfig(workspaceDir, params.get("content") ?? "")
    return new Response(null, { status: 303, headers: { Location: "/config/defaults" } })
  }

  if (path === "/config/defaults/apply/quorum") {
    const content = await readDefaultsQuorumConfig(workspaceDir)
    await updateQuorumConfig(config.env, content)
    return new Response(null, { status: 303, headers: { Location: "/config" } })
  }

  const applyPromptMatch = path.match(/^\/config\/defaults\/apply\/prompts\/(.+)$/)
  if (applyPromptMatch) {
    const key = decodeURIComponent(applyPromptMatch[1])
    const prompts = await listDefaultsPrompts(workspaceDir)
    const prompt = prompts.find((entry) => entry.key === key)
    if (!prompt) throw new Error(`Unknown defaults prompt ${JSON.stringify(key)}`)
    await updatePromptAsset(config.env, key, prompt.content)
    return new Response(null, { status: 303, headers: { Location: "/config/prompts" } })
  }

  const applyRoleMatch = path.match(/^\/config\/defaults\/apply\/roles\/(.+)$/)
  if (applyRoleMatch) {
    const role = decodeURIComponent(applyRoleMatch[1])
    const roles = await listDefaultsRoleInstructions(workspaceDir)
    const entry = roles.find((item) => item.role === role)
    if (!entry) throw new Error(`Unknown defaults role ${JSON.stringify(role)}`)
    await updateRoleInstruction(config.env, role, entry.content)
    return new Response(null, { status: 303, headers: { Location: "/config/roles" } })
  }

  const applyBindingMatch = path.match(/^\/config\/defaults\/apply\/bindings\/(.+)$/)
  if (applyBindingMatch) {
    const role = decodeURIComponent(applyBindingMatch[1])
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
    return new Response(null, { status: 303, headers: { Location: "/config/roles" } })
  }

  const promptMatch = path.match(/^\/config\/defaults\/prompts\/(.+)$/)
  if (promptMatch) {
    const params = new URLSearchParams(await req.text())
    await updateDefaultsPrompt(workspaceDir, decodeURIComponent(promptMatch[1]), params.get("content") ?? "")
    return new Response(null, { status: 303, headers: { Location: "/config/defaults/prompts" } })
  }

  const roleMatch = path.match(/^\/config\/defaults\/roles\/(.+)$/)
  if (roleMatch) {
    const params = new URLSearchParams(await req.text())
    await updateDefaultsRoleInstruction(workspaceDir, decodeURIComponent(roleMatch[1]), params.get("content") ?? "")
    return new Response(null, { status: 303, headers: { Location: "/config/defaults/roles" } })
  }

  const bindingMatch = path.match(/^\/config\/defaults\/bindings\/(.+)$/)
  if (bindingMatch) {
    const params = new URLSearchParams(await req.text())
    const provider = params.get("provider")?.trim() || undefined
    const options: Record<string, unknown> = {}
    if (provider === "cursor") {
      const modelParams = [...params.entries()]
        .filter(([key, value]) => key.startsWith("modelParam:") && value.trim())
        .map(([key, value]) => ({ id: key.slice("modelParam:".length), value: value.trim() }))
      if (modelParams.length > 0) options.modelParams = modelParams
    }
    await updateDefaultsRoleBinding(workspaceDir, decodeURIComponent(bindingMatch[1]), {
      provider,
      providerAgent: params.get("providerAgent")?.trim() || undefined,
      model: params.get("model")?.trim() || undefined,
      variant: params.get("variant")?.trim() || undefined,
      options,
    })
    return new Response(null, { status: 303, headers: { Location: "/config/defaults/bindings" } })
  }

  const opencodeMatch = path.match(/^\/config\/defaults\/opencode\/(.+)$/)
  if (opencodeMatch) {
    const params = new URLSearchParams(await req.text())
    await updateDefaultsOpencodeAgent(workspaceDir, decodeURIComponent(opencodeMatch[1]), params.get("content") ?? "")
    return new Response(null, { status: 303, headers: { Location: "/config/defaults/opencode" } })
  }

  return undefined
}
