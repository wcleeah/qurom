import { MAX_DOCUMENT_BYTES } from "../document-input"
import { escapeHtml } from "./utils"

export type NewRunFormOptions = {
  runActive: boolean
  activeRunId?: string
  error?: string
}

const TAB_COPY: Record<string, { hint: string; submit: string }> = {
  topic: {
    hint: "Ask a research question — the quorum will draft, audit, and revise until approved or failed.",
    submit: "Start research",
  },
  document: {
    hint: "Paste or compose markdown in the browser, load a local file, or use a server path. The quorum will research, audit, and expand it into a deep dive.",
    submit: "Start from document",
  },
  resume: {
    hint: "Resume a prior run by directory name or request ID. Continues from the latest checkpoint.",
    submit: "Resume run",
  },
}

const MAX_DOCUMENT_KB = Math.round(MAX_DOCUMENT_BYTES / 1024)

function tabButton(id: string, label: string, active: boolean): string {
  return `<button type="button" class="new-run-tab${active ? " active" : ""}" data-new-run-tab="${id}" role="tab" aria-selected="${active ? "true" : "false"}">${label}</button>`
}

function panelHint(id: string): string {
  return `<p class="new-run-hint">${escapeHtml(TAB_COPY[id]!.hint)}</p>`
}

export function renderNewRunForm(options: NewRunFormOptions): string {
  const disabled = options.runActive ? " disabled" : ""
  const activeNote = options.runActive
    ? `<div class="new-run-active-note"><span class="badge badge-running">● Active run</span><span class="muted-note">${options.activeRunId ? `Finish or <a href="/runs/${escapeHtml(encodeURIComponent(options.activeRunId))}">open the current run</a> before starting another.` : "Wait for the current run to finish before starting another."}</span></div>`
    : ""

  const errorHtml = options.error
    ? `<div class="new-run-error">${escapeHtml(options.error)}</div>`
    : ""

  return `<section class="new-run-section" aria-labelledby="new-run-heading">
  <div class="card new-run-card">
    <div class="new-run-header">
      <div class="new-run-header-text">
        <h2 id="new-run-heading">Start a run</h2>
        <p class="muted-note new-run-subtitle">One active pipeline at a time · providers start on demand</p>
      </div>
      <div class="new-run-tabs" role="tablist" aria-label="Run type">
        ${tabButton("topic", "Topic", true)}
        ${tabButton("document", "Document", false)}
        ${tabButton("resume", "Resume", false)}
      </div>
    </div>
    ${activeNote}
    ${errorHtml}
    <div class="new-run-panels">
      <form class="new-run-panel active config-form" data-new-run-panel="topic" method="POST" action="/api/runs" role="tabpanel">
        ${panelHint("topic")}
        <label class="form-field"><span>Research topic</span>
          <textarea class="form-input new-run-textarea" name="topic" rows="4" placeholder="e.g. Why is 1+1 equal to 2?" required${disabled}></textarea>
        </label>
        <input type="hidden" name="inputMode" value="topic" />
        <div class="form-actions new-run-actions"><button type="submit" class="btn btn-primary"${disabled}>${TAB_COPY.topic.submit}</button></div>
      </form>
      <form class="new-run-panel config-form" data-new-run-panel="document" method="POST" action="/api/runs" data-document-form role="tabpanel">
        ${panelHint("document")}
        <div class="document-compose" data-document-compose${disabled ? " data-disabled" : ""}>
          <label class="form-field document-compose-field">
            <span>Source markdown</span>
            <textarea class="form-input new-run-textarea document-compose-textarea" name="documentText" rows="12" placeholder="# My notes&#10;&#10;Paste, type, or drop a markdown file here."${disabled}></textarea>
          </label>
          <div class="document-compose-meta muted-note" data-document-meta aria-live="polite">No content yet</div>
          <div class="document-compose-toolbar">
            <label class="btn btn-secondary document-file-button">
              Load from file
              <input type="file" class="document-file-input" accept=".md,.markdown,.txt,.text,text/markdown,text/plain" hidden${disabled} />
            </label>
            <button type="button" class="btn btn-secondary document-clear-button" data-document-clear${disabled}>Clear</button>
          </div>
          <details class="document-advanced">
            <summary>Advanced: server path</summary>
            <label class="form-field">
              <span>Path on server</span>
              <input class="form-input" name="documentPath" placeholder="/path/to/document.md"${disabled} />
            </label>
            <p class="muted-note document-advanced-hint">Optional when pasted text is provided. External files are copied into the run as <code>input.md</code>.</p>
          </details>
        </div>
        <input type="hidden" name="inputMode" value="document" />
        <div class="form-actions new-run-actions"><button type="submit" class="btn btn-primary"${disabled}>${TAB_COPY.document.submit}</button></div>
        <p class="new-run-submit-status muted-note" data-new-run-submit-status hidden aria-live="polite">Starting run…</p>
      </form>
      <form class="new-run-panel config-form" data-new-run-panel="resume" method="POST" action="/api/runs/resume-placeholder" data-resume-form role="tabpanel">
        ${panelHint("resume")}
        <div class="form-fields-grid">
          <label class="form-field"><span>Run ID or directory</span>
            <input class="form-input" name="runId" placeholder="my-topic-abc123" required${disabled} />
          </label>
          <label class="form-field"><span>Node <span class="new-run-optional">optional</span></span>
            <input class="form-input" name="node" placeholder="auditDraft"${disabled} />
          </label>
        </div>
        <div class="form-actions new-run-actions"><button type="submit" class="btn btn-primary"${disabled}>${TAB_COPY.resume.submit}</button></div>
        <p class="new-run-submit-status muted-note" data-new-run-submit-status hidden aria-live="polite">Resuming run…</p>
      </form>
    </div>
  </div>
</section>`
}

