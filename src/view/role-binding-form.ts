import type { ProviderConfigFormDescriptor } from "../providers/types"
import { escapeHtml } from "./utils"

export function bindingTextField(
  label: string,
  name: string,
  value: string,
  help: string,
  placeholder = "unset",
  disabled = false,
) {
  return `<label class="form-field"><span>${escapeHtml(label)}</span><input class="form-input" name="${escapeHtml(name)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"${disabled ? " disabled" : ""}><small>${escapeHtml(help)}</small></label>`
}

export function bindingSelectField(
  label: string,
  name: string,
  value: string,
  options: Array<{ id: string; label: string }>,
  help: string,
  disabled = false,
) {
  const optionHtml = [
    value && !options.some((option) => option.id === value)
      ? `<option value="${escapeHtml(value)}" selected>${escapeHtml(value)} (saved)</option>`
      : "",
    ...options.map((option) => `<option value="${escapeHtml(option.id)}"${option.id === value ? " selected" : ""}>${escapeHtml(option.label)}</option>`),
  ].join("")
  return `<label class="form-field"><span>${escapeHtml(label)}</span><select class="form-input" name="${escapeHtml(name)}"${disabled ? " disabled" : ""}>${optionHtml}</select><small>${escapeHtml(help)}</small></label>`
}

export function savedModelParams(options: Record<string, unknown>): Map<string, string> {
  return new Map(
    (Array.isArray(options.modelParams) ? options.modelParams : [])
      .filter((entry): entry is { id: string; value: string } =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as { id?: unknown }).id === "string" &&
        typeof (entry as { value?: unknown }).value === "string")
      .map((param) => [param.id, param.value]),
  )
}

export function modelParamsFromForm(
  params: URLSearchParams,
  descriptor?: ProviderConfigFormDescriptor,
): Array<{ id: string; value: string }> {
  const submitted = [...params.entries()]
    .filter(([key, value]) => key.startsWith("modelParam:") && value.trim())
    .map(([key, value]) => ({ id: key.slice("modelParam:".length), value: value.trim() }))
  const model = params.get("model")?.trim() ?? ""
  const allowed = new Set((descriptor?.parametersByModel?.[model] ?? []).map((parameter) => parameter.id))
  if (allowed.size === 0) return submitted
  return submitted.filter((entry) => allowed.has(entry.id))
}

export function renderModelParameterBlocks(input: {
  descriptor: ProviderConfigFormDescriptor
  savedParams: Map<string, string>
  selectedModel: string
  active: boolean
}): string {
  const byModel = input.descriptor.parametersByModel ?? {}
  const modelIds = [...new Set([
    ...(input.descriptor.modelOptions?.map((option) => option.id) ?? []),
    ...Object.keys(byModel),
  ])]
  const sets = modelIds.flatMap((modelId) => {
    const parameters = byModel[modelId] ?? []
    if (parameters.length === 0) return []
    const selected = modelId === input.selectedModel
    const enabled = input.active && selected
    const controls = parameters.map((parameter) => {
      const saved = input.savedParams.get(parameter.id) ?? parameter.values[0]?.value ?? ""
      if (parameter.values.length === 0) {
        return bindingTextField(
          parameter.label,
          `modelParam:${parameter.id}`,
          saved,
          `Cursor model parameter ${parameter.id}.`,
          "unset",
          !enabled,
        )
      }
      return bindingSelectField(
        parameter.label,
        `modelParam:${parameter.id}`,
        saved,
        parameter.values.map((value) => ({ id: value.value, label: value.label })),
        `Cursor model parameter ${parameter.id}.`,
        !enabled,
      )
    })
    return [`<div data-model-param-set="${escapeHtml(modelId)}"${selected ? "" : " hidden"}><div class="form-fields-grid">${controls.join("\n")}</div></div>`]
  })
  const selectedHasParams = (byModel[input.selectedModel] ?? []).length > 0
  const empty = input.descriptor.providerId === "cursor"
    ? `<p class="tiny-text muted-text" data-model-param-empty${selectedHasParams ? " hidden" : ""}>No parameter controls are exposed for the selected Cursor model.</p>`
    : ""
  if (sets.length === 0 && !empty) return ""
  return `<div data-model-params>${sets.join("\n")}${empty}</div>`
}

export function roleBindingSaveActions(input: {
  hidden: boolean
  submitLabel: string
}): string {
  return `<div class="form-actions" data-save-actions${input.hidden ? " hidden" : ""}>
  <button type="submit" class="btn btn-primary" data-save-submit>${escapeHtml(input.submitLabel)}</button>
  <span class="tiny-text role-binding-save-status" data-save-status hidden>Saved</span>
</div>`
}

export function configFormSaveResponse(req: Request, location: string): Response {
  const accept = req.headers.get("accept") ?? ""
  if (accept.includes("application/json")) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    })
  }
  return new Response(null, { status: 303, headers: { Location: location } })
}

