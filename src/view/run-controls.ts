import { escapeHtml } from "./utils"
import type { RunStatus } from "./types"

export type RunResumeActions = {
  showResumeResearch: boolean
  showResumeDesign: boolean
}

export function resolveRunResumeActions(input: {
  isRunning: boolean
  hasFinalMd: boolean
  hasFinalHtml: boolean
  designStatus?: RunStatus | "running" | null
}): RunResumeActions {
  if (input.isRunning) {
    return { showResumeResearch: false, showResumeDesign: false }
  }

  return {
    showResumeResearch: !input.hasFinalMd,
    showResumeDesign: input.hasFinalMd && !input.hasFinalHtml && input.designStatus !== "approved",
  }
}

export function renderRunCancelButton(runName: string): string {
  return `<form class="run-action-form" method="POST" action="/api/runs/${encodeURIComponent(runName)}/cancel">
  <button type="submit" class="btn btn-secondary">Cancel run</button>
</form>`
}

function renderResumeResearchForm(runName: string, disabled: boolean): string {
  return `<form class="run-action-form" method="POST" action="/api/runs/${encodeURIComponent(runName)}/resume">
  <button type="submit" class="btn btn-primary"${disabled ? " disabled" : ""}>Resume research</button>
</form>`
}

function renderResumeDesignForm(runName: string, disabled: boolean): string {
  return `<form class="run-action-form" method="POST" action="/api/runs/${encodeURIComponent(runName)}/design">
  <button type="submit" class="btn btn-primary"${disabled ? " disabled" : ""}>Resume design</button>
</form>`
}

export function renderNodeRetryButton(runName: string, nodeName: string, disabled: boolean): string {
  return `<form class="run-action-form" method="POST" action="/api/runs/${encodeURIComponent(runName)}/resume">
  <input type="hidden" name="node" value="${escapeHtml(nodeName)}" />
  <button type="submit" class="btn btn-secondary"${disabled ? " disabled" : ""}>Retry from this node</button>
</form>`
}

export function renderRunActionStrip(
  runName: string,
  actions: RunResumeActions,
  options?: { runActiveGlobally?: boolean },
): string {
  if (!actions.showResumeResearch && !actions.showResumeDesign) return ""

  const disabled = options?.runActiveGlobally === true
  const busyNote = disabled
    ? `<p class="muted-note dim-text run-actions-note">Another run is active — wait for it to finish first.</p>`
    : ""

  const buttons = [
    actions.showResumeResearch ? renderResumeResearchForm(runName, disabled) : "",
    actions.showResumeDesign ? renderResumeDesignForm(runName, disabled) : "",
  ].filter(Boolean).join("\n")

  return `<div class="run-actions">
  <span class="run-actions-label">Continue this run</span>
  <div class="run-actions-buttons">${buttons}</div>
  ${busyNote}
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
    : renderRunActionStrip(input.runName, input.resumeActions, { runActiveGlobally: input.runActiveGlobally })
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

export function renderNodeControlsSection(input: {
  runName: string
  nodeName: string
  showRetry: boolean
  runActiveGlobally: boolean
}): string {
  if (!input.showRetry) {
    return `<div id="node-controls-section" class="run-controls-section"></div>`
  }

  const retryHtml = renderNodeRetryButton(input.runName, input.nodeName, input.runActiveGlobally)
  const busyNote = input.runActiveGlobally
    ? `<p class="muted-note dim-text run-actions-note">Another run is active — wait for it to finish first.</p>`
    : ""

  return `<div id="node-controls-section" class="run-controls-section">
  <div class="run-actions">
    <span class="run-actions-label">Checkpoint retry</span>
    <div class="run-actions-buttons">${retryHtml}</div>
    ${busyNote}
  </div>
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
