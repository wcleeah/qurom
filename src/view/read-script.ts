export const READ_SCRIPT = /* html */ `
<script>
(function () {
  function parseUnread(value) {
    return value === "true" || value === true
  }
  function currentFilter() {
    const params = new URLSearchParams(window.location.search)
    if (params.get("all") === "1") return "all"
    if (params.get("read") === "1") return "read"
    return "unread"
  }
  function renderReadButton(btn, unread) {
    btn.dataset.unread = unread ? "true" : "false"
    btn.setAttribute("aria-pressed", unread ? "true" : "false")
    btn.setAttribute("aria-label", unread ? "Mark as read" : "Mark as unread")
    btn.classList.toggle("read-button-unread", unread)
    btn.textContent = unread ? "●" : "○"
  }
  function liveReadButton(runName) {
    return Array.from(document.querySelectorAll("[data-read-toggle]")).find(
      (el) => el instanceof HTMLButtonElement && el.dataset.runName === runName,
    )
  }
  function emptyStateHtml(filter) {
    if (filter === "unread") {
      return '<div class="empty-state">No unread runs. <a href="/?read=1">Show read runs</a></div>'
    }
    if (filter === "read") {
      return '<div class="empty-state">No read runs. <a href="/">Show unread runs</a></div>'
    }
    return ""
  }
  document.addEventListener("click", async (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const btn = target.closest("[data-read-toggle]")
    if (!(btn instanceof HTMLButtonElement)) return
    event.preventDefault()
    const runName = btn.dataset.runName
    if (!runName) return
    const currentlyUnread = parseUnread(btn.dataset.unread)
    const markRead = currentlyUnread
    btn.disabled = true
    try {
      const resp = await fetch("/runs/" + encodeURIComponent(runName) + "/read?json=1", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ read: markRead ? "true" : "false" }),
      })
      if (!resp.ok) throw new Error("read toggle failed")
      const data = await resp.json()
      const liveBtn = liveReadButton(runName)
      const targetBtn = liveBtn instanceof HTMLButtonElement ? liveBtn : btn
      renderReadButton(targetBtn, !!data.unread)
      targetBtn.disabled = false
      const filter = currentFilter()
      const card = targetBtn.closest(".run-card")
      const shouldRemove =
        card && (
          (filter === "unread" && !data.unread) ||
          (filter === "read" && data.unread)
        )
      if (shouldRemove) {
        card.remove()
        if (!document.querySelector(".run-card")) {
          const list = document.getElementById("run-card-list")
          const html = emptyStateHtml(filter)
          if (list && html) list.innerHTML = html
        }
      }
    } catch {
      /* keep prior state */
      const liveBtn = liveReadButton(runName)
      if (liveBtn instanceof HTMLButtonElement) liveBtn.disabled = false
      else btn.disabled = false
    }
  })
})()
</script>`
