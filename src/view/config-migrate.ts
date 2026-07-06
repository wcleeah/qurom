import { listSchemaMigrationPreviews, runSchemaMigration } from "./schema-migrations"
import { withHtmlReaderDb } from "./html-reader-db"
import { card, section } from "./html"
import { layout } from "./layout"
import { configNavbarOptions } from "./config-nav"
import { escapeHtml } from "./utils"

function statusBadge(status: string): string {
  const cls =
    status === "complete"
      ? "approved"
      : status === "pending"
        ? "running"
        : "failed"
  const label =
    status === "complete"
      ? "Complete"
      : status === "pending"
        ? "Pending"
        : status === "unavailable"
          ? "Unavailable"
          : status
  return `<span class="status-tag status-tag-${cls}">${escapeHtml(label)}</span>`
}

function renderMigrationCard(preview: Awaited<ReturnType<typeof listSchemaMigrationPreviews>>[number], flash?: string): string {
  const pendingHtml =
    preview.status === "pending" && preview.pendingCounts
      ? `<p class="tiny-text">Pending: ${preview.pendingCounts.highlights ?? 0} highlight(s), ${preview.pendingCounts.pageNotes ?? 0} page note(s)</p>`
      : ""

  const resultHtml = preview.resultCounts
    ? `<p class="tiny-text muted-text">library_notes: ${preview.resultCounts.highlights ?? 0} highlight(s), ${preview.resultCounts.pageNotes ?? 0} page note(s)</p>`
    : ""

  const lastRunHtml = preview.lastRunAt
    ? `<p class="tiny-text muted-text">Last run: ${escapeHtml(preview.lastRunAt)}${preview.lastError ? ` — ${escapeHtml(preview.lastError)}` : ""}</p>`
    : ""

  const actionHtml =
    preview.status === "pending"
      ? `<form class="config-form" method="POST" action="/config/migrate/run">
  <input type="hidden" name="migrationId" value="${escapeHtml(preview.id)}">
  <div class="form-actions"><button type="submit" class="btn btn-primary">Run migration</button></div>
</form>`
      : `<p class="tiny-text muted-text">No action required.</p>`

  return card(`<div class="migration-card">
  <div class="header-bar" style="margin-bottom:0.75rem">
    <div class="header-main">
      <h3 style="margin:0">${escapeHtml(preview.title)}</h3>
      <div class="meta-row">${statusBadge(preview.status)} <code>${escapeHtml(preview.id)}</code></div>
    </div>
  </div>
  <p class="tiny-text">${escapeHtml(preview.description)}</p>
  ${pendingHtml}
  ${resultHtml}
  ${lastRunHtml}
  ${flash && preview.id === "library-notes-v1" ? `<div class="outcome-banner ${flash.startsWith("Error") ? "failed" : "approved"}">${escapeHtml(flash)}</div>` : ""}
  ${actionHtml}
</div>`)
}

export async function renderConfigMigrate(flash?: string): Promise<Response> {
  const previews = await withHtmlReaderDb((db) => listSchemaMigrationPreviews(db))
  const cards = previews.map((preview) => renderMigrationCard(preview, flash)).join("\n")

  const body = [
    `<div class="header-bar"><div class="header-main"><h1>Schema migrations</h1><div class="meta-row"><span class="meta-item tiny-text muted-text">Admin-only. Data migrations are not run automatically on startup.</span></div></div></div>`,
    flash && !previews.some((p) => p.id === "library-notes-v1")
      ? `<div class="outcome-banner failed">${escapeHtml(flash)}</div>`
      : "",
    section("Migrations", cards || "<p class=\"muted-text\">No migrations registered.</p>"),
  ].join("\n")

  return new Response(layout("Schema migrations", body, {
    navbar: configNavbarOptions("Schema migrations", "migrate"),
  }), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export async function handleConfigMigratePost(req: Request, path: string): Promise<Response | null> {
  if (path !== "/config/migrate/run" || req.method !== "POST") return null

  const form = await req.formData()
  const migrationId = String(form.get("migrationId") ?? "").trim()
  if (!migrationId) {
    return renderConfigMigrate("Error: missing migration id.")
  }

  const result = await withHtmlReaderDb((db) => runSchemaMigration(db, migrationId))
  const flash = result.ok ? result.message : `Error: ${result.message}`
  return renderConfigMigrate(flash)
}
