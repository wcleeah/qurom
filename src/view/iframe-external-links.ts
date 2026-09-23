/**
 * Decide whether a click on an iframe link should leave the frame.
 * Same-document hash jumps stay inside; everything else opens in a new tab
 * because most external sites refuse to render in an iframe.
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

  const SELECTOR = ".html-viewer-frame, .design-preview-frame"

  function bindFrame(iframe) {
    if (!(iframe instanceof HTMLIFrameElement)) return
    if (iframe.dataset.externalLinksBound === "1") return
    iframe.dataset.externalLinksBound = "1"

    function onDocumentClick(event) {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest("a[href], area[href]")
      if (!anchor) return
      if (anchor.hasAttribute("download")) return
      const doc = iframe.contentDocument
      const currentHref = doc && doc.defaultView ? doc.defaultView.location.href : ""
      const href = anchor.getAttribute("href")
      if (!href || !currentHref || !shouldOpenIframeHrefExternally(href, currentHref)) return
      event.preventDefault()
      const url = anchor.href
      const opener = iframe.contentWindow || window
      opener.open(url, "_blank", "noopener,noreferrer")
    }

    function bindDocument() {
      const doc = iframe.contentDocument
      if (!doc || !doc.documentElement) return
      if (doc.documentElement.dataset.externalLinksBound === "1") return
      doc.documentElement.dataset.externalLinksBound = "1"
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
