import type { QuorumConfig } from "../config"
import { escapeHtml } from "./utils"

type QuorumConfigFormOptions = {
  action: string
  config: QuorumConfig
  submitLabel: string
  researchToolIds?: string[]
  error?: string | null
  extraActionsHtml?: string
}

function field(label: string, name: string, value: string | number, type: "number" | "text" = "text", help = "") {
  return `<label class="form-field"><span>${escapeHtml(label)}</span><input class="form-input" type="${type}" name="${escapeHtml(name)}" value="${escapeHtml(String(value))}">${help ? `<small>${escapeHtml(help)}</small>` : ""}</label>`
}

function checkbox(name: string, label: string, checked: boolean, help = "") {
  return `<label class="form-checkbox"><input type="checkbox" name="${escapeHtml(name)}" value="1"${checked ? " checked" : ""}><span>${escapeHtml(label)}</span>${help ? `<small>${escapeHtml(help)}</small>` : ""}</label>`
}

function researchToolsSection(config: QuorumConfig, configuredIds: string[] = []) {
  const prefer = new Set(config.researchTools.prefer)
  const ids = [...new Set([
    ...configuredIds,
    ...config.researchTools.prefer,
    config.researchTools.webSearchProvider,
  ])].filter(Boolean)
  const checkboxes = ids.map((id) => {
    const checked = prefer.has(id) ? " checked" : ""
    return `<label class="form-checkbox"><input type="checkbox" name="researchTools.prefer" value="${escapeHtml(id)}"${checked}><span>${escapeHtml(id)}</span></label>`
  }).join("\n")
  const providerOptions = ids.map((id) => {
    const selected = config.researchTools.webSearchProvider === id ? " selected" : ""
    return `<option value="${escapeHtml(id)}"${selected}>${escapeHtml(id)}</option>`
  }).join("")
  return `<div class="form-section">
  <h3>Research tools</h3>
  <div class="form-field"><span>Preferred tools</span><div class="checkbox-group">${checkboxes}</div></div>
  <label class="form-field"><span>Web search provider</span><select class="form-input" name="researchTools.webSearchProvider">${providerOptions}</select></label>
</div>`
}

export function renderQuorumConfigForm(options: QuorumConfigFormOptions): string {
  const config = options.config
  const errorBanner = options.error
    ? `<div class="outcome-banner failed">Validation failed: ${escapeHtml(options.error)}</div>`
    : ""
  const designEnabled = config.designQuorum?.enabled ?? false
  const readerEnabled = config.readerDiscovery?.enabled ?? true
  const taggingEnabled = config.tagging?.enabled ?? true
  const predefinedTags = (config.tagging?.predefinedTags ?? []).join(", ")

  return `${errorBanner}<form class="config-form" method="POST" action="${escapeHtml(options.action)}">
  <p class="tiny-text muted-text">Run policy settings. Agent roles and providers are configured on the <a href="/config/roles">Roles</a> tab.</p>
  <div class="form-section">
    <h3>Run limits</h3>
    ${field("Max rounds", "maxRounds", config.maxRounds, "number")}
    ${field("Max rebuttal turns per finding", "maxRebuttalTurnsPerFinding", config.maxRebuttalTurnsPerFinding, "number")}
    ${field("Max concurrent runs", "maxConcurrentRuns", config.maxConcurrentRuns ?? 1, "number", "Cursor cloud only. OpenCode and local Cursor stay at 1.")}
    ${field("Recursion limit", "recursionLimit", config.recursionLimit, "number")}
    ${field("Audit restart limit", "auditRestart.maxRestarts", config.auditRestart?.maxRestarts ?? 1, "number")}
    ${checkbox("requireUnanimousApproval", "Require unanimous approval", config.requireUnanimousApproval)}
  </div>
  <div class="form-section">
    <h3>Design quorum</h3>
    ${checkbox("designQuorum.enabled", "Enable design quorum", designEnabled)}
  </div>
  <div class="form-section" data-reader-discovery>
    <h3>Reader discovery</h3>
    ${checkbox("readerDiscovery.enabled", "Enable reader discovery", readerEnabled)}
    <div data-reader-discovery-fields${readerEnabled ? "" : " hidden"}>
      ${field("Max turns", "readerDiscovery.maxTurns", config.readerDiscovery?.maxTurns ?? 6, "number")}
    </div>
  </div>
  <div class="form-section" data-tagging-config>
    <h3>Tagging</h3>
    ${checkbox("tagging.enabled", "Enable article tagging", taggingEnabled)}
    <div data-tagging-fields${taggingEnabled ? "" : " hidden"}>
      ${field("Max article tags", "tagging.maxArticleTags", config.tagging?.maxArticleTags ?? 8, "number")}
      ${field("Max note tags", "tagging.maxNoteTags", config.tagging?.maxNoteTags ?? 8, "number")}
      ${field("Predefined tag slugs", "tagging.predefinedTags", predefinedTags, "text", "Comma-separated lowercase slugs, e.g. machine-learning, systems")}
    </div>
  </div>
  ${researchToolsSection(config, options.researchToolIds)}
  <div class="form-actions">
    <button type="submit" class="btn btn-primary">${escapeHtml(options.submitLabel)}</button>
    ${options.extraActionsHtml ?? ""}
  </div>
</form>`
}