export const NEW_RUN_FORM_SCRIPT = /* html */ `
<script>
(function () {
  const DRAFT_KEY = "qurom:document-draft"
  const MAX_BYTES = ${MAX_DOCUMENT_BYTES}
  const MAX_KB = ${MAX_DOCUMENT_KB}

  const tabs = document.querySelectorAll("[data-new-run-tab]")
  const panels = document.querySelectorAll("[data-new-run-panel]")

  function showPanel(name) {
    tabs.forEach((tab) => {
      const active = tab.getAttribute("data-new-run-tab") === name
      tab.classList.toggle("active", active)
      tab.setAttribute("aria-selected", active ? "true" : "false")
    })
    panels.forEach((panel) => {
      const active = panel.getAttribute("data-new-run-panel") === name
      panel.classList.toggle("active", active)
    })
    if (name === "document") {
      const textarea = document.querySelector("[data-document-compose] textarea")
      if (textarea instanceof HTMLTextAreaElement) textarea.focus()
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.getAttribute("data-new-run-tab")
      if (name) showPanel(name)
    })
  })

  function setFormSubmitting(form, submitting, message, busyLabel) {
    const status = form.querySelector("[data-new-run-submit-status]")
    const submit = form.querySelector('button[type="submit"]')
    const pendingLabel = busyLabel || "Starting…"
    if (submit instanceof HTMLButtonElement) {
      if (!submit.dataset.defaultLabel) submit.dataset.defaultLabel = submit.textContent || ""
      submit.disabled = submitting
      submit.textContent = submitting ? pendingLabel : submit.dataset.defaultLabel
      submit.classList.toggle("is-loading", submitting)
      submit.setAttribute("aria-busy", submitting ? "true" : "false")
    }
    form.classList.toggle("new-run-form-busy", submitting)
    form.setAttribute("aria-busy", submitting ? "true" : "false")
    if (status instanceof HTMLElement) {
      status.hidden = !submitting
      if (message) status.textContent = message
    }
  }

  function firstMeaningfulLine(text) {
    const lines = text.split(/\\r?\\n/)
    let inFrontmatter = false
    let inCode = false
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = (lines[i] || "").trim()
      if (!trimmed) continue
      if (i === 0 && trimmed === "---") { inFrontmatter = true; continue }
      if (inFrontmatter) { if (trimmed === "---") inFrontmatter = false; continue }
      if (trimmed.startsWith("\`\`\`")) { inCode = !inCode; continue }
      if (inCode) continue
      const candidate = trimmed
        .replace(/^#{1,6}\\s+/, "")
        .replace(/^>\\s+/, "")
        .replace(/^[-*+]\\s+/, "")
        .replace(/^\\d+\\.\\s+/, "")
        .trim()
      if (candidate) return candidate
    }
    return ""
  }

  function byteLength(text) {
    return new TextEncoder().encode(text).byteLength
  }

  function updateDocumentMeta(textarea, meta) {
    const text = textarea.value
    const bytes = byteLength(text)
    const chars = text.length
    if (!text.trim()) {
      meta.textContent = "No content yet"
      meta.classList.remove("document-compose-meta-overlimit")
      return
    }
    const preview = firstMeaningfulLine(text)
    const previewPart = preview ? (' · first line: "' + preview.slice(0, 72) + (preview.length > 72 ? "…" : "") + '"') : ""
    meta.textContent = chars.toLocaleString() + " chars · " + Math.max(1, Math.round(bytes / 1024)) + " KB" + previewPart
    meta.classList.toggle("document-compose-meta-overlimit", bytes > MAX_BYTES)
  }

  const compose = document.querySelector("[data-document-compose]")
  if (compose instanceof HTMLElement) {
    const textarea = compose.querySelector("textarea")
    const meta = compose.querySelector("[data-document-meta]")
    const fileInput = compose.querySelector(".document-file-input")
    const clearButton = compose.querySelector("[data-document-clear]")
    const disabled = compose.hasAttribute("data-disabled")

    if (textarea instanceof HTMLTextAreaElement && meta instanceof HTMLElement) {
      const saved = localStorage.getItem(DRAFT_KEY)
      if (saved) textarea.value = saved

      let saveTimer
      const scheduleSave = () => {
        clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
          const value = textarea.value
          if (value.trim()) localStorage.setItem(DRAFT_KEY, value)
          else localStorage.removeItem(DRAFT_KEY)
        }, 400)
      }

      const refresh = () => {
        updateDocumentMeta(textarea, meta)
        scheduleSave()
      }

      textarea.addEventListener("input", refresh)
      refresh()

      compose.addEventListener("dragover", (event) => {
        if (disabled) return
        event.preventDefault()
        compose.classList.add("document-compose-dragover")
      })
      compose.addEventListener("dragleave", () => {
        compose.classList.remove("document-compose-dragover")
      })
      compose.addEventListener("drop", (event) => {
        if (disabled) return
        event.preventDefault()
        compose.classList.remove("document-compose-dragover")
        const file = event.dataTransfer?.files?.[0]
        if (!file) return
        file.text().then((text) => {
          textarea.value = text
          refresh()
        }).catch(() => {})
      })

      if (fileInput instanceof HTMLInputElement) {
        fileInput.addEventListener("change", () => {
          const file = fileInput.files?.[0]
          if (!file) return
          file.text().then((text) => {
            textarea.value = text
            refresh()
          }).catch(() => {})
          fileInput.value = ""
        })
      }

      if (clearButton instanceof HTMLButtonElement) {
        clearButton.addEventListener("click", () => {
          textarea.value = ""
          localStorage.removeItem(DRAFT_KEY)
          refresh()
        })
      }
    }
  }

  const documentForm = document.querySelector("[data-document-form]")
  if (documentForm instanceof HTMLFormElement) {
    documentForm.addEventListener("submit", (event) => {
      event.preventDefault()
      const textarea = documentForm.querySelector("textarea")
      const pathInput = documentForm.querySelector("input[name='documentPath']")
      const text = textarea instanceof HTMLTextAreaElement ? textarea.value.trim() : ""
      const path = pathInput instanceof HTMLInputElement ? pathInput.value.trim() : ""
      if (!text && !path) {
        window.location.href = "/?error=" + encodeURIComponent("Paste document text or provide a server path.")
        return
      }
      if (text && byteLength(text) > MAX_BYTES) {
        window.location.href = "/?error=" + encodeURIComponent("Document is too large. Maximum size is " + MAX_KB + " KB.")
        return
      }
      const body = { inputMode: "document" }
      if (text) body.documentText = text
      if (path) body.documentPath = path
      setFormSubmitting(
        documentForm,
        true,
        "Starting run…",
        "Starting…",
      )
      fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      }).then(async (resp) => {
        const data = await resp.json().catch(() => null)
        if (resp.ok && data && data.runPath) {
          localStorage.removeItem(DRAFT_KEY)
          window.location.href = "/runs/" + encodeURIComponent(data.runPath)
          return
        }
        setFormSubmitting(documentForm, false)
        const message = data && data.error ? data.error : "Failed to start document run"
        window.location.href = "/?error=" + encodeURIComponent(message)
      }).catch(() => {
        setFormSubmitting(documentForm, false)
        window.location.href = "/?error=" + encodeURIComponent("Failed to start document run")
      })
    })
  }

  const resumeForm = document.querySelector("[data-resume-form]")
  if (resumeForm instanceof HTMLFormElement) {
    resumeForm.addEventListener("submit", (event) => {
      event.preventDefault()
      const runId = new FormData(resumeForm).get("runId")
      const node = new FormData(resumeForm).get("node")
      if (typeof runId !== "string" || !runId.trim()) return
      const encoded = encodeURIComponent(runId.trim())
      resumeForm.action = "/api/runs/" + encoded + "/resume"
      const body = new URLSearchParams()
      if (typeof node === "string" && node.trim()) body.set("node", node.trim())
      setFormSubmitting(resumeForm, true, "Resuming run…", "Resuming…")
      fetch(resumeForm.action, { method: "POST", body }).then((resp) => {
        if (resp.redirected) {
          window.location.href = resp.url
          return
        }
        if (resp.status === 303) {
          const loc = resp.headers.get("Location")
          if (loc) {
            window.location.href = loc
            return
          }
        }
        setFormSubmitting(resumeForm, false)
        window.location.reload()
      }).catch(() => {
        setFormSubmitting(resumeForm, false)
        window.location.reload()
      })
    })
  }
})()
</script>`
