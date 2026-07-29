import { HIGHLIGHT_COLOR_RGBA, type HtmlReaderHighlight } from "./html-highlights-store"
import { escapeHtml } from "./utils"

export { HIGHLIGHT_COLOR_RGBA }

export function highlightsToJson(
  highlights: HtmlReaderHighlight[],
  tagsByHighlightId: Record<string, Array<{ slug: string; label: string; noteSource: string }>> = {},
): string {
  return escapeHtml(JSON.stringify(highlights.map((h) => ({
    id: h.id,
    color: h.color,
    quote: h.quote,
    prefix: h.prefix,
    suffix: h.suffix,
    note: h.note,
    createdAt: h.createdAt,
    tags: tagsByHighlightId[h.id] ?? [],
  }))))
}

export const HTML_HIGHLIGHTS_SCRIPT = /* html */ `
<script>
(function () {
  const COLOR_RGBA = ${JSON.stringify(HIGHLIGHT_COLOR_RGBA)}
  const shell = document.querySelector(".html-viewer-shell")
  const iframe = document.querySelector(".html-viewer-frame")
  const root = document.querySelector("[data-html-highlights-root]")
  if (!(shell instanceof HTMLElement) || !(iframe instanceof HTMLIFrameElement) || !(root instanceof HTMLElement)) return

  const runName = root.dataset.runName ?? ""
  const filePath = root.dataset.file ?? ""
  const apiBase = "/runs/" + encodeURIComponent(runName) + "/html-highlights"
  const tabStorageKey = "html-viewer-tab:" + filePath

  function isMobile() {
    return window.matchMedia("(max-width: 860px)").matches
  }

  const notesTab = document.querySelector('[data-html-tab="notes"]')
  const highlightsTab = document.querySelector('[data-html-tab="highlights"]')
  const askTab = document.querySelector('[data-html-tab="ask"]')
  const notesPanel = document.querySelector('[data-html-panel="notes"]')
  const highlightsPanel = document.querySelector('[data-html-panel="highlights"]')
  const askPanel = document.querySelector('[data-html-panel="ask"]')
  const selectionInput = document.querySelector("[data-html-highlight-selection]")
  const composeBlock = document.querySelector("[data-html-highlight-compose]")
  const listEl = document.querySelector("[data-html-highlight-list]")
  const unsupportedEl = document.querySelector("[data-html-highlight-unsupported]")
  const saveBtn = document.querySelector("[data-html-highlight-save]")
  const askBtn = document.querySelector("[data-html-highlight-ask]")
  const clearBtn = document.querySelector("[data-html-highlight-clear]")
  const swatchRoot = document.querySelector("[data-html-highlight-colors]")
  const navHighlightBtn = document.querySelector("[data-html-nav-highlight]")
  const navAskBtn = document.querySelector("[data-html-nav-ask]")

  let highlights = []
  try {
    highlights = JSON.parse(root.dataset.highlights ?? "[]")
  } catch {
    highlights = []
  }

  let pendingSelection = null
  let selectedHighlightId = null
  let selectedColor = "yellow"
  let cssHighlightSupported = false
  let selectionBoundDoc = null
  let selectionTimer = null
  const painted = new Map()
  const noteSaveTimers = new Map()
  const noteLastSaved = new Map()
  const noteSaveInFlight = new Map()

  function displayQuote(quote) {
    return String(quote || "").trim()
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  }

  function collectTextNodes(doc) {
    const nodes = []
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.textContent && node.textContent.length > 0
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT
      },
    })
    let node = walker.nextNode()
    while (node) {
      nodes.push(node)
      node = walker.nextNode()
    }
    return nodes
  }

  function buildTextIndex(doc) {
    const nodes = collectTextNodes(doc)
    let text = ""
    const segments = []
    for (const node of nodes) {
      const value = node.textContent ?? ""
      segments.push({ node, start: text.length, end: text.length + value.length })
      text += value
    }
    return { text, segments }
  }

  function rangeFromOffsets(doc, start, end) {
    const { segments } = buildTextIndex(doc)
    if (start < 0 || end <= start) return null
    let startNode = null
    let startOffset = 0
    let endNode = null
    let endOffset = 0
    for (const seg of segments) {
      if (startNode === null && start >= seg.start && start <= seg.end) {
        startNode = seg.node
        startOffset = start - seg.start
      }
      if (end >= seg.start && end <= seg.end) {
        endNode = seg.node
        endOffset = end - seg.start
        break
      }
    }
    if (!startNode || !endNode) return null
    const range = doc.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    return range
  }

  function serializeRange(doc, range) {
    const quote = range.toString()
    if (!quote.trim()) return null
    const { text } = buildTextIndex(doc)
    const before = doc.createRange()
    before.selectNodeContents(doc.body)
    before.setEnd(range.startContainer, range.startOffset)
    const start = before.toString().length
    const prefix = text.slice(Math.max(0, start - 32), start)
    const suffix = text.slice(start + quote.length, start + quote.length + 32)
    return { quote, prefix, suffix }
  }

  function resolveAnchor(doc, anchor) {
    const { text } = buildTextIndex(doc)
    const quote = anchor.quote
    if (!quote) return null
    let searchFrom = 0
    while (searchFrom <= text.length) {
      const idx = text.indexOf(quote, searchFrom)
      if (idx === -1) return null
      const prefix = text.slice(Math.max(0, idx - 32), idx)
      const suffix = text.slice(idx + quote.length, idx + quote.length + 32)
      const prefixOk = !anchor.prefix || prefix === anchor.prefix || prefix.endsWith(anchor.prefix) || anchor.prefix.endsWith(prefix)
      const suffixOk = !anchor.suffix || suffix === anchor.suffix || suffix.startsWith(anchor.suffix) || anchor.suffix.startsWith(suffix)
      if (prefixOk && suffixOk) {
        return rangeFromOffsets(doc, idx, idx + quote.length)
      }
      searchFrom = idx + 1
    }
    return null
  }

  function highlightName(id) {
    return "hl-" + id.replace(/[^a-zA-Z0-9_-]/g, "")
  }

  function ensureStyles(doc) {
    let style = doc.getElementById("html-viewer-highlight-styles")
    if (style) return style
    style = doc.createElement("style")
    style.id = "html-viewer-highlight-styles"
    doc.head.appendChild(style)
    return style
  }

  function syncStylesheet(doc) {
    const style = ensureStyles(doc)
    const rules = highlights.map((item) => {
      const rgba = COLOR_RGBA[item.color] ?? COLOR_RGBA.yellow
      return "::highlight(" + highlightName(item.id) + ") { background-color: " + rgba + "; }"
    })
    style.textContent = rules.join("\\n")
  }

  function paintHighlight(doc, item) {
    if (!cssHighlightSupported) return false
    const range = resolveAnchor(doc, item)
    if (!range) return false
    const name = highlightName(item.id)
    const registry = doc.defaultView?.CSS?.highlights
    if (!registry) return false
    registry.set(name, new Highlight(range))
    painted.set(item.id, name)
    return true
  }

  function unpaintHighlight(doc, id) {
    const name = painted.get(id) ?? highlightName(id)
    doc.defaultView?.CSS?.highlights?.delete(name)
    painted.delete(id)
  }

  function repaintAll(doc) {
    if (!cssHighlightSupported) return
    const registry = doc.defaultView?.CSS?.highlights
    if (!registry) return
    for (const name of painted.values()) registry.delete(name)
    painted.clear()
    syncStylesheet(doc)
    for (const item of highlights) paintHighlight(doc, item)
  }

  function formatTime(iso) {
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }

  function renderHighlightTags(item) {
    const tags = Array.isArray(item.tags) ? item.tags : []
    const chips = tags.length
      ? tags.map((tag) =>
        '<span class="tag-chip" data-tag-slug="' + escapeHtml(tag.slug) + '" data-tag-source="' + escapeHtml(tag.noteSource ?? "") + '">' +
        '<span class="tag-chip-label">' + escapeHtml(tag.label) + '</span>' +
        '<button type="button" class="tag-chip-remove" data-highlight-tag-remove="' + escapeHtml(item.id) + '" data-tag-slug="' + escapeHtml(tag.slug) + '" aria-label="Remove tag ' + escapeHtml(tag.label) + '">×</button>' +
        '</span>',
      ).join("")
      : '<span class="muted-text tiny-text">No tags</span>'
    const allTags = root.dataset.allTags ?? "[]"
    return '<div class="html-viewer-highlight-tags note-tags-editor" data-note-tags data-note-id="' + escapeHtml(item.id) + '">' +
      '<div class="tag-chip-list">' + chips + '</div>' +
      '<div class="tag-picker" data-tag-picker data-tag-refresh="event" data-note-id="' + escapeHtml(item.id) + '" data-all-tags="' + escapeHtml(allTags) + '">' +
      '<label class="form-field tag-picker-field"><span>Tags</span>' +
      '<div class="tag-picker-control">' +
      '<input class="form-input tag-picker-input" type="text" placeholder="Search or create tags…" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list">' +
      '<div class="tag-picker-menu" hidden role="listbox"></div>' +
      '</div></label></div>' +
      '</div>'
  }

  async function removeHighlightTag(id, slug) {
    const resp = await fetch("/api/library/notes/" + encodeURIComponent(id) + "/tags/" + encodeURIComponent(slug), {
      method: "DELETE",
      headers: { accept: "application/json" },
    })
    if (!resp.ok) throw new Error("remove tag failed")
    const data = await resp.json()
    const tags = Array.isArray(data.tags)
      ? data.tags.map((entry) => ({
        slug: entry.slug,
        label: entry.label,
        noteSource: entry.noteSource,
      }))
      : []
    highlights = highlights.map((entry) => entry.id === id ? { ...entry, tags } : entry)
  }

  function renderList(doc) {
    if (!(listEl instanceof HTMLElement)) return
    if (highlights.length === 0) {
      listEl.innerHTML = '<p class="html-viewer-highlight-empty muted-text">No highlights yet. Select text in the page to add one.</p>'
      return
    }
    listEl.innerHTML = highlights.map((item) => {
      const resolved = doc ? !!resolveAnchor(doc, item) : false
      const badge = resolved ? "" : ' <span class="html-viewer-highlight-missing">could not locate</span>'
      const rgba = COLOR_RGBA[item.color] ?? COLOR_RGBA.yellow
      const expanded = selectedHighlightId === item.id
      const hasNote = !!(item.note && item.note.trim())
      const noteBadge = hasNote && !expanded ? ' <span class="html-viewer-highlight-has-note">note</span>' : ""
      const noteSection = expanded
        ? '<div class="html-viewer-highlight-note">' +
          '<label class="html-viewer-highlight-note-label" for="html-highlight-note-' + escapeHtml(item.id) + '">Note</label>' +
          '<textarea id="html-highlight-note-' + escapeHtml(item.id) + '" class="html-viewer-highlight-note-input" data-highlight-note="' + escapeHtml(item.id) + '" rows="3" placeholder="Add a note for this highlight...">' + escapeHtml(item.note ?? "") + '</textarea>' +
          '<span class="html-viewer-highlight-note-status muted-text" data-highlight-note-status="' + escapeHtml(item.id) + '"></span>' +
          '</div>' +
          renderHighlightTags(item)
        : ""
      return '<div class="html-viewer-highlight-item' + (expanded ? " html-viewer-highlight-item-expanded" : "") + '" data-highlight-id="' + escapeHtml(item.id) + '">' +
        '<div class="html-viewer-highlight-item-row">' +
        '<button type="button" class="html-viewer-highlight-item-main" data-highlight-open="' + escapeHtml(item.id) + '" aria-expanded="' + (expanded ? "true" : "false") + '">' +
        '<span class="html-viewer-highlight-swatch" style="background:' + rgba + '"></span>' +
        '<div class="html-viewer-highlight-item-text">' +
        '<div class="html-viewer-highlight-quote">' + escapeHtml(displayQuote(item.quote)) + badge + noteBadge + '</div>' +
        '<div class="html-viewer-highlight-meta muted-text">' + escapeHtml(formatTime(item.createdAt)) + '</div>' +
        '</div></button>' +
        '<div class="html-viewer-highlight-item-actions">' +
        '<button type="button" class="html-viewer-action html-viewer-highlight-ask" data-highlight-ask="' + escapeHtml(item.id) + '">Ask</button>' +
        '<button type="button" class="html-viewer-highlight-delete" data-highlight-delete="' + escapeHtml(item.id) + '" aria-label="Delete highlight">Delete</button>' +
        '</div></div>' +
        noteSection +
        '</div>'
    }).join("")
    for (const item of highlights) {
      noteLastSaved.set(item.id, item.note ?? "")
    }
    if (typeof window.quorumInitTagPickers === "function") {
      window.quorumInitTagPickers(listEl)
    }
  }

  function setHighlightNoteStatus(id, state, label) {
    const statusEl = listEl?.querySelector('[data-highlight-note-status="' + id + '"]')
    if (!(statusEl instanceof HTMLElement)) return
    statusEl.dataset.state = state
    statusEl.textContent = label
  }

  function toggleHighlightOpen(id) {
    selectedHighlightId = selectedHighlightId === id ? null : id
    const doc = iframe.contentDocument
    renderList(doc)
    if (selectedHighlightId) {
      const input = listEl?.querySelector('[data-highlight-note="' + selectedHighlightId + '"]')
      if (input instanceof HTMLTextAreaElement) {
        input.focus()
      }
    }
  }

  async function saveHighlightNote(id, note) {
    if (noteSaveInFlight.get(id)) return
    const lastSaved = noteLastSaved.get(id) ?? ""
    if (note === lastSaved) return
    noteSaveInFlight.set(id, true)
    setHighlightNoteStatus(id, "saving", "Saving...")
    try {
      const resp = await fetch(apiBase + "/" + encodeURIComponent(id), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: filePath, note }),
      })
      if (!resp.ok) throw new Error("save failed")
      const data = await resp.json()
      const item = data.highlight
      if (!item) throw new Error("missing highlight")
      highlights = highlights.map((entry) => entry.id === id ? item : entry)
      noteLastSaved.set(id, note)
      const time = item.updatedAt ? new Date(item.updatedAt).toLocaleTimeString() : ""
      setHighlightNoteStatus(id, "saved", time ? "Saved at " + time : "Saved")
    } catch {
      setHighlightNoteStatus(id, "error", "Save failed")
    } finally {
      noteSaveInFlight.set(id, false)
    }
  }

  function queueHighlightNoteSave(id, note) {
    clearTimeout(noteSaveTimers.get(id))
    const lastSaved = noteLastSaved.get(id) ?? ""
    if (note !== lastSaved) {
      setHighlightNoteStatus(id, "unsaved", "Unsaved changes")
    }
    noteSaveTimers.set(id, setTimeout(() => {
      void saveHighlightNote(id, note)
    }, 500))
  }

  function syncCompose() {
    const hasPending = !!pendingSelection
    if (composeBlock instanceof HTMLElement) {
      composeBlock.hidden = !hasPending
    }
    if (selectionInput instanceof HTMLTextAreaElement) {
      selectionInput.value = pendingSelection ? displayQuote(pendingSelection.quote) : ""
      selectionInput.readOnly = true
    }
    if (saveBtn instanceof HTMLButtonElement) {
      saveBtn.disabled = !hasPending || !cssHighlightSupported
    }
    if (askBtn instanceof HTMLButtonElement) {
      askBtn.disabled = !hasPending
    }
    if (clearBtn instanceof HTMLButtonElement) {
      clearBtn.disabled = !hasPending
    }
    if (navHighlightBtn instanceof HTMLButtonElement) {
      navHighlightBtn.disabled = !hasPending || !cssHighlightSupported
    }
  }

  function askFromNavbar() {
    if (pendingSelection) {
      window.dispatchEvent(new CustomEvent("html-ask-open", {
        detail: {
          forceNew: true,
          selection: {
            quote: pendingSelection.quote,
            prefix: pendingSelection.prefix,
            suffix: pendingSelection.suffix,
          },
        },
      }))
      return
    }
    if (highlights.length > 0) {
      const latest = highlights.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
      if (latest?.id) {
        window.dispatchEvent(new CustomEvent("html-ask-open", {
          detail: { forceNew: true, highlightId: latest.id },
        }))
        return
      }
    }
    window.dispatchEvent(new CustomEvent("html-ask-open", { detail: { forceNew: true } }))
  }

  function setActiveTab(tab) {
    const tabs = [
      ["notes", notesTab, notesPanel],
      ["highlights", highlightsTab, highlightsPanel],
      ["ask", askTab, askPanel],
    ]
    for (const [name, button, panel] of tabs) {
      button?.classList.toggle("html-viewer-tab-active", tab === name)
      if (panel instanceof HTMLElement) panel.hidden = tab !== name
    }
    try { localStorage.setItem(tabStorageKey, tab) } catch {}
    if (tab !== "ask") {
      shell?.classList.remove("html-viewer-ask-sheet-open")
    }
    if (tab === "highlights") syncCompose()
  }

  function restoreTab() {
    let tab = "notes"
    try {
      const stored = localStorage.getItem(tabStorageKey)
      if (stored === "notes" || stored === "highlights" || stored === "ask") tab = stored
    } catch {}
    setActiveTab(tab)
    // Never auto-open the ask sheet overlay on load — only when the user asks.
    shell?.classList.remove("html-viewer-ask-sheet-open")
  }

  function captureSelection() {
    const doc = iframe.contentDocument
    if (!doc) return
    const sel = doc.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
    const anchor = serializeRange(doc, sel.getRangeAt(0))
    if (!anchor) return
    pendingSelection = anchor
    syncCompose()
    if (highlightsPanel instanceof HTMLElement && !highlightsPanel.hidden) {
      setActiveTab("highlights")
    }
  }

  function onSelectionChange() {
    clearTimeout(selectionTimer)
    selectionTimer = setTimeout(() => captureSelection(), 120)
  }

  function clearSelection() {
    pendingSelection = null
    clearTimeout(selectionTimer)
    const doc = iframe.contentDocument
    doc?.getSelection()?.removeAllRanges()
    syncCompose()
  }

  function askAboutSelection() {
    if (!pendingSelection) return
    window.dispatchEvent(new CustomEvent("html-ask-open", {
      detail: {
        selection: {
          quote: pendingSelection.quote,
          prefix: pendingSelection.prefix,
          suffix: pendingSelection.suffix,
        },
      },
    }))
  }

  function bindIframe() {
    const doc = iframe.contentDocument
    if (!doc || !doc.body) return
    cssHighlightSupported = !!doc.defaultView?.CSS?.highlights
    if (unsupportedEl instanceof HTMLElement) {
      unsupportedEl.hidden = cssHighlightSupported
    }
    if (selectionBoundDoc) {
      selectionBoundDoc.removeEventListener("selectionchange", onSelectionChange)
      selectionBoundDoc = null
    }
    doc.addEventListener("selectionchange", onSelectionChange)
    selectionBoundDoc = doc
    repaintAll(doc)
    renderList(doc)
    syncCompose()
  }

  async function saveHighlight() {
    if (!pendingSelection || !cssHighlightSupported) return
    if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = true
    if (navHighlightBtn instanceof HTMLButtonElement) navHighlightBtn.disabled = true
    try {
      const resp = await fetch(apiBase, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          file: filePath,
          color: selectedColor,
          quote: pendingSelection.quote,
          prefix: pendingSelection.prefix,
          suffix: pendingSelection.suffix,
        }),
      })
      if (!resp.ok) throw new Error("save failed")
      const data = await resp.json()
      const item = data.highlight
      if (!item) throw new Error("missing highlight")
      highlights.push(item)
      window.dispatchEvent(new CustomEvent("html-highlights-changed", {
        detail: { highlights: highlights.slice() },
      }))
      const doc = iframe.contentDocument
      if (doc) {
        syncStylesheet(doc)
        paintHighlight(doc, item)
        renderList(doc)
      }
      pendingSelection = null
      iframe.contentDocument?.getSelection()?.removeAllRanges()
      syncCompose()
    } catch {
      /* ignore */
    } finally {
      syncCompose()
    }
  }

  async function deleteHighlight(id) {
    try {
      const resp = await fetch(apiBase + "/" + encodeURIComponent(id) + "?file=" + encodeURIComponent(filePath), {
        method: "DELETE",
      })
      if (!resp.ok) throw new Error("delete failed")
      highlights = highlights.filter((item) => item.id !== id)
      window.dispatchEvent(new CustomEvent("html-highlights-changed", {
        detail: { highlights: highlights.slice() },
      }))
      if (selectedHighlightId === id) selectedHighlightId = null
      noteSaveTimers.delete(id)
      noteLastSaved.delete(id)
      noteSaveInFlight.delete(id)
      const doc = iframe.contentDocument
      if (doc) {
        unpaintHighlight(doc, id)
        syncStylesheet(doc)
        renderList(doc)
      }
    } catch {
      /* ignore */
    }
  }

  notesTab?.addEventListener("click", () => setActiveTab("notes"))
  highlightsTab?.addEventListener("click", () => setActiveTab("highlights"))
  askTab?.addEventListener("click", () => setActiveTab("ask"))
  window.addEventListener("html-ask-open", () => setActiveTab("ask"))
  saveBtn?.addEventListener("click", () => { void saveHighlight() })
  askBtn?.addEventListener("click", askAboutSelection)
  clearBtn?.addEventListener("click", clearSelection)
  navHighlightBtn?.addEventListener("click", () => { void saveHighlight() })
  navAskBtn?.addEventListener("click", askFromNavbar)
  listEl?.addEventListener("click", (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const askBtn = target.closest("[data-highlight-ask]")
    if (askBtn instanceof HTMLElement) {
      const id = askBtn.dataset.highlightAsk
      if (id) {
        window.dispatchEvent(new CustomEvent("html-ask-open", { detail: { highlightId: id } }))
      }
      return
    }
    const openBtn = target.closest("[data-highlight-open]")
    if (openBtn instanceof HTMLElement) {
      const id = openBtn.dataset.highlightOpen
      if (id) toggleHighlightOpen(id)
      return
    }
    const removeTagBtn = target.closest("[data-highlight-tag-remove]")
    if (removeTagBtn instanceof HTMLElement) {
      const id = removeTagBtn.dataset.highlightTagRemove
      const slug = removeTagBtn.dataset.tagSlug
      if (id && slug) {
        void removeHighlightTag(id, slug).then(() => {
          const doc = iframe.contentDocument
          renderList(doc)
        }).catch(() => {})
      }
      return
    }
    const btn = target.closest("[data-highlight-delete]")
    if (!(btn instanceof HTMLElement)) return
    const id = btn.dataset.highlightDelete
    if (id) void deleteHighlight(id)
  })

  listEl?.addEventListener("quorum-tag-added", (event) => {
    const custom = event instanceof CustomEvent ? event : null
    const picker = custom?.target
    if (!(picker instanceof HTMLElement)) return
    const id = picker.getAttribute("data-note-id")
    const data = custom?.detail
    if (!id || !data || !Array.isArray(data.tags)) return
    const tags = data.tags.map((entry) => ({
      slug: entry.slug,
      label: entry.label,
      noteSource: entry.noteSource,
    }))
    highlights = highlights.map((entry) => entry.id === id ? { ...entry, tags } : entry)
    const doc = iframe.contentDocument
    renderList(doc)
  })

  listEl?.addEventListener("input", (event) => {
    const target = event.target
    if (!(target instanceof HTMLTextAreaElement)) return
    const id = target.dataset.highlightNote
    if (!id) return
    const item = highlights.find((entry) => entry.id === id)
    if (item) item.note = target.value
    queueHighlightNoteSave(id, target.value)
  })

  if (swatchRoot instanceof HTMLElement) {
    swatchRoot.addEventListener("click", (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const swatch = target.closest("[data-highlight-color]")
      if (!(swatch instanceof HTMLElement)) return
      const color = swatch.dataset.highlightColor
      if (!color) return
      selectedColor = color
      for (const el of swatchRoot.querySelectorAll("[data-highlight-color]")) {
        el.classList.toggle("html-viewer-color-swatch-active", el === swatch)
      }
    })
  }

  iframe.addEventListener("load", bindIframe)
  if (iframe.contentDocument?.readyState === "complete") bindIframe()
  restoreTab()
})();
</script>`
