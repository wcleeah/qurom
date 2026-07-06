import { basename } from "node:path"

import {
  excerptText,
  HIGHLIGHT_COLOR_RGBA,
  librarySourceLabel,
  listAllLibraryNotes,
  resolveLibrarySource,
  type LibraryNote,
} from "./library-notes-store"
import { section } from "./html"
import { layout, formatRelative } from "./layout"
import { escapeHtml } from "./utils"

function renderHighlightPrimary(note: LibraryNote): string {
  const quote = note.quote?.trim() ?? ""
  const body = note.body.trim()
  if (body) {
    return `<div class="library-item-body">${escapeHtml(body)}</div>
<div class="library-item-quote">${escapeHtml(quote)}</div>`
  }
  return `<div class="library-item-body library-item-quote-only">${escapeHtml(quote)}</div>`
}

function renderPagePrimary(note: LibraryNote): string {
  return `<div class="library-item-body">${escapeHtml(excerptText(note.body))}</div>`
}

async function renderLibraryItem(note: LibraryNote): Promise<string> {
  const source = await resolveLibrarySource(note.runName, note.filePath)
  const sourceLabel = librarySourceLabel(source)
  const href = `/runs/${encodeURIComponent(note.runName)}/raw/${encodeURIComponent(note.filePath)}`
  const sourceHtml = source.alive
    ? `<a href="${href}">${escapeHtml(sourceLabel)}</a>`
    : `<span class="muted-text">${escapeHtml(sourceLabel)} (source deleted)</span>`

  const swatch =
    note.kind === "highlight" && note.color
      ? `<span class="library-color-swatch" style="background:${HIGHLIGHT_COLOR_RGBA[note.color]}" aria-hidden="true"></span>`
      : ""

  const badge =
    note.kind === "page"
      ? `<span class="status-tag status-tag-running">Page note</span>`
      : ""

  const primary =
    note.kind === "highlight" ? renderHighlightPrimary(note) : renderPagePrimary(note)

  const updatedMs = Date.parse(note.updatedAt)

  return `<article class="library-item card">
  <div class="library-item-header">
    ${swatch}
    <div class="library-item-meta">${badge}<span class="tiny-text muted-text">${Number.isFinite(updatedMs) ? formatRelative(updatedMs) : escapeHtml(note.updatedAt)}</span></div>
  </div>
  ${primary}
  <div class="library-item-source tiny-text">${sourceHtml}</div>
</article>`
}

export async function renderLibraryPage(): Promise<Response> {
  const notes = await listAllLibraryNotes()
  const visible = notes.filter((note) => note.kind === "highlight" || note.body.trim())

  const listHtml =
    visible.length === 0
      ? `<p class="muted-text">No library items yet. Open an HTML artifact from a run to highlight text or take notes.</p>`
      : `<div class="library-list">${(await Promise.all(visible.map(renderLibraryItem))).join("\n")}</div>`

  const body = [
    `<div class="header-bar"><div class="header-main"><h1>Library</h1><div class="meta-row"><span class="meta-item tiny-text muted-text">${visible.length} item(s)</span></div></div></div>`,
    section("All notes & highlights", listHtml),
  ].join("\n")

  return new Response(layout("Library", body, {
    navbar: { section: "library", title: "Library" },
  }), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

export function libraryItemFileName(note: LibraryNote): string {
  return basename(note.filePath)
}
