import { escapeHtml } from "./utils"
import type { RunStatus } from "./types"

export type RunResumeActions = {
  showResume: boolean
  showRestartFromSource: boolean
}

export function resolveRunResumeActions(input: {
  isRunning: boolean
  hasFinalMd: boolean
  hasFinalHtml: boolean
  hasInputMd: boolean
  designStatus?: RunStatus | "running" | null
}): RunResumeActions {
  if (input.isRunning) {
    return { showResume: false, showRestartFromSource: false }
  }

  const showResume =
    !input.hasFinalMd
    || (input.hasFinalMd && !input.hasFinalHtml && input.designStatus !== "approved")

  return {
    showResume,
    showRestartFromSource: input.hasInputMd,
  }
}

export function renderRunCancelButton(runName: string): string {
  return `<form class="run-action-form" method="POST" action="/api/runs/${encodeURIComponent(runName)}/cancel">
  <button type="submit" class="btn btn-secondary">Cancel run</button>
</form>`
}

function renderResumeForm(runName: string, disabled: boolean): string {
  return `<form class="run-action-form" method="POST" action="/api/runs/${encodeURIComponent(runName)}/resume">
  <button type="submit" class="btn btn-primary"${disabled ? " disabled" : ""}>Resume run</button>
</form>`
}

function renderRestartFromSourceForm(runName: string, disabled: boolean): string {
  return `<form class="run-action-form" method="POST" action="/api/runs/${encodeURIComponent(runName)}/restart-from-source">
  <button type="submit" class="btn btn-secondary"${disabled ? " disabled" : ""}>New run from source document</button>
</form>`
}

function renderArchiveForm(runName: string): string {
  return `<form class="run-action-form" method="POST" action="/api/runs/${encodeURIComponent(runName)}/archive">
  <button type="submit" class="btn btn-secondary">Archive run</button>
</form>`
}

export function renderRunActionStrip(
  runName: string,
  actions: RunResumeActions,
  options?: { runActiveGlobally?: boolean; showArchive?: boolean },
): string {
  const showArchive = options?.showArchive === true
  if (!actions.showResume && !actions.showRestartFromSource && !showArchive) return ""

  const disabled = options?.runActiveGlobally === true
  const busyNote = disabled
    ? `<p class="muted-note dim-text run-actions-note">Another run is active — wait for it to finish first.</p>`
    : ""

  const continueButtons = [
    actions.showResume ? renderResumeForm(runName, disabled) : "",
    actions.showRestartFromSource ? renderRestartFromSourceForm(runName, disabled) : "",
  ].filter(Boolean).join("\n")

  const archiveButtons = showArchive ? renderArchiveForm(runName) : ""

  const sections: string[] = []
  if (continueButtons) {
    sections.push(`<span class="run-actions-label">Continue this run</span>
  <div class="run-actions-buttons">${continueButtons}</div>
  ${busyNote}`)
  }
  if (archiveButtons) {
    sections.push(`<span class="run-actions-label">Manage</span>
  <div class="run-actions-buttons">${archiveButtons}</div>`)
  }

  return `<div class="run-actions">
  ${sections.join("\n  ")}
</div>`
}

export function renderRunControlsSection(input: {
  runName: string
  isRunning: boolean
  showCompletion: boolean
  completionHtml: string
  resumeActions: RunResumeActions
  runActiveGlobally: boolean
}): string {
  const cancelHtml = input.isRunning ? renderRunCancelButton(input.runName) : ""
  const actionsHtml = input.isRunning
    ? ""
    : renderRunActionStrip(input.runName, input.resumeActions, {
      runActiveGlobally: input.runActiveGlobally,
      showArchive: true,
    })
  const completionHtml = input.showCompletion ? input.completionHtml : ""

  if (!cancelHtml && !actionsHtml && !completionHtml) {
    return `<div id="run-controls-section" class="run-controls-section"></div>`
  }

  return `<div id="run-controls-section" class="run-controls-section">
  ${cancelHtml}
  ${actionsHtml}
  ${completionHtml}
</div>`
}

export function renderRunCompletionBanner(input: {
  errored: boolean
  verdictText: string
  outputDir?: string
}): string {
  const cls = input.errored ? "failed" : "approved"
  return `<div class="run-completion-banner">
  <div class="outcome-banner ${escapeHtml(cls)}">${escapeHtml(input.verdictText)}</div>
  ${input.outputDir ? `<p class="muted-note dim-text">Output: ${escapeHtml(input.outputDir)}</p>` : ""}
  <p><a class="hero-link" href="/">Start another run →</a></p>
</div>`
}

export function resolveRunVerdict(input: {
  researchStatus: string
  designStatus?: string | null
  liveError?: string
  hasFailureJson?: boolean
}): { errored: boolean; verdictText: string } {
  const VERDICT_LABEL: Record<string, string> = {
    approved: "Approved",
    failed: "Failed",
    approved_with_caveats: "Approved with caveats",
  }

  if (input.liveError) {
    return { errored: true, verdictText: `Run errored: ${input.liveError}` }
  }

  if (input.designStatus === "approved") {
    return { errored: false, verdictText: "Research approved · Design complete" }
  }
  if (input.designStatus === "failed") {
    return { errored: true, verdictText: "Research approved · Design failed (best-effort HTML saved)" }
  }
  if (input.researchStatus === "approved") {
    return { errored: false, verdictText: `Research ${VERDICT_LABEL.approved}` }
  }
  if (input.researchStatus === "failed" || input.hasFailureJson) {
    return { errored: true, verdictText: `Research ${VERDICT_LABEL.failed}` }
  }

  return { errored: false, verdictText: "Run complete" }
}