function parseBoolean(params: URLSearchParams, name: string) {
  return params.get(name) === "1"
}

function parsePositiveInt(params: URLSearchParams, name: string, fallback: number) {
  const raw = params.get(name)?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function parseNonNegativeInt(params: URLSearchParams, name: string, fallback: number) {
  const raw = params.get(name)?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`)
  return value
}

export function parseQuorumConfigForm(params: URLSearchParams): QuorumConfig {
  const prefer = params.getAll("researchTools.prefer").map((value) => value.trim()).filter(Boolean)
  if (prefer.length === 0) throw new Error("Select at least one research tool")

  const webSearchProvider = params.get("researchTools.webSearchProvider")?.trim()
  if (!webSearchProvider) throw new Error("Web search provider is required")

  const designEnabled = parseBoolean(params, "designQuorum.enabled")

  return {
    maxRounds: parsePositiveInt(params, "maxRounds", 1),
    maxRebuttalTurnsPerFinding: parsePositiveInt(params, "maxRebuttalTurnsPerFinding", 1),
    maxConcurrentRuns: (() => {
      const value = parsePositiveInt(params, "maxConcurrentRuns", 1)
      if (value > 8) throw new Error("maxConcurrentRuns must be between 1 and 8")
      return value
    })(),
    recursionLimit: parsePositiveInt(params, "recursionLimit", 80),
    requireUnanimousApproval: parseBoolean(params, "requireUnanimousApproval"),
    researchTools: {
      prefer,
      webSearchProvider,
    },
    designQuorum: designEnabled ? { enabled: true } : undefined,
    auditRestart: {
      maxRestarts: parseNonNegativeInt(params, "auditRestart.maxRestarts", 1),
    },
    readerDiscovery: {
      enabled: parseBoolean(params, "readerDiscovery.enabled"),
      maxTurns: parsePositiveInt(params, "readerDiscovery.maxTurns", 6),
    },
    tagging: {
      enabled: parseBoolean(params, "tagging.enabled"),
      maxArticleTags: parsePositiveInt(params, "tagging.maxArticleTags", 8),
      maxNoteTags: parsePositiveInt(params, "tagging.maxNoteTags", 8),
      predefinedTags: (params.get("tagging.predefinedTags") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((slug) => {
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
            throw new Error(`Invalid predefined tag slug: ${slug}`)
          }
          return slug
        }),
    },
  }
}

export const quorumConfigFormScript = `<script>
(function(){
  function init(){
    document.querySelectorAll("[data-reader-discovery]").forEach(function(section){
      var enabled = section.querySelector("input[name='readerDiscovery.enabled']");
      var fields = section.querySelector("[data-reader-discovery-fields]");
      if (!enabled || !fields) return;
      function sync(){
        fields.hidden = !enabled.checked;
        fields.querySelectorAll("input,select,textarea").forEach(function(input){
          input.disabled = fields.hidden;
        });
      }
      enabled.addEventListener("change", sync);
      sync();
    });
    document.querySelectorAll("[data-tagging-config]").forEach(function(section){
      var enabled = section.querySelector("input[name='tagging.enabled']");
      var fields = section.querySelector("[data-tagging-fields]");
      if (!enabled || !fields) return;
      function sync(){
        fields.hidden = !enabled.checked;
        fields.querySelectorAll("input,select,textarea").forEach(function(input){
          input.disabled = fields.hidden;
        });
      }
      enabled.addEventListener("change", sync);
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
