import type { RerunQueueSnapshot } from "../run-manager"
import { escapeHtml } from "./utils"

function interviewLabel(interview: string): string {
  return interview === "repair" ? "Repair reader" : "Reuse reader"
}

export function renderRerunQueueStrip(queue: RerunQueueSnapshot): string {
  if (queue.items.length === 0 && !queue.paused) {
    return `<div id="rerun-queue-section"></div>`
  }

  const rows = queue.items.length === 0
    ? `<p class="muted-note rerun-queue-empty">Playlist paused — nothing queued.</p>`
    : `<ol class="rerun-queue-list">
  ${queue.items.map((item) => `<li class="rerun-queue-item">
    <div class="rerun-queue-item-main">
      <span class="rerun-queue-topic">${escapeHtml(item.topic)}</span>
      <span class="tiny-text muted-text">${escapeHtml(interviewLabel(item.interview))}</span>
    </div>
    <form class="run-action-form" method="POST" action="/api/rerun-queue/${encodeURIComponent(item.id)}/remove">
      <button type="submit" class="btn btn-secondary">Remove</button>
    </form>
  </li>`).join("\n")}
</ol>`

  const pauseAction = queue.paused ? "resume" : "pause"
  const pauseLabel = queue.paused ? "Resume playlist" : "Pause playlist"
  const countLabel = queue.items.length === 1 ? "1 queued" : `${queue.items.length} queued`
  const statusBits = [
    queue.items.length > 0 ? countLabel : "empty",
    queue.paused ? "paused" : "",
  ].filter(Boolean)
  const summaryStatus = statusBits.join(" · ")

  return `<section id="rerun-queue-section" class="rerun-queue-section card" aria-labelledby="rerun-queue-heading">
  <details class="rerun-queue-details" data-collapse-key="rerun-queue" open>
    <summary class="rerun-queue-summary">
      <span class="rerun-queue-summary-main">
        <span class="rerun-queue-heading" id="rerun-queue-heading">Rerun playlist</span>
        <span class="muted-note">${escapeHtml(summaryStatus)}</span>
      </span>
    </summary>
    <div class="rerun-queue-header">
      <p class="muted-note">${queue.paused ? "Paused — unattended reruns will not start." : "Unattended reuse and repair reruns, one at a time."}</p>
      <div class="rerun-queue-actions">
        <form class="run-action-form" method="POST" action="/api/rerun-queue/${pauseAction}">
          <button type="submit" class="btn btn-secondary">${pauseLabel}</button>
        </form>
        ${queue.items.length > 0
          ? `<form class="run-action-form" method="POST" action="/api/rerun-queue/clear">
          <button type="submit" class="btn btn-secondary">Clear</button>
        </form>`
          : ""}
      </div>
    </div>
    ${rows}
  </details>
</section>`
}
