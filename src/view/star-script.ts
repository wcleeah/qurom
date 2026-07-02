export const STAR_SCRIPT = /* html */ `
<script>
(function () {
  function parseStarred(value) {
    return value === "true" || value === true
  }
  function renderStarButton(btn, starred) {
    btn.dataset.starred = starred ? "true" : "false"
    btn.setAttribute("aria-pressed", starred ? "true" : "false")
    btn.setAttribute("aria-label", starred ? "Unstar run" : "Star run")
    btn.classList.toggle("star-button-active", starred)
  }
  document.addEventListener("click", async (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const btn = target.closest("[data-star-toggle]")
    if (!(btn instanceof HTMLButtonElement)) return
    event.preventDefault()
    const runName = btn.dataset.runName
    if (!runName) return
    const nextStarred = !parseStarred(btn.dataset.starred)
    btn.disabled = true
    try {
      const resp = await fetch("/runs/" + encodeURIComponent(runName) + "/star?json=1", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ starred: nextStarred ? "true" : "false" }),
      })
      if (!resp.ok) throw new Error("star failed")
      const data = await resp.json()
      renderStarButton(btn, !!data.starred)
      const card = btn.closest(".run-card")
      if (card && new URLSearchParams(window.location.search).get("starred") === "1" && !data.starred) {
        card.remove()
        if (!document.querySelector(".run-card")) {
          const list = document.getElementById("run-card-list")
          if (list) {
            list.innerHTML = '<div class="empty-state">No starred runs yet. <a href="/">Show all runs</a></div>'
          }
        }
      }
    } catch {
      /* keep prior state */
    } finally {
      btn.disabled = false
    }
  })
})()
</script>`
