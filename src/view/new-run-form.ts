import { escapeHtml } from "./utils"

export type NewRunFormOptions = {
  runActive: boolean
  activeRunId?: string
  error?: string
}

const TAB_COPY: Record<string, { hint: string; submit: string }> = {
  topic: {
    hint: "Ask a research question — the quorum will draft, audit, and revise until approved or failed.",
    submit: "Start research",
  },
  document: {
    hint: "Path to a markdown file on the machine running the dashboard.",
    submit: "Start from document",
  },
  resume: {
    hint: "Resume a prior run by directory name or request ID. Append #nodeName to retry from a checkpoint.",
    submit: "Resume research",
  },
  design: {
    hint: "Resume the design quorum for an approved research run.",
    submit: "Resume design",
  },
}

function tabButton(id: string, label: string, active: boolean): string {
  return `<button type="button" class="new-run-tab${active ? " active" : ""}" data-new-run-tab="${id}" role="tab" aria-selected="${active ? "true" : "false"}">${label}</button>`
}

function panelHint(id: string): string {
  return `<p class="new-run-hint">${escapeHtml(TAB_COPY[id]!.hint)}</p>`
}

export function renderNewRunForm(options: NewRunFormOptions): string {
  const disabled = options.runActive ? " disabled" : ""
  const activeNote = options.runActive
    ? `<div class="new-run-active-note"><span class="badge badge-running">● Active run</span><span class="muted-note">${options.activeRunId ? `Finish or <a href="/runs/${escapeHtml(encodeURIComponent(options.activeRunId))}">open the current run</a> before starting another.` : "Wait for the current run to finish before starting another."}</span></div>`
    : ""

  const errorHtml = options.error
    ? `<div class="new-run-error">${escapeHtml(options.error)}</div>`
    : ""

  return `<section class="new-run-section" aria-labelledby="new-run-heading">
  <div class="card new-run-card">
    <div class="new-run-header">
      <div class="new-run-header-text">
        <h2 id="new-run-heading">Start a run</h2>
        <p class="muted-note new-run-subtitle">One active pipeline at a time · providers start on demand</p>
      </div>
      <div class="new-run-tabs" role="tablist" aria-label="Run type">
        ${tabButton("topic", "Topic", true)}
        ${tabButton("document", "Document", false)}
        ${tabButton("resume", "Resume", false)}
        ${tabButton("design", "Design", false)}
      </div>
    </div>
    ${activeNote}
    ${errorHtml}
    <div class="new-run-panels">
      <form class="new-run-panel active config-form" data-new-run-panel="topic" method="POST" action="/api/runs" role="tabpanel">
        ${panelHint("topic")}
        <label class="form-field"><span>Research topic</span>
          <textarea class="form-input new-run-textarea" name="topic" rows="4" placeholder="e.g. Why is 1+1 equal to 2?" required${disabled}></textarea>
        </label>
        <input type="hidden" name="inputMode" value="topic" />
        <div class="form-actions new-run-actions"><button type="submit" class="btn btn-primary"${disabled}>${TAB_COPY.topic.submit}</button></div>
      </form>
      <form class="new-run-panel config-form" data-new-run-panel="document" method="POST" action="/api/runs" role="tabpanel">
        ${panelHint("document")}
        <label class="form-field"><span>Document path</span>
          <input class="form-input" name="documentPath" placeholder="/path/to/document.md" required${disabled} />
        </label>
        <input type="hidden" name="inputMode" value="document" />
        <div class="form-actions new-run-actions"><button type="submit" class="btn btn-primary"${disabled}>${TAB_COPY.document.submit}</button></div>
      </form>
      <form class="new-run-panel config-form" data-new-run-panel="resume" method="POST" action="/api/runs/resume-placeholder" data-resume-form role="tabpanel">
        ${panelHint("resume")}
        <div class="form-fields-grid">
          <label class="form-field"><span>Run ID or directory</span>
            <input class="form-input" name="runId" placeholder="my-topic-abc123" required${disabled} />
          </label>
          <label class="form-field"><span>Node <span class="new-run-optional">optional</span></span>
            <input class="form-input" name="node" placeholder="auditDraft"${disabled} />
          </label>
        </div>
        <div class="form-actions new-run-actions"><button type="submit" class="btn btn-primary"${disabled}>${TAB_COPY.resume.submit}</button></div>
      </form>
      <form class="new-run-panel config-form" data-new-run-panel="design" method="POST" action="/api/runs/design-placeholder" data-design-form role="tabpanel">
        ${panelHint("design")}
        <label class="form-field"><span>Approved run ID</span>
          <input class="form-input" name="runId" placeholder="my-topic-abc123" required${disabled} />
        </label>
        <div class="form-actions new-run-actions"><button type="submit" class="btn btn-primary"${disabled}>${TAB_COPY.design.submit}</button></div>
      </form>
    </div>
  </div>
</section>`
}

export const NEW_RUN_FORM_SCRIPT = /* html */ `
<script>
(function () {
  const tabs = document.querySelectorAll("[data-new-run-tab]")
  const panels = document.querySelectorAll("[data-new-run-panel]")

  function showPanel(name) {
    tabs.forEach((tab) => {
      const active = tab.getAttribute("data-new-run-tab") === name
      tab.classList.toggle("active", active)
      tab.setAttribute("aria-selected", active ? "true" : "false")
    })
    panels.forEach((panel) => {
      const active = panel.getAttribute("data-new-run-panel") === name
      panel.classList.toggle("active", active)
    })
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.getAttribute("data-new-run-tab")
      if (name) showPanel(name)
    })
  })

  const resumeForm = document.querySelector("[data-resume-form]")
  if (resumeForm instanceof HTMLFormElement) {
    resumeForm.addEventListener("submit", (event) => {
      event.preventDefault()
      const runId = new FormData(resumeForm).get("runId")
      const node = new FormData(resumeForm).get("node")
      if (typeof runId !== "string" || !runId.trim()) return
      const encoded = encodeURIComponent(runId.trim())
      resumeForm.action = "/api/runs/" + encoded + "/resume"
      const body = new URLSearchParams()
      if (typeof node === "string" && node.trim()) body.set("node", node.trim())
      fetch(resumeForm.action, { method: "POST", body }).then((resp) => {
        if (resp.redirected) window.location.href = resp.url
        else if (resp.status === 303) {
          const loc = resp.headers.get("Location")
          if (loc) window.location.href = loc
        } else {
          window.location.reload()
        }
      }).catch(() => window.location.reload())
    })
  }

  const designForm = document.querySelector("[data-design-form]")
  if (designForm instanceof HTMLFormElement) {
    designForm.addEventListener("submit", (event) => {
      event.preventDefault()
      const runId = new FormData(designForm).get("runId")
      if (typeof runId !== "string" || !runId.trim()) return
      const encoded = encodeURIComponent(runId.trim())
      designForm.action = "/api/runs/" + encoded + "/design"
      fetch(designForm.action, { method: "POST" }).then((resp) => {
        if (resp.redirected) window.location.href = resp.url
        else if (resp.status === 303) {
          const loc = resp.headers.get("Location")
          if (loc) window.location.href = loc
        } else {
          window.location.reload()
        }
      }).catch(() => window.location.reload())
    })
  }
})()
</script>`
