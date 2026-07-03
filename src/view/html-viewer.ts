import { basename } from "node:path"
import { layoutHtmlViewer } from "./layout"
import { escapeHtml } from "./utils"

export const HTML_VIEWER_SCRIPT = /* html */ `
<script>
(function () {
  const shell = document.querySelector(".html-viewer-shell")
  const form = document.querySelector("[data-html-notes-form]")
  const textarea = document.querySelector("[data-html-notes-input]")
  const indicator = document.querySelector("[data-html-save-indicator]")
  const indicatorLabel = document.querySelector("[data-html-save-label]")
  const sidebar = document.querySelector("[data-html-viewer-sidebar]")
  const toggleBtn = document.querySelector("[data-html-sidebar-toggle]")
  const closeBtn = document.querySelector("[data-html-sidebar-close]")
  if (!(shell instanceof HTMLElement) || !(textarea instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) return

  const storageKey = "html-viewer-sidebar:" + form.dataset.file
  let timer
  let inFlight = false
  let lastSaved = textarea.value
  let savedFlashTimer

  function isMobile() {
    return window.matchMedia("(max-width: 860px)").matches
  }

  function setSaveState(state, label) {
    if (!(indicator instanceof HTMLElement)) return
    indicator.dataset.state = state
    if (indicatorLabel instanceof HTMLElement) indicatorLabel.textContent = label
    if (state === "saved") {
      indicator.classList.add("html-viewer-save-indicator-flash")
      clearTimeout(savedFlashTimer)
      savedFlashTimer = setTimeout(() => {
        indicator.classList.remove("html-viewer-save-indicator-flash")
      }, 1200)
    }
  }

  function syncSidebarUi() {
    if (!(toggleBtn instanceof HTMLButtonElement)) return
    if (isMobile()) {
      const open = sidebar instanceof HTMLElement && sidebar.classList.contains("html-viewer-sidebar-open")
      toggleBtn.textContent = open ? "Hide notes" : "Notes"
      toggleBtn.setAttribute("aria-expanded", open ? "true" : "false")
      return
    }
    const collapsed = shell.classList.contains("html-viewer-sidebar-collapsed")
    toggleBtn.textContent = collapsed ? "Show notes" : "Hide notes"
    toggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true")
  }

  function setSidebarOpen(open) {
    if (isMobile()) {
      shell.classList.remove("html-viewer-sidebar-collapsed")
      if (sidebar instanceof HTMLElement) {
        sidebar.classList.toggle("html-viewer-sidebar-open", open)
      }
    } else {
      if (sidebar instanceof HTMLElement) {
        sidebar.classList.remove("html-viewer-sidebar-open")
      }
      shell.classList.toggle("html-viewer-sidebar-collapsed", !open)
    }
    try { localStorage.setItem(storageKey, open ? "open" : "closed") } catch {}
    syncSidebarUi()
  }

  function toggleSidebar() {
    if (isMobile()) {
      const open = sidebar instanceof HTMLElement && sidebar.classList.contains("html-viewer-sidebar-open")
      setSidebarOpen(!open)
      return
    }
    setSidebarOpen(shell.classList.contains("html-viewer-sidebar-collapsed"))
  }

  function restoreSidebarState() {
    let stored
    try { stored = localStorage.getItem(storageKey) } catch {}
    if (stored === "open" || stored === "closed") {
      setSidebarOpen(stored === "open")
      return
    }
    setSidebarOpen(!isMobile())
  }

  async function saveNotes() {
    if (inFlight || textarea.value === lastSaved) return
    inFlight = true
    setSaveState("saving", "Saving...")
    try {
      const resp = await fetch(form.action, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: form.dataset.file, notes: textarea.value }),
      })
      if (!resp.ok) throw new Error("save failed")
      lastSaved = textarea.value
      const data = await resp.json()
      const time = data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString() : ""
      setSaveState("saved", time ? "Saved at " + time : "All changes saved")
    } catch {
      setSaveState("error", "Save failed")
    } finally {
      inFlight = false
    }
  }

  if (textarea.value === lastSaved && textarea.value.trim().length > 0) {
    setSaveState("saved", "All changes saved")
  } else if (textarea.value.trim().length === 0) {
    setSaveState("idle", "Notes auto-save")
  }

  textarea.addEventListener("input", () => {
    clearTimeout(timer)
    if (textarea.value !== lastSaved) {
      setSaveState("unsaved", "Unsaved changes")
    }
    timer = setTimeout(() => { void saveNotes() }, 500)
  })

  if (toggleBtn instanceof HTMLButtonElement) {
    toggleBtn.addEventListener("click", toggleSidebar)
  }
  if (closeBtn instanceof HTMLButtonElement) {
    closeBtn.addEventListener("click", () => setSidebarOpen(false))
  }

  restoreSidebarState()
  window.addEventListener("resize", syncSidebarUi)
})();
</script>`

export function renderHtmlViewerPage(runName: string, filePath: string, notes: string): string {
  const baseName = basename(filePath)
  const runHref = `/runs/${encodeURIComponent(runName)}`
  const rawHref = `/runs/${encodeURIComponent(runName)}/raw/${encodeURIComponent(filePath)}`
  const embedSrc = `${rawHref}?source=1`
  const downloadHref = `${rawHref}?source=1&download=1`
  const notesAction = `/runs/${encodeURIComponent(runName)}/html-notes`
  const initialSaveState = notes.trim().length > 0 ? "saved" : "idle"
  const initialSaveLabel = notes.trim().length > 0 ? "All changes saved" : "Notes auto-save"

  const body = `<div class="html-viewer-shell">
  <header class="html-viewer-navbar">
    <div class="html-viewer-navbar-start">
      <a class="html-viewer-back" href="${runHref}">← Back to run</a>
      <span class="html-viewer-filename" title="${escapeHtml(filePath)}">${escapeHtml(baseName)}</span>
    </div>
    <div class="html-viewer-navbar-actions">
      <button type="button" class="html-viewer-sidebar-toggle" data-html-sidebar-toggle aria-expanded="true">Hide notes</button>
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
        <div class="html-viewer-sidebar-title-row">
          <h2 class="html-viewer-sidebar-title">Notes</h2>
          <div class="html-viewer-save-indicator" data-html-save-indicator data-state="${initialSaveState}">
            <span class="html-viewer-save-dot" aria-hidden="true"></span>
            <span class="html-viewer-save-label" data-html-save-label>${escapeHtml(initialSaveLabel)}</span>
          </div>
        </div>
        <button type="button" class="html-viewer-sidebar-close" data-html-sidebar-close aria-label="Hide notes">×</button>
      </div>
      <p class="html-viewer-sidebar-hint muted-text">Comments while reading this page</p>
      <form class="html-viewer-notes-form" data-html-notes-form data-file="${escapeHtml(filePath)}" action="${notesAction}">
        <textarea
          class="html-viewer-notes"
          data-html-notes-input
          name="notes"
          rows="12"
          placeholder="Write your notes here..."
        >${escapeHtml(notes)}</textarea>
      </form>
    </aside>
  </div>
</div>
${HTML_VIEWER_SCRIPT}`

  return layoutHtmlViewer(`${baseName} — ${escapeHtml(runName)}`, body)
}
