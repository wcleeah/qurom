import { basename } from "node:path"
import {
  HIGHLIGHT_COLOR_RGBA,
  HIGHLIGHT_COLORS,
  type HtmlReaderHighlight,
} from "./html-highlights-store"
import { askThreadsToJson, HTML_ASK_SCRIPT } from "./html-viewer-ask"
import { HTML_VIEWER_MARKDOWN_SCRIPT } from "./html-viewer-markdown"
import type { HtmlReaderAskThread } from "./html-ask-store"
import { highlightsToJson, HTML_HIGHLIGHTS_SCRIPT } from "./html-viewer-highlights"
import { appNavbarAction, appNavbarButton, renderAppNavbar } from "./app-nav"
import { layoutHtmlViewer } from "./layout"
import { TAG_FORMS_SCRIPT } from "./tag-ui"
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
      toggleBtn.textContent = open ? "Hide panel" : "Panel"
      toggleBtn.setAttribute("aria-expanded", open ? "true" : "false")
      return
    }
    const collapsed = shell.classList.contains("html-viewer-sidebar-collapsed")
    toggleBtn.textContent = collapsed ? "Show panel" : "Hide panel"
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

function renderColorSwatches(): string {
  return HIGHLIGHT_COLORS.map((color, index) => {
    const rgba = HIGHLIGHT_COLOR_RGBA[color]
    const activeClass = index === 0 ? " html-viewer-color-swatch-active" : ""
    return `<button type="button" class="html-viewer-color-swatch${activeClass}" data-highlight-color="${color}" style="background:${rgba}" aria-label="${escapeHtml(color)} highlight" aria-pressed="${index === 0 ? "true" : "false"}"></button>`
  }).join("")
}

