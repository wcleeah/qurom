import { LIVE_REFRESH_STORAGE_KEY, renderRefreshControls } from "./refresh-controls"

export { LIVE_REFRESH_STORAGE_KEY, renderRefreshControls }

const RUN_DETAIL_SECTION_IDS = [
  "run-controls-section",
  "telemetry-section",
  "round-strip-section",
  "agent-activity-section",
  "node-grid-section",
  "session-telemetry-section",
  "debug-log-section",
  "failure-banner-section",
  "interview-chat-section",
  "markdown-section",
  "final-output-section",
  "design-summary-section",
  "files-section",
]

function buildRefreshScript(options: {
  sectionIds: string[]
  defaultAutoRefresh: boolean
}): string {
  const idsJson = JSON.stringify(options.sectionIds)
  const defaultAutoRefresh = options.defaultAutoRefresh
  const storageKey = LIVE_REFRESH_STORAGE_KEY

  return /* html */ `
<script>
(function () {
  const IDs = ${idsJson}
  const STORAGE_KEY = ${JSON.stringify(storageKey)}
  const DEFAULT_AUTO = ${defaultAutoRefresh}
  let timer
  let nextDelay = 8000
  let inFlight = false
  let autoRefresh = readAutoRefresh()
  let interviewPause = false
  /** After a successful reply, keep polling until the interview form leaves the page. */
  let resumeAfterInterviewSubmit = false
  const refreshDot = () => document.getElementById("refresh-dot")
  const refreshStatus = () => document.getElementById("refresh-status")
  const refreshToggle = () => document.getElementById("refresh-auto-toggle")

  function readAutoRefresh() {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "on") return true
    if (stored === "off") return false
    return DEFAULT_AUTO
  }

  function writeAutoRefresh(enabled) {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off")
  }

  function syncToggle() {
    const toggle = refreshToggle()
    if (toggle instanceof HTMLInputElement) toggle.checked = autoRefresh
  }

  function offStatusText() {
    return "Live refresh off · click Refresh now to update"
  }

  function interviewPausedStatusText() {
    return "Live refresh paused during interview"
  }

  function hasInterviewReplyForm() {
    const interviewEl = document.getElementById("interview-chat-section")
    return !!(interviewEl && interviewEl.querySelector("form[data-interview-reply-form]"))
  }

  function syncInterviewPause() {
    const hasForm = hasInterviewReplyForm()
    if (resumeAfterInterviewSubmit) {
      if (!hasForm) resumeAfterInterviewSubmit = false
      interviewPause = false
      return false
    }
    interviewPause = hasForm
    return interviewPause
  }

  function setStatus(text, polling) {
    const status = refreshStatus()
    if (status) status.textContent = text
    const dot = refreshDot()
    if (dot) dot.classList.toggle("polling", !!polling)
  }

  function interviewSectionShouldSkipSwap(oldEl, newEl) {
    if (!oldEl) return false
    const newForm = newEl?.querySelector("form[data-interview-reply-form]")
    const oldForm = oldEl.querySelector("form[data-interview-reply-form]")
    if (oldForm && !newForm) return false
    if (!newForm) return false
    const oldTurn = oldEl.dataset.interviewTurn
    const newTurn = newEl?.dataset?.interviewTurn
    if (oldTurn !== newTurn) return false
    const hasFocus = oldEl.contains(document.activeElement)
    const hasContent = Array.from(oldEl.querySelectorAll("textarea, input")).some(
      (el) => el.value && el.value.trim().length > 0,
    )
    return hasFocus || hasContent
  }

  function sectionShouldSkipSwap(id, oldEl, newEl) {
    if (!oldEl) return false
    if (id === "interview-chat-section") {
      return interviewSectionShouldSkipSwap(oldEl, newEl)
    }
    if (id === "node-dashboard-section" && oldEl.querySelector("details[open]")) {
      return true
    }
    return false
  }

  function scheduleNextPoll() {
    clearTimeout(timer)
    if (!autoRefresh) {
      setStatus(offStatusText(), false)
      return
    }
    if (interviewPause || syncInterviewPause()) {
      setStatus(interviewPausedStatusText(), false)
      return
    }
    timer = setTimeout(() => poll(false), nextDelay)
    const status = refreshStatus()
    if (status) {
      const nextText = "next refresh in " + Math.round(nextDelay / 1000) + "s"
      status.textContent = status.textContent.startsWith("Updated")
        ? status.textContent + " · " + nextText
        : "Next refresh in " + Math.round(nextDelay / 1000) + "s"
    }
  }

  function preserveInFlightRead(oldHeader, newHeaderRoot) {
    const oldRead = oldHeader.querySelector("[data-read-toggle]")
    const newRead = newHeaderRoot.querySelector("[data-read-toggle]")
    if (!(oldRead instanceof HTMLButtonElement) || !(newRead instanceof HTMLButtonElement)) return
    if (!oldRead.disabled) return
    newRead.dataset.unread = oldRead.dataset.unread || "false"
    newRead.setAttribute("aria-pressed", oldRead.getAttribute("aria-pressed") || "false")
    newRead.setAttribute("aria-label", oldRead.getAttribute("aria-label") || "Mark as unread")
    newRead.classList.toggle("read-button-unread", oldRead.classList.contains("read-button-unread"))
    newRead.textContent = oldRead.textContent || "○"
    newRead.disabled = true
  }

  async function poll(manual) {
    if (inFlight) return
    if (!manual && (interviewPause || syncInterviewPause())) {
      setStatus(interviewPausedStatusText(), false)
      return
    }
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
        if (id === "interview-chat-section" && oldEl && sectionShouldSkipSwap(id, oldEl, newEl) && newEl) {
          continue
        }
        if (sectionShouldSkipSwap(id, oldEl, newEl)) continue
        if (oldEl && newEl) {
          oldEl.innerHTML = newEl.innerHTML
          if (id === "round-strip-section" && typeof window.__quorumInitRoundTabs === "function") {
            window.__quorumInitRoundTabs()
          }
          if ((id === "node-dashboard-section" || id === "node-round-strip-section")
            && typeof window.__quorumInitRoundTabs === "function") {
            window.__quorumInitRoundTabs()
          }
        } else if (oldEl && !newEl) {
          oldEl.innerHTML = ""
        }
      }
      const oldHeader = document.querySelector(".header-bar")
      const newHeader = doc.querySelector(".header-bar")
      if (oldHeader && newHeader) {
        preserveInFlightRead(oldHeader, newHeader)
        oldHeader.innerHTML = newHeader.innerHTML
      }
      setStatus("Updated " + new Date().toLocaleTimeString(), false)
    } catch {
      setStatus("Refresh failed; retrying", false)
    } finally {
      inFlight = false
    }
    syncInterviewPause()
    nextDelay = resumeAfterInterviewSubmit ? 1500 : 8000
    if (autoRefresh) {
      scheduleNextPoll()
    } else if (manual) {
      const status = refreshStatus()
      if (status && status.textContent.startsWith("Updated")) {
        status.textContent = status.textContent.split(" · ")[0] + " · " + offStatusText()
      }
    }
  }

  function setAutoRefresh(enabled) {
    autoRefresh = enabled
    writeAutoRefresh(enabled)
    syncToggle()
    clearTimeout(timer)
    if (enabled) {
      if (syncInterviewPause()) {
        setStatus(interviewPausedStatusText(), false)
        return
      }
      void poll(false)
    } else {
      setStatus(offStatusText(), false)
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target
    if (target && target instanceof Element && target.closest("[data-refresh-now]")) {
      event.preventDefault()
      void poll(true)
    }
  })

  document.addEventListener("change", (event) => {
    const target = event.target
    if (target instanceof HTMLInputElement && target.matches("[data-refresh-toggle]")) {
      setAutoRefresh(target.checked)
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
      resumeAfterInterviewSubmit = true
      interviewPause = false
      void poll(true)
    } catch {
      setStatus("Answer send failed", false)
      if (submit) submit.removeAttribute("disabled")
    }
  })

  syncToggle()
  if (autoRefresh) {
    if (syncInterviewPause()) {
      setStatus(interviewPausedStatusText(), false)
    } else {
      void poll(false)
    }
  } else {
    setStatus(offStatusText(), false)
  }
})()
</script>`
}