export const roleBindingFormScript = `<script>
(function(){
  function init(){
    document.querySelectorAll("form[data-role-binding-form]").forEach(initForm);
  }
  function initForm(form){
    var autosave = form.getAttribute("data-autosave") === "true";
    var lastSaved = "";
    var saving = false;
    var queued = false;
    var timer = 0;

    function providerValue(){
      var checked = form.querySelector("input[name='provider']:checked");
      return checked ? checked.value : "";
    }

    function isOpencode(){
      return providerValue() === "opencode";
    }

    function serialize(){
      return new URLSearchParams(new FormData(form)).toString();
    }

    function setSaveState(state, label){
      var status = form.querySelector("[data-save-status]");
      var submit = form.querySelector("[data-save-submit]");
      if (status) {
        status.hidden = false;
        status.setAttribute("data-state", state);
        status.textContent = label;
      }
      if (autosave && submit) submit.hidden = state !== "error";
    }

    function syncProvider(){
      var provider = providerValue();
      form.querySelectorAll("[data-provider-fields]").forEach(function(block){
        var active = block.getAttribute("data-provider-fields") === provider;
        block.hidden = !active;
        block.querySelectorAll("input,select,textarea").forEach(function(input){
          if (input.closest("[data-model-param-set]")) return;
          input.disabled = !active;
        });
      });
      var saveActions = form.querySelector("[data-save-actions]");
      if (saveActions) saveActions.hidden = provider === "opencode";
      syncModelParams(!isOpencode());
    }

    function syncModelParams(providerActive){
      var container = form.querySelector("[data-model-params]");
      if (!container) return;
      var modelInput = form.querySelector("[data-provider-fields='cursor'] [name='model']")
        || form.querySelector("[name='model']");
      var model = modelInput ? modelInput.value : "";
      var previous = {};
      container.querySelectorAll("[data-model-param-set] input, [data-model-param-set] select, [data-model-param-set] textarea").forEach(function(input){
        if (!input.disabled && input.name) previous[input.name] = input.value;
      });
      var shown = false;
      container.querySelectorAll("[data-model-param-set]").forEach(function(set){
        var match = set.getAttribute("data-model-param-set") === model;
        var enable = !!providerActive && match;
        set.hidden = !match;
        if (match && set.querySelector("input,select,textarea")) shown = true;
        set.querySelectorAll("input,select,textarea").forEach(function(input){
          if (enable && previous[input.name] != null) {
            var next = previous[input.name];
            if (input.tagName === "SELECT") {
              var ok = false;
              for (var i = 0; i < input.options.length; i++) {
                if (input.options[i].value === next) { ok = true; break; }
              }
              if (ok) input.value = next;
            } else {
              input.value = next;
            }
          }
          input.disabled = !enable;
        });
      });
      var empty = container.querySelector("[data-model-param-empty]");
      if (empty) empty.hidden = shown;
    }

    async function save(){
      if (!autosave) return;
      var body = serialize();
      if (body === lastSaved) return;
      if (saving) { queued = true; return; }
      saving = true;
      setSaveState("saving", "Saving…");
      try {
        var resp = await fetch(form.action, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "accept": "application/json",
          },
          body: body,
        });
        var data = await resp.json().catch(function(){ return null; });
        if (!resp.ok || !data || !data.ok) throw new Error("save failed");
        lastSaved = body;
        setSaveState("saved", "Saved");
      } catch {
        setSaveState("error", "Save failed");
      } finally {
        saving = false;
        if (queued) {
          queued = false;
          save();
        }
      }
    }

    function queueSave(){
      if (!autosave) return;
      setSaveState("unsaved", "Saving…");
      save();
    }

    function debounceSave(){
      if (!autosave) return;
      setSaveState("unsaved", "Unsaved changes");
      clearTimeout(timer);
      timer = setTimeout(function(){ save(); }, 400);
    }

    form.addEventListener("change", function(event){
      var target = event.target;
      if (target && target.name === "provider") syncProvider();
      if (target && target.name === "model") syncModelParams(!isOpencode());
      if (target && (target.tagName === "SELECT" || target.type === "radio" || target.type === "checkbox")) {
        queueSave();
      } else {
        debounceSave();
      }
    });
    form.addEventListener("input", function(event){
      var target = event.target;
      if (!target || target.tagName === "SELECT") return;
      if (target.type === "radio" || target.type === "checkbox") return;
      debounceSave();
    });
    form.addEventListener("submit", function(event){
      if (!autosave || !window.fetch) return;
      event.preventDefault();
      lastSaved = "";
      save();
    });

    syncProvider();
    lastSaved = serialize();
    if (autosave && !isOpencode()) setSaveState("saved", "Saved");
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
</script>`
