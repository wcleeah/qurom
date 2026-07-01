export const POLLING_SCRIPT = /* html */ `
<script>
(function () {
  const IDs = [
    "pipeline-section",
    "agent-activity-section",
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
      // Never replace the interview chat section while the user is interactively
      // typing in it — replacing innerHTML would recreate the <textarea> DOM nodes
      // and wipe in-progress input. Skip the swap if any input/textarea inside
      // the section has focus OR has a non-empty value. A swap still fires once
      // the user clears the field / blurs, and once they submit the 303 redirect
      // does a full page reload anyway. A pending interview still keeps a fast
      // poll interval (see the bottom of this script) so when the user submits
      // and the runner consumes the reply, the next page load reflects it.
      if (id === "interview-chat-section" && oldEl) {
        const hasFocus = oldEl.contains(document.activeElement)
        const hasContent = Array.from(oldEl.querySelectorAll("textarea, input")).some(
          (el) => (el).value && (el).value.trim().length > 0,
        )
        if (hasFocus || hasContent) {
          // Skip replacing this cycle but still let the interview disappear if the
          // fresh render shows no interview (interview concluded) — only skip when
          // the fresh render ALSO has the interview.
          if (newEl) continue
          // No interview in the fresh render and the user has unsaved input: this
          // shouldn't normally happen (submit clears the form via 303 reload),
          // but be safe and preserve the input rather than wipe it.
          continue
        }
      }
      if (oldEl && newEl) {
        oldEl.innerHTML = newEl.innerHTML
      } else if (oldEl && !newEl) {
        // The section disappeared from the fresh render — clear the stale DOM.
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
  // Adaptive interval: poll fast while a reader-interview reply is pending
  // (so the form clears within ~1.5s of submit once the runner consumes
  // reader-reply.json), and slow otherwise (the 8s default for long audit
  // rounds is fine).
  const interviewEl = document.getElementById("interview-chat-section")
  const interviewPending = !!(interviewEl && interviewEl.querySelector("form"))
  nextDelay = interviewPending ? 1500 : 8000
  timer = setTimeout(() => poll(false), nextDelay)
  const status = refreshStatus()
  if (status) {
    const nextText = "next refresh in " + Math.round(nextDelay / 1000) + "s"
    status.textContent = status.textContent.startsWith("Updated")
      ? status.textContent + " · " + nextText
      : "Next refresh in " + Math.round(nextDelay / 1000) + "s"
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
  void poll(false)
})()
</script>`