/** Auto-polling for the run overview page. */
export const POLLING_SCRIPT = buildRefreshScript({
  sectionIds: RUN_DETAIL_SECTION_IDS,
  defaultAutoRefresh: true,
})

/** Live refresh for node detail pages. */
export const NODE_REFRESH_SCRIPT = buildRefreshScript({
  sectionIds: ["node-controls-section", "node-round-strip-section", "node-live-section", "node-dashboard-section"],
  defaultAutoRefresh: true,
})

/** Live refresh for the run files browser. */
export const FILES_REFRESH_SCRIPT = buildRefreshScript({
  sectionIds: ["files-section"],
  defaultAutoRefresh: true,
})

/** Live refresh for the runs index active-run hero. */
export const INDEX_REFRESH_SCRIPT = buildRefreshScript({
  sectionIds: ["index-active-section"],
  defaultAutoRefresh: true,
})

/** @deprecated Use NODE_REFRESH_SCRIPT */
export const NODE_MANUAL_REFRESH_SCRIPT = NODE_REFRESH_SCRIPT

/** Tab switching for research round scope on run and node pages. */
export const ROUND_TABS_SCRIPT = /* html */ `
<script>
(function () {
  function roundTabStorageKey(strip) {
    const runName = strip instanceof HTMLElement ? strip.getAttribute("data-run-round-tabs") : null
    if (runName) return "research-round-tab:/runs/" + runName
    return "round-tab:" + window.location.pathname
  }

  function applyRoundTab(roundNum, strip) {
    const scope = strip ?? document.querySelector("[data-round-tablist]")
    if (!(scope instanceof HTMLElement)) return

    scope.querySelectorAll("[data-round-tab]").forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return
      const active = btn.getAttribute("data-round-tab") === String(roundNum)
      btn.classList.toggle("active", active)
      btn.setAttribute("aria-selected", active ? "true" : "false")
    })
    document.querySelectorAll("[data-round-panel]").forEach((panel) => {
      if (!(panel instanceof HTMLElement)) return
      panel.hidden = panel.getAttribute("data-round-panel") !== String(roundNum)
    })
  }

  function initRoundTabs() {
    const strip = document.querySelector("[data-round-tablist]")
    if (!(strip instanceof HTMLElement)) return
    let selected = sessionStorage.getItem(roundTabStorageKey(strip))
    if (!selected || !document.querySelector('[data-round-panel="' + selected + '"]')) {
      const activeBtn = strip.querySelector("[data-round-tab].active")
      selected = activeBtn?.getAttribute("data-round-tab")
        ?? strip.querySelector("[data-round-tab]")?.getAttribute("data-round-tab")
    }
    if (selected) applyRoundTab(selected, strip)
  }

  document.addEventListener("click", (event) => {
    const btn = event.target instanceof Element ? event.target.closest("[data-round-tab]") : null
    if (!(btn instanceof HTMLButtonElement)) return
    const strip = btn.closest("[data-round-tablist]")
    if (!(strip instanceof HTMLElement)) return
    event.preventDefault()
    const round = btn.getAttribute("data-round-tab")
    if (!round) return
    sessionStorage.setItem(roundTabStorageKey(strip), round)
    applyRoundTab(round, strip)
  })

  window.__quorumInitRoundTabs = initRoundTabs
  initRoundTabs()
})()
</script>`
