import { loadRuntimeConfig } from "../config"
import { listConfigSummary, updatePromptAsset, updateQuorumConfig, updateRoleBinding, updateRoleInstruction } from "../config-store"
import { availableProviderIds, configuredAgentRoles, providerConfigForm, validateProviderPrerequisites } from "../providers/registry"
import type { AgentProviderId, ProviderConfigFormDescriptor, ProviderConfigFormParameter } from "../providers/types"
import { card, section, summaryRow, summaryTable } from "./html"
import { layout } from "./layout"
import { configBackLink, configNav } from "./config-nav"
import { readActiveOpencodeAgent, renderOpencodeAgentReadonly } from "./opencode-agent-display"
import { escapeHtml } from "./utils"

function parseOptionsJson(text: string | undefined) {
  if (!text) return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function renderConfigIndex(): Promise<Response> {
  const config = await loadRuntimeConfig()
  const summary = await listConfigSummary(config.env)
  const validationError = await validateProviderPrerequisites(config)
    .then(() => null)
    .catch((error) => (error instanceof Error ? error.message : String(error)))
  const isValid = validationError === null

  const statusCard = `<div class="structured-card">
  <div class="outcome-banner ${isValid ? "approved" : "failed"}">${isValid ? "Providers valid" : "Validation failed"}</div>
  ${summaryTable([
    summaryRow("Profile", escapeHtml(summary.profile.name)),
    summaryRow("Validation", isValid ? "valid" : escapeHtml(validationError ?? "invalid")),
    summaryRow("Roles", String(summary.bindings.length)),
    summaryRow("Prompt assets", String(summary.prompts.length)),
    summaryRow("Data directory", escapeHtml(config.env.QUORUM_DATA_DIR)),
    summaryRow("Config database", escapeHtml(config.env.QUORUM_CONFIG_DB_PATH)),
    summaryRow("Checkpoints database", escapeHtml(config.env.QUORUM_CHECKPOINT_PATH)),
    summaryRow("Runs directory", escapeHtml(config.env.QUORUM_RUNS_DIR)),
    summaryRow("Default provider", escapeHtml(summary.config?.agentRuntime.defaultProvider ?? "unknown")),
  ])}
</div>`
  const quorumConfigJson = JSON.stringify(summary.config ?? config.quorumConfig, null, 2)
  const quorumConfigForm = `<form class="config-form" method="POST" action="/config/quorum">
  <p class="tiny-text muted-text">Edits the active config profile in <code>${escapeHtml(config.env.QUORUM_CONFIG_DB_PATH)}</code>. Shipped defaults live under <code>defaults/quorum.config.json</code>.</p>
  <textarea name="content" rows="24">${escapeHtml(quorumConfigJson)}</textarea>
  <div class="form-actions"><button type="submit" class="btn btn-primary">Save quorum config</button></div>
</form>`

  const body = [
    configBackLink(),
    configNav("overview"),
    `<div class="header-bar"><div class="header-main"><h1>Configuration</h1><div class="meta-row"><span class="meta-item">Active profile: <strong>${escapeHtml(summary.profile.name)}</strong></span></div></div></div>`,
    section("Status", statusCard),
    `<form class="config-form" method="POST" action="/config/validate"><div class="form-actions"><button type="submit" class="btn btn-primary">Validate providers</button></div></form>`,
    section("Quorum config", quorumConfigForm),
  ].join("\n")

  return new Response(layout("Configuration", body), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function renderConfigRoles(): Promise<Response> {
  const config = await loadRuntimeConfig()
  const summary = await listConfigSummary(config.env)
  const roleInstructionsByName = new Map(summary.roleInstructions.map((role) => [role.role, role.content]))
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
      return "Cursor runs this role through the Cursor Agent SDK. Role instructions below are stored in SQLite."
    }
    if (provider === "opencode") {
      return "OpenCode runs this role through the named provider agent. Edit .opencode/agents/<role>.md on disk for OpenCode behavior and permissions."
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
    const currentProvider = binding?.provider ?? summary.config?.agentRuntime.defaultProvider ?? "opencode"
    const opencodeAgentHtml = opencodeAgentHtmlByRole.get(role) ?? ""
    const providerFormBlocks = providerIds
      .map((id) => providerFields(role, binding, descriptors.get(id)!, id === currentProvider, opencodeAgentHtml))
      .join("\n")
    const opencodeActive = currentProvider === "opencode"
    const instructionContent = roleInstructionsByName.get(role) ?? ""
    const roleInstructions = `<details data-role-instructions${opencodeActive ? " hidden" : ""}>
  <summary>Role instructions</summary>
  <form class="config-form" method="POST" action="/config/role-instructions/${encodeURIComponent(role)}">
    <textarea name="content" rows="12">${escapeHtml(instructionContent)}</textarea>
    <div class="form-actions"><button type="submit" class="btn btn-primary">Save role instructions</button></div>
  </form>
</details>`
    const form = `<form class="config-form" method="POST" action="/config/roles/${encodeURIComponent(role)}">
  ${providerTabs(role, currentProvider)}
  ${providerFormBlocks}
  <div class="form-actions" data-save-actions${opencodeActive ? " hidden" : ""}><button type="submit" class="btn btn-primary">Save provider binding</button></div>
</form>
${roleInstructions}`
    return card(`<div data-role-card><h3>${escapeHtml(role)}</h3>${form}</div>`)
  }))

  const body = [
    configBackLink(),
    configNav("roles"),
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
      var card = form.closest("[data-role-card]");
      var isOpencode = provider === "opencode";
      var saveActions = form.querySelector("[data-save-actions]");
      if (saveActions) saveActions.hidden = isOpencode;
      if (card) {
        card.querySelectorAll("[data-role-instructions]").forEach(function(block){
          block.hidden = isOpencode;
        });
      }
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
  return new Response(layout("Config Roles", body, roleFormScript), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function renderConfigPrompts(): Promise<Response> {
  const config = await loadRuntimeConfig()
  const summary = await listConfigSummary(config.env)
  const cards = summary.prompts.map((prompt) => {
    const form = `<form class="config-form" method="POST" action="/config/prompts/${encodeURIComponent(prompt.key)}">
  <textarea name="content" rows="14">${escapeHtml(prompt.content)}</textarea>
  <div class="form-actions"><button type="submit" class="btn btn-primary">Save prompt</button></div>
</form>`
    return card(`<h3>${escapeHtml(prompt.key)} <span class="tiny-text muted-text">v${prompt.version}</span></h3>${form}`)
  })

  const body = [
    configBackLink(),
    configNav("prompts"),
    `<div class="header-bar"><div class="header-main"><h1>Prompts</h1></div></div>`,
    section("Prompt assets", cards.join("\n")),
  ].join("\n")

  return new Response(layout("Config Prompts", body), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function handleConfigPost(req: Request, path: string): Promise<Response | undefined> {
  const config = await loadRuntimeConfig()
  if (path === "/config/validate") {
    await validateProviderPrerequisites(config)
    return new Response(null, { status: 303, headers: { Location: "/config" } })
  }

  if (path === "/config/quorum") {
    const params = new URLSearchParams(await req.text())
    await updateQuorumConfig(config.env, params.get("content") ?? "")
    return new Response(null, { status: 303, headers: { Location: "/config" } })
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

  const roleInstructionMatch = path.match(/^\/config\/role-instructions\/(.+)$/)
  if (roleInstructionMatch) {
    const params = new URLSearchParams(await req.text())
    await updateRoleInstruction(config.env, decodeURIComponent(roleInstructionMatch[1]), params.get("content") ?? "")
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
