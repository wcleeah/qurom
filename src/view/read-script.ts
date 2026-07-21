export const READ_SCRIPT = /* html */ `
<script>
(function () {
  function parseUnread(value) {
    return value === "true" || value === true
  }
  function isUnreadFilter() {
    const params = new URLSearchParams(window.location.search)
    return params.get("active") !== "1" && params.get("all") !== "1"
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
      const card = targetBtn.closest(".run-card")
      if (card && isUnreadFilter() && !data.unread) {
        card.remove()
        if (!document.querySelector(".run-card")) {
          const list = document.getElementById("run-card-list")
          if (list) {
            list.innerHTML = '<div class="empty-state">No unread runs. <a href="/?active=1">Show active runs</a></div>'
          }
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