export function renderHtmlViewerPage(
  runName: string,
  filePath: string,
  notes: string,
  highlights: HtmlReaderHighlight[],
  askThreads: HtmlReaderAskThread[] = [],
  pageNoteTagsHtml = "",
  highlightTagsById: Record<string, Array<{ slug: string; label: string; noteSource: string }>> = {},
): string {
  const baseName = basename(filePath)
  const runHref = `/runs/${encodeURIComponent(runName)}`
  const rawHref = `/runs/${encodeURIComponent(runName)}/raw/${encodeURIComponent(filePath)}`
  const embedSrc = `${rawHref}?source=1`
  const downloadHref = `${rawHref}?source=1&download=1`
  const notesAction = `/runs/${encodeURIComponent(runName)}/html-notes`
  const initialSaveState = notes.trim().length > 0 ? "saved" : "idle"
  const initialSaveLabel = notes.trim().length > 0 ? "All changes saved" : "Notes auto-save"
  const highlightsJson = highlightsToJson(highlights, highlightTagsById)
  const askThreadsJson = askThreadsToJson(askThreads)
  const navbarActions = [
    appNavbarButton("Hide panel", 'class="app-navbar-action html-viewer-sidebar-toggle" data-html-sidebar-toggle aria-expanded="true"'),
    appNavbarAction(`${rawHref}?source=1`, "View raw"),
    appNavbarAction(downloadHref, "Download", "html-viewer-download", `download="${escapeHtml(baseName)}"`),
  ].join("")
  const navbar = renderAppNavbar({
    section: "runs",
    back: { href: runHref, label: "← Back to run" },
    title: baseName,
    actionsHtml: navbarActions,
  })

  const body = `<div class="html-viewer-shell">
  <div data-html-highlights-root data-run-name="${escapeHtml(runName)}" data-file="${escapeHtml(filePath)}" data-highlights="${highlightsJson}"></div>
  <div data-html-ask-root data-run-name="${escapeHtml(runName)}" data-file="${escapeHtml(filePath)}" data-threads="${askThreadsJson}" data-highlights="${highlightsJson}"></div>
  ${navbar}
  <div class="html-viewer-main">
    <div class="html-viewer-frame-wrap">
      <iframe class="html-viewer-frame" src="${embedSrc}" title="${escapeHtml(baseName)}"></iframe>
    </div>
    <aside class="html-viewer-sidebar" data-html-viewer-sidebar>
      <div class="html-viewer-sidebar-header">
        <div class="html-viewer-sidebar-title-row">
          <h2 class="html-viewer-sidebar-title">Reader panel</h2>
        </div>
        <button type="button" class="html-viewer-sidebar-close" data-html-sidebar-close aria-label="Hide panel">×</button>
      </div>
      <div class="html-viewer-sidebar-tabs" role="tablist">
        <button type="button" class="html-viewer-tab html-viewer-tab-active" data-html-tab="notes" role="tab">Notes</button>
        <button type="button" class="html-viewer-tab" data-html-tab="highlights" role="tab">Highlights</button>
        <button type="button" class="html-viewer-tab" data-html-tab="ask" role="tab">Ask</button>
      </div>
      <div class="html-viewer-panel" data-html-panel="notes" role="tabpanel">
        <div class="html-viewer-panel-header">
          <div class="html-viewer-save-indicator" data-html-save-indicator data-state="${initialSaveState}">
            <span class="html-viewer-save-dot" aria-hidden="true"></span>
            <span class="html-viewer-save-label" data-html-save-label>${escapeHtml(initialSaveLabel)}</span>
          </div>
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
        ${pageNoteTagsHtml}
      </div>
      <div class="html-viewer-panel" data-html-panel="highlights" role="tabpanel" hidden>
        <p class="html-viewer-highlight-unsupported muted-text" data-html-highlight-unsupported hidden>
          Highlights require a browser with CSS Highlight API support.
        </p>
        <div class="html-viewer-highlight-compose" data-html-highlight-compose hidden>
          <label class="html-viewer-highlight-label" for="html-highlight-selection">Selected text</label>
          <textarea id="html-highlight-selection" class="html-viewer-highlight-selection" data-html-highlight-selection rows="3" readonly placeholder="Select text in the page..."></textarea>
          <div class="html-viewer-highlight-colors" data-html-highlight-colors>${renderColorSwatches()}</div>
          <div class="html-viewer-highlight-actions">
            <button type="button" class="html-viewer-action html-viewer-highlight-save" data-html-highlight-save disabled>Save highlight</button>
            <button type="button" class="html-viewer-action" data-html-highlight-clear disabled>Clear selection</button>
          </div>
        </div>
        <div class="html-viewer-highlight-list" data-html-highlight-list></div>
      </div>
      <div class="html-viewer-panel" data-html-panel="ask" role="tabpanel" hidden>
        <div class="html-viewer-ask-sheet" data-html-ask-sheet hidden>
          <div class="html-viewer-ask-sheet-handle" aria-hidden="true"></div>
        </div>
        <div class="html-viewer-ask-layout">
          <div class="html-viewer-ask-chat-list" data-html-ask-chat-list></div>
          <div class="html-viewer-ask-bootstrap" data-html-ask-bootstrap hidden>
            <label class="html-viewer-ask-bootstrap-label" for="html-ask-bootstrap-select">Starting from</label>
            <select id="html-ask-bootstrap-select" class="html-viewer-ask-bootstrap-select" data-html-ask-bootstrap-select>
              <option value="page">Whole page</option>
            </select>
          </div>
          <div class="html-viewer-ask-context muted-text" data-html-ask-context hidden></div>
          <div class="html-viewer-ask-messages" data-html-ask-messages></div>
          <p class="html-viewer-ask-status muted-text" data-html-ask-status></p>
          <form class="html-viewer-ask-form" data-html-ask-form>
            <textarea class="html-viewer-ask-input" data-html-ask-input rows="2" placeholder="Ask about this document..." required></textarea>
            <div class="html-viewer-ask-actions">
              <button type="submit" class="html-viewer-action html-viewer-ask-send" data-html-ask-send>Send</button>
              <button type="button" class="html-viewer-action" data-html-ask-new>New chat</button>
            </div>
          </form>
        </div>
      </div>
    </aside>
  </div>
</div>
${HTML_VIEWER_SCRIPT}
${HTML_HIGHLIGHTS_SCRIPT}
${HTML_VIEWER_MARKDOWN_SCRIPT}
${HTML_ASK_SCRIPT}
${TAG_FORMS_SCRIPT}`

  return layoutHtmlViewer(`${baseName} — ${escapeHtml(runName)}`, body)
}
