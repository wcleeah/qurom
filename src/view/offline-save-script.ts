import { OFFLINE_CAPTURE_MAX_MS, OFFLINE_CAPTURE_SETTLE_MS } from "./offline-protocol"

export const HTML_OFFLINE_SAVE_SCRIPT = /* html */ `
<script>
(function () {
  const button = document.querySelector("[data-offline-save]")
  if (!(button instanceof HTMLButtonElement)) return
  const runName = button.dataset.runName || ""
  const filePath = button.dataset.file || ""
  const captureUrl = button.dataset.captureUrl || ""
  if (!runName || !filePath || !captureUrl) return

  const id = (function () {
    const bytes = new TextEncoder().encode(runName + "\\n" + filePath)
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "")
  })()

  function setLabel(label, saving) {
    button.textContent = label
    button.disabled = !!saving
    button.setAttribute("aria-busy", saving ? "true" : "false")
  }

  function callWorker(message) {
    return navigator.serviceWorker.ready.then(function (reg) {
      const worker = reg.active || navigator.serviceWorker.controller
      if (!worker) return Promise.reject(new Error("no worker"))
      return new Promise(function (resolve, reject) {
        const channel = new MessageChannel()
        const timer = setTimeout(function () { reject(new Error("timeout")) }, 8000)
        channel.port1.onmessage = function (event) {
          clearTimeout(timer)
          resolve(event.data)
        }
        worker.postMessage(message, [channel.port2])
      })
    })
  }

  async function ensureWorker() {
    if (!("serviceWorker" in navigator)) throw new Error("unsupported")
    await navigator.serviceWorker.register("/sw.js", { scope: "/" })
    await navigator.serviceWorker.ready
    if (navigator.serviceWorker.controller) return
    await new Promise(function (resolve) {
      navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true })
      setTimeout(resolve, 2000)
    })
  }

  async function markIfSaved() {
    try {
      const data = await callWorker({ type: "offline-list" })
      const snapshots = data && data.snapshots ? data.snapshots : []
      if (snapshots.some(function (row) { return row.id === id })) {
        setLabel("Update saved copy", false)
      }
    } catch {}
  }

  function waitForSaved() {
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        navigator.serviceWorker.removeEventListener("message", onMessage)
        reject(new Error("save timed out"))
      }, ${OFFLINE_CAPTURE_MAX_MS + 1000})
      function onMessage(event) {
        const data = event.data || {}
        if (data.type !== "offline-saved" || !data.snapshot || data.snapshot.id !== id) return
        clearTimeout(timer)
        navigator.serviceWorker.removeEventListener("message", onMessage)
        resolve(data.snapshot)
      }
      navigator.serviceWorker.addEventListener("message", onMessage)
    })
  }

  function scrollCapturedDocument(iframe) {
    const win = iframe.contentWindow
    const doc = iframe.contentDocument
    if (!win || !doc) return
    const scrolling = doc.scrollingElement || doc.documentElement
    const height = Math.max(
      scrolling ? scrolling.scrollHeight : 0,
      doc.documentElement ? doc.documentElement.scrollHeight : 0,
      doc.body ? doc.body.scrollHeight : 0,
    )
    try { win.scrollTo(0, height) } catch {}
    const nodes = doc.querySelectorAll("body, body *")
    for (const el of nodes) {
      if (!(el instanceof HTMLElement)) continue
      if (el.scrollHeight > el.clientHeight + 8) {
        try { el.scrollTop = el.scrollHeight } catch {}
      }
    }
  }

  async function save() {
    setLabel("Saving…", true)
    let iframe = null
    try {
      await ensureWorker()
      const saved = waitForSaved()
      iframe = document.createElement("iframe")
      iframe.className = "offline-capture-frame"
      iframe.title = "Offline capture"
      iframe.setAttribute("aria-hidden", "true")
      iframe.src = captureUrl
      document.body.appendChild(iframe)
      await new Promise(function (resolve, reject) {
        iframe.addEventListener("load", resolve, { once: true })
        iframe.addEventListener("error", function () { reject(new Error("capture failed")) }, { once: true })
      })
      const title = (iframe.contentDocument && iframe.contentDocument.title) || filePath
      const worker = navigator.serviceWorker.controller
      if (worker) worker.postMessage({ type: "offline-title", id: id, title: title })
      scrollCapturedDocument(iframe)
      await new Promise(function (resolve) { setTimeout(resolve, ${OFFLINE_CAPTURE_SETTLE_MS}) })
      try {
        await callWorker({ type: "offline-stop", id: id })
      } catch {
        if (worker) worker.postMessage({ type: "offline-stop", id: id })
      }
      await saved
      setLabel("Saved for offline", false)
      setTimeout(function () { setLabel("Update saved copy", false) }, 1600)
    } catch {
      setLabel("Save failed", false)
      setTimeout(function () { void markIfSaved() }, 1600)
    } finally {
      if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }
  }

  button.addEventListener("click", function () { void save() })
  void markIfSaved()
})();
</script>`
