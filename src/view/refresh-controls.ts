/** Persisted preference for auto-polling run detail pages (`on` | `off`). */
export const LIVE_REFRESH_STORAGE_KEY = "qurom-view-live-refresh"

export function renderRefreshControls(): string {
  return `<div class="refresh-controls" id="refresh-controls">
  <span id="refresh-dot" class="refresh-dot" aria-hidden="true"></span>
  <span id="refresh-status">Loading refresh settings…</span>
  <label class="refresh-toggle">
    <input type="checkbox" id="refresh-auto-toggle" data-refresh-toggle />
    <span>Live refresh</span>
  </label>
  <button type="button" class="refresh-button" data-refresh-now>Refresh now</button>
</div>`
}
