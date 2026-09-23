/**
 * Decide whether a click on an iframe link should leave the frame.
 * Same-document hash jumps stay inside; everything else opens in a new tab
 * because most external sites refuse to render in an iframe.
 *
 * Do not use `instanceof Element` in the iframe click handler: nodes from the
 * framed document live in a different realm, so that check always fails.
 */
export function shouldOpenIframeHrefExternally(href: string, currentHref: string): boolean {
  const raw = String(href ?? "").trim()
  if (!raw || raw === "#") return false
  const lower = raw.toLowerCase()
  if (lower.startsWith("javascript:") || lower.startsWith("mailto:") || lower.startsWith("tel:")) {
    return false
  }
  try {
    const current = new URL(currentHref)
    const next = new URL(raw, currentHref)
    return next.origin !== current.origin || next.pathname !== current.pathname || next.search !== current.search
  } catch {
    return false
  }
}

export const IFRAME_EXTERNAL_LINKS_SCRIPT = /* html */ `
<script>
(function () {
  function shouldOpenIframeHrefExternally(href, currentHref) {
    const raw = String(href || "").trim()
    if (!raw || raw === "#") return false
    const lower = raw.toLowerCase()
    if (lower.startsWith("javascript:") || lower.startsWith("mailto:") || lower.startsWith("tel:")) {
      return false
    }
    try {
      const current = new URL(currentHref)
      const next = new URL(raw, currentHref)
      return next.origin !== current.origin || next.pathname !== current.pathname || next.search !== current.search
    } catch {
      return false
    }
  }

  function elementFromEventTarget(target) {
    let node = target
    if (node && node.nodeType !== 1) node = node.parentElement
    if (!node || node.nodeType !== 1 || typeof node.closest !== "function") return null
    return node
  }

  function markAnchorExternal(anchor) {
    if (anchor.getAttribute("target") !== "_blank") {
      anchor.setAttribute("target", "_blank")
    }
    const rel = anchor.getAttribute("rel") || ""
    if (!/\\bnoopener\\b/.test(rel)) {
      anchor.setAttribute("rel", (rel + " noopener noreferrer").trim())
    }
  }

  const SELECTOR = ".html-viewer-frame, .design-preview-frame"

  function bindFrame(iframe) {
    if (!(iframe instanceof HTMLIFrameElement)) return
    if (iframe.dataset.externalLinksBound === "1") return
    iframe.dataset.externalLinksBound = "1"

    function currentHrefOf(doc) {
      return doc && doc.defaultView ? doc.defaultView.location.href : ""
    }

    function rewriteAnchors(doc) {
      const currentHref = currentHrefOf(doc)
      if (!currentHref) return
      const anchors = doc.querySelectorAll("a[href], area[href]")
      for (let i = 0; i < anchors.length; i++) {
        const anchor = anchors[i]
        const href = anchor.getAttribute("href")
        if (!href || !shouldOpenIframeHrefExternally(href, currentHref)) continue
        markAnchorExternal(anchor)
      }
    }

    function onDocumentClick(event) {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const node = elementFromEventTarget(event.target)
      if (!node) return
      const anchor = node.closest("a[href], area[href]")
      if (!anchor) return
      if (anchor.hasAttribute("download")) return
      const doc = iframe.contentDocument
      const href = anchor.getAttribute("href")
      const currentHref = currentHrefOf(doc)
      if (!href || !currentHref || !shouldOpenIframeHrefExternally(href, currentHref)) return
      markAnchorExternal(anchor)
    }

    function bindDocument() {
      const doc = iframe.contentDocument
      if (!doc || !doc.documentElement) return
      rewriteAnchors(doc)
      if (doc.documentElement.getAttribute("data-external-links-bound") === "1") return
      doc.documentElement.setAttribute("data-external-links-bound", "1")
      doc.addEventListener("click", onDocumentClick, true)
    }

    iframe.addEventListener("load", bindDocument)
    if (iframe.contentDocument && iframe.contentDocument.readyState !== "loading") bindDocument()
  }

  function bindAll() {
    document.querySelectorAll(SELECTOR).forEach(bindFrame)
  }

  bindAll()
  const observer = new MutationObserver(bindAll)
  observer.observe(document.documentElement, { childList: true, subtree: true })
})();
</script>`
