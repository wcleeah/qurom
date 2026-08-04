import { escapeHtml } from "./utils"
import { sharePathForToken, type ShareLink } from "./share-store"

export function renderSharePanel(runName: string, link: ShareLink | null): string {
  const encodedRun = escapeHtml(runName)
  if (!link) {
    return `<div class="share-panel" data-share-panel data-run-name="${encodedRun}">
  <button type="button" class="btn btn-primary" data-share-create>Create share link</button>
  <p class="tiny-text muted-text share-status" data-share-status></p>
</div>`
  }

  const path = sharePathForToken(link.token)
  return `<div class="share-panel" data-share-panel data-run-name="${encodedRun}" data-share-token="${escapeHtml(link.token)}">
  <div class="share-active">
    <a class="hero-link share-url" href="${escapeHtml(path)}" target="_blank" rel="noopener" data-share-url>${escapeHtml(path)}</a>
    <div class="share-actions">
      <button type="button" class="btn" data-share-copy>Copy link</button>
      <button type="button" class="btn btn-secondary" data-share-revoke>Revoke</button>
    </div>
  </div>
  <p class="tiny-text muted-text share-status" data-share-status></p>
</div>`
}

export const SHARE_SCRIPT = /* html */ `
<script>
(function () {
  function panelOf(el) {
    return el.closest("[data-share-panel]")
  }

  function setStatus(panel, message) {
    const status = panel.querySelector("[data-share-status]")
    if (status) status.textContent = message || ""
  }

  function renderActive(panel, url) {
    panel.dataset.shareToken = url.split("/").pop() || ""
    panel.innerHTML =
      '<div class="share-active">' +
        '<a class="hero-link share-url" href="' + url + '" target="_blank" rel="noopener" data-share-url>' + url + '</a>' +
        '<div class="share-actions">' +
          '<button type="button" class="btn" data-share-copy>Copy link</button>' +
          '<button type="button" class="btn btn-secondary" data-share-revoke>Revoke</button>' +
        '</div>' +
      '</div>' +
      '<p class="tiny-text muted-text share-status" data-share-status></p>'
  }

  function renderEmpty(panel) {
    delete panel.dataset.shareToken
    panel.innerHTML =
      '<button type="button" class="btn btn-primary" data-share-create>Create share link</button>' +
      '<p class="tiny-text muted-text share-status" data-share-status></p>'
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
    const input = document.createElement("input")
    input.value = text
    document.body.appendChild(input)
    input.select()
    document.execCommand("copy")
    input.remove()
  }

  document.addEventListener("click", async (event) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const createBtn = target.closest("[data-share-create]")
    if (createBtn instanceof HTMLButtonElement) {
      const panel = panelOf(createBtn)
      if (!(panel instanceof HTMLElement)) return
      const runName = panel.dataset.runName
      if (!runName) return
      createBtn.disabled = true
      setStatus(panel, "Creating…")
      try {
        const resp = await fetch("/api/runs/" + encodeURIComponent(runName) + "/share", {
          method: "POST",
          headers: { Accept: "application/json" },
        })
        const data = await resp.json()
        if (!resp.ok) throw new Error(data.error || "Create failed")
        renderActive(panel, data.url)
        setStatus(panel, "Share link ready")
      } catch (err) {
        setStatus(panel, err instanceof Error ? err.message : "Create failed")
        createBtn.disabled = false
      }
      return
    }

    const copyBtn = target.closest("[data-share-copy]")
    if (copyBtn instanceof HTMLButtonElement) {
      const panel = panelOf(copyBtn)
      if (!(panel instanceof HTMLElement)) return
      const anchor = panel.querySelector("[data-share-url]")
      const path = anchor instanceof HTMLAnchorElement ? anchor.getAttribute("href") : null
      if (!path) return
      try {
        await copyText(new URL(path, window.location.origin).href)
        setStatus(panel, "Copied")
      } catch {
        setStatus(panel, "Copy failed")
      }
      return
    }

    const revokeBtn = target.closest("[data-share-revoke]")
    if (revokeBtn instanceof HTMLButtonElement) {
      const panel = panelOf(revokeBtn)
      if (!(panel instanceof HTMLElement)) return
      const runName = panel.dataset.runName
      if (!runName) return
      if (!window.confirm("Revoke this share link? Anyone with the old URL will lose access.")) return
      revokeBtn.disabled = true
      setStatus(panel, "Revoking…")
      try {
        const resp = await fetch("/api/runs/" + encodeURIComponent(runName) + "/share", {
          method: "DELETE",
          headers: { Accept: "application/json" },
        })
        const data = await resp.json()
        if (!resp.ok) throw new Error(data.error || "Revoke failed")
        renderEmpty(panel)
        setStatus(panel, "Share link revoked")
      } catch (err) {
        setStatus(panel, err instanceof Error ? err.message : "Revoke failed")
        revokeBtn.disabled = false
      }
    }
  })
})()
</script>`
