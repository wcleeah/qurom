const DEFAULT_POLL_SECTION_IDS = [
  "telemetry-section",
  "pipeline-section",
  "round-strip-section",
  "agent-activity-section",
  "node-grid-section",
  "node-history-section",
  "debug-log-section",
  "failure-banner-section",
  "interview-chat-section",
  "markdown-section",
  "stats-section",
  "hero-section",
  "key-outputs-section",
  "phase-section",
  "design-summary-section",
  "files-section",
]

function buildRefreshScript(options: {
  sectionIds: string[]
  autoStart: boolean
  initialStatus: string
}): string {
  const idsJson = JSON.stringify(options.sectionIds)
  const autoStart = options.autoStart
  const initialStatus = options.initialStatus

  return /* html */ `
<script>
(function () {
  const IDs = ${idsJson}
  let timer
  let nextDelay = 8000
  let inFlight = false
  const refreshDot = () => document.getElementById("refresh-dot")
  const refreshStatus = () => document.getElementById("refresh-status")
  function setStatus(text, polling) {
    const status = refreshStatus()
    if (status) status.textContent = text
    const dot = refreshDot()
    if (dot) dot.classList.toggle("polling", !!polling)
  }
  function sectionShouldSkipSwap(id, oldEl) {
    if (!oldEl) return false
    if (id === "interview-chat-section") {
      const hasFocus = oldEl.contains(document.activeElement)
      const hasContent = Array.from(oldEl.querySelectorAll("textarea, input")).some(
        (el) => el.value && el.value.trim().length > 0,
      )
      if (hasFocus || hasContent) return true
    }
    if (id === "node-dashboard-section" && oldEl.querySelector("details[open]")) {
      return true
    }
    return false
  }
  async function poll(manual) {
    if (inFlight) return
    inFlight = true
    clearTimeout(timer)
    setStatus(manual ? "Refreshing..." : "Polling...", true)
    try {
      const resp = await fetch(window.location.href, { cache: "no-store" })
      if (!resp.ok) throw new Error("refresh failed")
      const html = await resp.text()
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, "text/html")
      for (const id of IDs) {
        const oldEl = document.getElementById(id)
        const newEl = doc.getElementById(id)
        if (id === "interview-chat-section" && oldEl && sectionShouldSkipSwap(id, oldEl) && newEl) {
          continue
        }
        if (sectionShouldSkipSwap(id, oldEl)) continue
        if (oldEl && newEl) {
          oldEl.innerHTML = newEl.innerHTML
        } else if (oldEl && !newEl) {
          oldEl.innerHTML = ""
        }
      }
      const oldHeader = document.querySelector(".header-bar")
      const newHeader = doc.querySelector(".header-bar")
      if (oldHeader && newHeader) {
        oldHeader.innerHTML = newHeader.innerHTML
      }
      setStatus("Updated " + new Date().toLocaleTimeString(), false)
    } catch {
      setStatus("Refresh failed; retrying", false)
    } finally {
      inFlight = false
    }
    const interviewEl = document.getElementById("interview-chat-section")
    const interviewPending = !!(interviewEl && interviewEl.querySelector("form"))
    nextDelay = interviewPending ? 1500 : 8000
    if (${autoStart}) {
      timer = setTimeout(() => poll(false), nextDelay)
      const status = refreshStatus()
      if (status) {
        const nextText = "next refresh in " + Math.round(nextDelay / 1000) + "s"
        status.textContent = status.textContent.startsWith("Updated")
          ? status.textContent + " · " + nextText
          : "Next refresh in " + Math.round(nextDelay / 1000) + "s"
      }
    } else if (manual) {
      const status = refreshStatus()
      if (status && status.textContent.startsWith("Updated")) {
        status.textContent = status.textContent.split(" · ")[0]
      }
    }
  }
  document.addEventListener("click", (event) => {
    const target = event.target
    if (target && target instanceof Element && target.closest("[data-refresh-now]")) {
      event.preventDefault()
      void poll(true)
    }
  })
  document.addEventListener("submit", async (event) => {
    const form = event.target
    if (!(form instanceof HTMLFormElement) || !form.matches("[data-interview-reply-form]")) return
    event.preventDefault()
    const submit = form.querySelector("button[type=submit]")
    if (submit) submit.setAttribute("disabled", "disabled")
    setStatus("Sending answer...", true)
    try {
      const resp = await fetch(form.action, {
        method: "POST",
        body: new URLSearchParams(new FormData(form)),
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        redirect: "manual",
      })
      if (!resp.ok && resp.status !== 0 && resp.status !== 303) throw new Error("reply failed")
      form.reset()
      history.replaceState(history.state, "", window.location.pathname)
      void poll(true)
    } catch {
      setStatus("Answer send failed", false)
      if (submit) submit.removeAttribute("disabled")
    }
  })
  const status = refreshStatus()
  if (status) status.textContent = ${JSON.stringify(initialStatus)}
  ${autoStart ? "void poll(false)" : ""}
})()
</script>`
}

/** Auto-polling for the run overview page. */
export const POLLING_SCRIPT = buildRefreshScript({
  sectionIds: DEFAULT_POLL_SECTION_IDS,
  autoStart: true,
  initialStatus: "Polling every 8s",
})

/** Manual refresh only — updates live agent activity, not the readable dashboard body. */
export const NODE_MANUAL_REFRESH_SCRIPT = buildRefreshScript({
  sectionIds: ["node-live-section", "node-history-section"],
  autoStart: false,
  initialStatus: "Auto-refresh off · click Refresh to update live activity",
})
