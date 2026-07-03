import { HIGHLIGHT_COLOR_RGBA, type HtmlReaderHighlight } from "./html-highlights-store"

export { HIGHLIGHT_COLOR_RGBA }

export function highlightsToJson(highlights: HtmlReaderHighlight[]): string {
  return JSON.stringify(highlights.map((h) => ({
    id: h.id,
    color: h.color,
    quote: h.quote,
    prefix: h.prefix,
    suffix: h.suffix,
    createdAt: h.createdAt,
  }))).replace(/</g, "\\u003c")
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

  const notesTab = document.querySelector('[data-html-tab="notes"]')
  const highlightsTab = document.querySelector('[data-html-tab="highlights"]')
  const notesPanel = document.querySelector('[data-html-panel="notes"]')
  const highlightsPanel = document.querySelector('[data-html-panel="highlights"]')
  const selectionInput = document.querySelector("[data-html-highlight-selection]")
  const composeBlock = document.querySelector("[data-html-highlight-compose]")
  const listEl = document.querySelector("[data-html-highlight-list]")
  const unsupportedEl = document.querySelector("[data-html-highlight-unsupported]")
  const saveBtn = document.querySelector("[data-html-highlight-save]")
  const clearBtn = document.querySelector("[data-html-highlight-clear]")
  const swatchRoot = document.querySelector("[data-html-highlight-colors]")

  let highlights = []
  try {
    highlights = JSON.parse(root.dataset.highlights ?? "[]")
  } catch {
    highlights = []
  }

  let pendingSelection = null
  let selectedColor = "yellow"
  let cssHighlightSupported = false
  const painted = new Map()

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
      return '<div class="html-viewer-highlight-item" data-highlight-id="' + escapeHtml(item.id) + '">' +
        '<div class="html-viewer-highlight-item-main">' +
        '<span class="html-viewer-highlight-swatch" style="background:' + rgba + '"></span>' +
        '<div class="html-viewer-highlight-item-text">' +
        '<div class="html-viewer-highlight-quote">' + escapeHtml(item.quote) + badge + '</div>' +
        '<div class="html-viewer-highlight-meta muted-text">' + escapeHtml(formatTime(item.createdAt)) + '</div>' +
        '</div></div>' +
        '<button type="button" class="html-viewer-highlight-delete" data-highlight-delete="' + escapeHtml(item.id) + '" aria-label="Delete highlight">Delete</button>' +
        '</div>'
    }).join("")
  }

  function syncCompose() {
    const hasPending = !!pendingSelection
    if (composeBlock instanceof HTMLElement) {
      composeBlock.hidden = !hasPending
    }
    if (selectionInput instanceof HTMLTextAreaElement) {
      selectionInput.value = pendingSelection?.quote ?? ""
      selectionInput.readOnly = true
    }
    if (saveBtn instanceof HTMLButtonElement) {
      saveBtn.disabled = !hasPending || !cssHighlightSupported
    }
    if (clearBtn instanceof HTMLButtonElement) {
      clearBtn.disabled = !hasPending
    }
  }

  function setActiveTab(tab) {
    const isNotes = tab === "notes"
    notesTab?.classList.toggle("html-viewer-tab-active", isNotes)
    highlightsTab?.classList.toggle("html-viewer-tab-active", !isNotes)
    if (notesPanel instanceof HTMLElement) notesPanel.hidden = !isNotes
    if (highlightsPanel instanceof HTMLElement) highlightsPanel.hidden = isNotes
    try { localStorage.setItem(tabStorageKey, tab) } catch {}
    if (!isNotes) syncCompose()
  }

  function restoreTab() {
    let tab = "notes"
    try {
      const stored = localStorage.getItem(tabStorageKey)
      if (stored === "notes" || stored === "highlights") tab = stored
    } catch {}
    setActiveTab(tab)
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

  function clearSelection() {
    pendingSelection = null
    const doc = iframe.contentDocument
    doc?.getSelection()?.removeAllRanges()
    syncCompose()
  }

  function bindIframe() {
    const doc = iframe.contentDocument
    if (!doc || !doc.body) return
    cssHighlightSupported = !!doc.defaultView?.CSS?.highlights
    if (unsupportedEl instanceof HTMLElement) {
      unsupportedEl.hidden = cssHighlightSupported
    }
    doc.addEventListener("mouseup", () => captureSelection())
    repaintAll(doc)
    renderList(doc)
    syncCompose()
  }

  async function saveHighlight() {
    if (!pendingSelection || !cssHighlightSupported) return
    if (!(saveBtn instanceof HTMLButtonElement)) return
    saveBtn.disabled = true
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
      if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = !pendingSelection || !cssHighlightSupported
    }
  }

  async function deleteHighlight(id) {
    try {
      const resp = await fetch(apiBase + "/" + encodeURIComponent(id) + "?file=" + encodeURIComponent(filePath), {
        method: "DELETE",
      })
      if (!resp.ok) throw new Error("delete failed")
      highlights = highlights.filter((item) => item.id !== id)
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
  saveBtn?.addEventListener("click", () => { void saveHighlight() })
  clearBtn?.addEventListener("click", clearSelection)
  listEl?.addEventListener("click", (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const btn = target.closest("[data-highlight-delete]")
    if (!(btn instanceof HTMLElement)) return
    const id = btn.dataset.highlightDelete
    if (id) void deleteHighlight(id)
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
