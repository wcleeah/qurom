import { basename } from "node:path"
import { layoutHtmlViewer } from "./layout"
import { escapeHtml } from "./utils"

export const HTML_VIEWER_SCRIPT = /* html */ `
<script>
(function () {
  const form = document.querySelector("[data-html-notes-form]")
  const textarea = document.querySelector("[data-html-notes-input]")
  const statusEl = document.querySelector("[data-html-notes-status]")
  const sidebar = document.querySelector("[data-html-viewer-sidebar]")
  const toggleBtn = document.querySelector("[data-html-sidebar-toggle]")
  if (!(textarea instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) return

  let timer
  let inFlight = false
  let lastSaved = textarea.value

  function setStatus(text, isError) {
    if (!statusEl) return
    statusEl.textContent = text
    statusEl.classList.toggle("html-viewer-save-status-error", !!isError)
  }

  async function saveNotes() {
    if (inFlight || textarea.value === lastSaved) return
    inFlight = true
    setStatus("Saving...", false)
    try {
      const resp = await fetch(form.action, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: form.dataset.file, notes: textarea.value }),
      })
      if (!resp.ok) throw new Error("save failed")
      lastSaved = textarea.value
      const data = await resp.json()
      setStatus("Saved" + (data.updatedAt ? " · " + new Date(data.updatedAt).toLocaleTimeString() : ""), false)
    } catch {
      setStatus("Save failed", true)
    } finally {
      inFlight = false
    }
  }

  textarea.addEventListener("input", () => {
    clearTimeout(timer)
    setStatus("Unsaved changes", false)
    timer = setTimeout(() => { void saveNotes() }, 500)
  })

  if (toggleBtn instanceof HTMLButtonElement && sidebar instanceof HTMLElement) {
    toggleBtn.addEventListener("click", () => {
      const open = sidebar.classList.toggle("html-viewer-sidebar-open")
      toggleBtn.setAttribute("aria-expanded", open ? "true" : "false")
      toggleBtn.textContent = open ? "Hide notes" : "Notes"
    })
  }
})();
</script>`

export function renderHtmlViewerPage(runName: string, filePath: string, notes: string): string {
  const baseName = basename(filePath)
  const runHref = `/runs/${encodeURIComponent(runName)}`
  const rawHref = `/runs/${encodeURIComponent(runName)}/raw/${encodeURIComponent(filePath)}`
  const embedSrc = `${rawHref}?source=1`
  const downloadHref = `${rawHref}?source=1&download=1`
  const notesAction = `/runs/${encodeURIComponent(runName)}/html-notes`

  const body = `<div class="html-viewer-shell">
  <header class="html-viewer-navbar">
    <div class="html-viewer-navbar-start">
      <a class="html-viewer-back" href="${runHref}">← Back to run</a>
      <span class="html-viewer-filename" title="${escapeHtml(filePath)}">${escapeHtml(baseName)}</span>
    </div>
    <div class="html-viewer-navbar-actions">
      <button type="button" class="html-viewer-sidebar-toggle" data-html-sidebar-toggle aria-expanded="false">Notes</button>
      <a class="html-viewer-action" href="${rawHref}?source=1">View raw</a>
      <a class="html-viewer-action html-viewer-download" href="${downloadHref}" download="${escapeHtml(baseName)}">Download</a>
      <button type="button" class="theme-toggle html-viewer-theme-toggle" data-theme-toggle aria-label="Toggle color theme"></button>
    </div>
  </header>
  <div class="html-viewer-main">
    <div class="html-viewer-frame-wrap">
      <iframe class="html-viewer-frame" src="${embedSrc}" title="${escapeHtml(baseName)}"></iframe>
    </div>
    <aside class="html-viewer-sidebar" data-html-viewer-sidebar>
      <div class="html-viewer-sidebar-header">
        <h2 class="html-viewer-sidebar-title">Notes</h2>
        <p class="html-viewer-sidebar-hint muted-text">Comments while reading this page</p>
      </div>
      <form class="html-viewer-notes-form" data-html-notes-form data-file="${escapeHtml(filePath)}" action="${notesAction}">
        <textarea
          class="html-viewer-notes"
          data-html-notes-input
          name="notes"
          rows="12"
          placeholder="Write your notes here..."
        >${escapeHtml(notes)}</textarea>
      </form>
      <div class="html-viewer-save-status muted-text" data-html-notes-status"></div>
    </aside>
  </div>
</div>
${HTML_VIEWER_SCRIPT}`

  return layoutHtmlViewer(`${baseName} — ${escapeHtml(runName)}`, body)
}
