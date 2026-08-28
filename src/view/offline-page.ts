import { layout } from "./layout"

export const OFFLINE_LIST_SCRIPT = /* html */ `
<script>
(function () {
  const list = document.getElementById("offline-snapshot-list")
  if (!(list instanceof HTMLElement)) return
  if (!("serviceWorker" in navigator)) {
    list.innerHTML = '<div class="empty-state">Offline saving needs a browser with service workers (HTTPS or localhost).</div>'
    return
  }

  function callWorker(message) {
    return navigator.serviceWorker.ready.then(function (reg) {
      const worker = reg.active
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

  function formatSaved(iso) {
    const ms = Date.parse(iso)
    if (!Number.isFinite(ms)) return ""
    return new Date(ms).toLocaleString()
  }

  function viewHref(snapshot) {
    return snapshot.documentUrl + (snapshot.documentUrl.indexOf("?") >= 0 ? "&" : "?") + "offline=" + encodeURIComponent(snapshot.id)
  }

  function render(snapshots) {
    if (!snapshots || snapshots.length === 0) {
      list.innerHTML = '<div class="empty-state">Nothing saved yet. Open a designed HTML page and use <strong>Save for offline</strong>.</div>'
      return
    }
    list.innerHTML = snapshots.map(function (snapshot) {
      const title = snapshot.title || snapshot.filePath
      const meta = [snapshot.runName, snapshot.filePath, formatSaved(snapshot.savedAt), snapshot.resourceCount ? snapshot.resourceCount + " files" : ""]
        .filter(Boolean)
        .map(function (part) { return '<span>' + escapeHtml(part) + '</span>' })
        .join('<span aria-hidden="true"> · </span>')
      return '<article class="card offline-item">' +
        '<a class="offline-item-link" href="' + escapeHtml(viewHref(snapshot)) + '">' +
          '<h2 class="offline-item-title">' + escapeHtml(title) + '</h2>' +
          '<div class="offline-item-meta tiny-text muted-text">' + meta + '</div>' +
        '</a>' +
        '<button type="button" class="offline-item-delete" data-offline-delete="' + escapeHtml(snapshot.id) + '">Remove</button>' +
      '</article>'
    }).join("")
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  }

  async function refresh() {
    try {
      const data = await callWorker({ type: "offline-list" })
      render(data && data.snapshots ? data.snapshots : [])
    } catch {
      list.innerHTML = '<div class="empty-state">Could not read saved pages. Open this site online once so the offline worker can install.</div>'
    }
  }

  list.addEventListener("click", async function (event) {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest("[data-offline-delete]")
    if (!(button instanceof HTMLButtonElement)) return
    const id = button.getAttribute("data-offline-delete")
    if (!id) return
    button.disabled = true
    try {
      await callWorker({ type: "offline-delete", id: id })
      await refresh()
    } catch {
      button.disabled = false
    }
  })

  void refresh()
})();
</script>`

export function renderOfflinePage(): Response {
  const body = `<div class="offline-page">
  <p class="eyebrow">This device</p>
  <h1>Offline</h1>
  <p class="lede">Saved designed pages, recorded from their first load (including CDN CSS and JS). Opening a page shows the raw HTML snapshot, not the reader chrome.</p>
  <div id="offline-snapshot-list" class="offline-list" aria-live="polite">
    <div class="empty-state">Loading saved pages…</div>
  </div>
</div>
${OFFLINE_LIST_SCRIPT}`
  return new Response(
    layout("Offline — quorum", body, { navbar: { section: "offline" } }),
    { headers: { "content-type": "text/html; charset=utf-8" } },
  )
}
