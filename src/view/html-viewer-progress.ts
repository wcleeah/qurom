import type { HtmlReaderProgress } from "./html-progress-store"
import { escapeHtml } from "./utils"

export function progressToDataAttrs(progress: HtmlReaderProgress | null | undefined): string {
  const scrollY = progress?.scrollY ?? 0
  const scrollRatio = progress?.scrollRatio ?? 0
  return `data-scroll-y="${escapeHtml(String(scrollY))}" data-scroll-ratio="${escapeHtml(String(scrollRatio))}"`
}

export const HTML_PROGRESS_SCRIPT = /* html */ `
<script>
(function () {
  const root = document.querySelector("[data-html-progress-root]")
  const iframe = document.querySelector(".html-viewer-frame")
  if (!(root instanceof HTMLElement) || !(iframe instanceof HTMLIFrameElement)) return

  const runName = root.dataset.runName || ""
  const filePath = root.dataset.file || ""
  if (!runName || !filePath) return

  const apiUrl = "/runs/" + encodeURIComponent(runName) + "/html-progress"
  const initialY = Number(root.dataset.scrollY || "0")
  const initialRatio = Number(root.dataset.scrollRatio || "0")
  const DEBOUNCE_MS = 750

  let saveTimer = null
  let inFlight = false
  let queued = null
  let lastSaved = { scrollY: initialY, scrollRatio: initialRatio }
  let suppressSaveUntil = 0
  let boundScrollTarget = null
  let boundDoc = null

  function clampRatio(value) {
    if (!Number.isFinite(value)) return 0
    if (value < 0) return 0
    if (value > 1) return 1
    return value
  }

  function findScrollRoot(doc) {
    const scrolling = doc.scrollingElement || doc.documentElement
    const win = doc.defaultView
    if (scrolling && scrolling.scrollHeight > scrolling.clientHeight + 1) {
      return { kind: "window", win: win, el: scrolling }
    }
    const candidates = Array.from(doc.querySelectorAll("body, body *"))
    let best = null
    let bestOverflow = 0
    for (const el of candidates) {
      if (!(el instanceof HTMLElement)) continue
      const style = win.getComputedStyle(el)
      const overflowY = style.overflowY
      if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") continue
      const overflow = el.scrollHeight - el.clientHeight
      if (overflow > bestOverflow) {
        bestOverflow = overflow
        best = el
      }
    }
    if (best && bestOverflow > 1) {
      return { kind: "element", win: win, el: best }
    }
    return { kind: "window", win: win, el: scrolling }
  }

  function readPosition(target) {
    if (!target || !target.el) {
      return { scrollY: 0, scrollRatio: 0 }
    }
    const scrollY = target.kind === "window"
      ? (target.win ? target.win.scrollY : target.el.scrollTop)
      : target.el.scrollTop
    const maxScroll = Math.max(0, target.el.scrollHeight - target.el.clientHeight)
    const scrollRatio = maxScroll > 0 ? clampRatio(scrollY / maxScroll) : 0
    return {
      scrollY: Number.isFinite(scrollY) ? Math.max(0, scrollY) : 0,
      scrollRatio: scrollRatio,
    }
  }

  function applyPosition(target, scrollY, scrollRatio) {
    if (!target || !target.el) return
    const maxScroll = Math.max(0, target.el.scrollHeight - target.el.clientHeight)
    let y = scrollY
    if (Number.isFinite(scrollRatio) && scrollRatio > 0 && maxScroll > 0) {
      y = scrollRatio * maxScroll
    }
    if (!Number.isFinite(y) || y < 0) y = 0
    if (y > maxScroll) y = maxScroll
    if (target.kind === "window" && target.win) {
      target.win.scrollTo(0, y)
    } else {
      target.el.scrollTop = y
    }
  }

  function samePosition(a, b) {
    return Math.abs(a.scrollY - b.scrollY) < 1 && Math.abs(a.scrollRatio - b.scrollRatio) < 0.0005
  }

  async function persist(position, force) {
    if (!force && Date.now() < suppressSaveUntil) return
    if (!force && samePosition(position, lastSaved)) return
    if (inFlight) {
      queued = position
      return
    }
    inFlight = true
    try {
      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          file: filePath,
          scrollY: position.scrollY,
          scrollRatio: position.scrollRatio,
        }),
        keepalive: true,
      })
      if (!resp.ok) throw new Error("save failed")
      lastSaved = position
    } catch {
      // Best-effort persistence; next scroll/pagehide will retry.
    } finally {
      inFlight = false
      if (queued) {
        const next = queued
        queued = null
        void persist(next, true)
      }
    }
  }

  function scheduleSave(position) {
    if (Date.now() < suppressSaveUntil) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { void persist(position, false) }, DEBOUNCE_MS)
  }

  function flushSave() {
    clearTimeout(saveTimer)
    if (!boundScrollTarget) return
    const position = readPosition(boundScrollTarget)
    void persist(position, true)
  }

  function onScroll() {
    if (!boundScrollTarget) return
    scheduleSave(readPosition(boundScrollTarget))
  }

  function unbindScroll() {
    if (boundScrollTarget) {
      if (boundScrollTarget.kind === "window" && boundScrollTarget.win) {
        boundScrollTarget.win.removeEventListener("scroll", onScroll)
      } else if (boundScrollTarget.el) {
        boundScrollTarget.el.removeEventListener("scroll", onScroll)
      }
    }
    boundScrollTarget = null
    boundDoc = null
  }

  function restoreWithRetries(target, scrollY, scrollRatio) {
    suppressSaveUntil = Date.now() + 1500
    const attempts = [0, 50, 150, 400, 1000]
    for (const delay of attempts) {
      setTimeout(() => {
        applyPosition(target, scrollY, scrollRatio)
      }, delay)
    }
  }

  function bindIframe() {
    const doc = iframe.contentDocument
    if (!doc || !doc.documentElement) return
    unbindScroll()
    const target = findScrollRoot(doc)
    boundScrollTarget = target
    boundDoc = doc
    if (target.kind === "window" && target.win) {
      target.win.addEventListener("scroll", onScroll, { passive: true })
    } else if (target.el) {
      target.el.addEventListener("scroll", onScroll, { passive: true })
    }
    if ((Number.isFinite(initialY) && initialY > 0) || (Number.isFinite(initialRatio) && initialRatio > 0)) {
      restoreWithRetries(target, initialY, initialRatio)
    }
  }

  iframe.addEventListener("load", bindIframe)
  if (iframe.contentDocument?.readyState === "complete") bindIframe()

  window.addEventListener("pagehide", flushSave)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave()
  })
})();
</script>`
