import type { ArticleTagRecord, NoteTagRecord } from "../tags-store"
import { escapeHtml } from "./utils"

export function renderTagChip(slug: string, label: string, removable = false, source?: string): string {
  const sourceAttr = source ? ` data-tag-source="${escapeHtml(source)}"` : ""
  const removeBtn = removable
    ? `<button type="submit" class="tag-chip-remove" name="slug" value="${escapeHtml(slug)}" aria-label="Remove tag ${escapeHtml(label)}">×</button>`
    : ""
  return `<span class="tag-chip"${sourceAttr}><span class="tag-chip-label">${escapeHtml(label)}</span>${removeBtn}</span>`
}

export function renderArticleTagsSection(input: {
  runName: string
  tags: ArticleTagRecord[]
  canRetag: boolean
}): string {
  const chips = input.tags.length
    ? input.tags.map((tag) => renderTagChip(
      tag.slug,
      tag.label,
      tag.articleSource === "user",
      tag.articleSource,
    )).join("")
    : `<span class="muted-text tiny-text">No tags yet.</span>`

  return `<div class="tags-section card" data-article-tags data-run-name="${escapeHtml(input.runName)}">
  <div class="tags-section-header">
    <h2>Tags</h2>
    <div class="tags-section-actions">
      ${input.canRetag ? `<form class="inline-form" method="POST" action="/api/runs/${encodeURIComponent(input.runName)}/retag"><button type="submit" class="btn btn-secondary">Re-tag</button></form>` : ""}
      <form class="inline-form" method="POST" action="/api/runs/${encodeURIComponent(input.runName)}/tags/propagate">
        <button type="submit" class="btn btn-secondary">Apply tags to notes</button>
      </form>
    </div>
  </div>
  <div class="tag-chip-list">${chips}</div>
  <form class="config-form tag-add-form" method="POST" action="/api/runs/${encodeURIComponent(input.runName)}/tags" data-tag-add-form>
    <label class="form-field"><span>Add tag</span>
      <input class="form-input" type="text" name="tag" placeholder="machine-learning" required>
    </label>
    <div class="form-actions"><button type="submit" class="btn btn-secondary">Add</button></div>
  </form>
</div>
${TAG_FORMS_SCRIPT}`
}

export function renderNoteTagsEditor(input: {
  noteId: string
  tags: NoteTagRecord[]
}): string {
  const chips = input.tags.length
    ? input.tags.map((tag) => renderTagChip(
      tag.slug,
      tag.label,
      true,
      tag.noteSource,
    )).join("")
    : `<span class="muted-text tiny-text">No tags</span>`

  return `<div class="note-tags-editor" data-note-tags data-note-id="${escapeHtml(input.noteId)}">
  <div class="tag-chip-list">${chips}</div>
  <form class="config-form tag-add-form" data-tag-add-form data-note-id="${escapeHtml(input.noteId)}">
    <label class="form-field"><span>Tag</span>
      <input class="form-input" type="text" name="tag" placeholder="important" required>
    </label>
    <button type="submit" class="btn btn-secondary">Add</button>
  </form>
</div>`
}

export function renderLibraryTagFilter(input: {
  allTags: Array<{ slug: string; label: string }>
  activeSlugs: string[]
}): string {
  if (input.allTags.length === 0) {
    return ""
  }
  const links = input.allTags.map((tag) => {
    const active = input.activeSlugs.includes(tag.slug)
    const next = new Set(input.activeSlugs)
    if (active) next.delete(tag.slug)
    else next.add(tag.slug)
    const href = next.size > 0
      ? `/library?tags=${[...next].map(encodeURIComponent).join(",")}`
      : "/library"
    return `<a class="library-tag-filter${active ? " library-tag-filter-active" : ""}" href="${href}">${escapeHtml(tag.label)}</a>`
  }).join("")
  const clear = input.activeSlugs.length
    ? `<a class="library-tag-filter-clear" href="/library">Clear filters</a>`
    : ""
  return `<div class="library-tag-filters">${links}${clear}</div>`
}

export const TAG_FORMS_SCRIPT = `<script>
(function(){
  function postJson(url, method, body) {
    return fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body),
    }).then(function(resp) {
      if (!resp.ok) throw new Error("Request failed");
      return resp.json();
    });
  }

  document.querySelectorAll("[data-tag-add-form]").forEach(function(form) {
    if (!(form instanceof HTMLFormElement)) return;
    form.addEventListener("submit", function(event) {
      var noteId = form.getAttribute("data-note-id");
      var articleRoot = form.closest("[data-article-tags]");
      if (!noteId && !articleRoot) return;
      event.preventDefault();
      var input = form.querySelector("input[name='tag']");
      if (!(input instanceof HTMLInputElement)) return;
      var tag = input.value.trim();
      if (!tag) return;
      var url = noteId
        ? "/api/library/notes/" + encodeURIComponent(noteId) + "/tags"
        : "/api/runs/" + encodeURIComponent(articleRoot.getAttribute("data-run-name") || "") + "/tags";
      postJson(url, "POST", { tag: tag }).then(function() { window.location.reload(); }).catch(function() { window.location.reload(); });
    });
  });

  document.querySelectorAll(".tag-chip-remove").forEach(function(button) {
    if (!(button instanceof HTMLButtonElement)) return;
    var chip = button.closest(".tag-chip");
    var articleRoot = button.closest("[data-article-tags]");
    var noteRoot = button.closest("[data-note-tags]");
    button.addEventListener("click", function(event) {
      event.preventDefault();
      var slug = button.value;
      if (!slug) return;
      var url;
      if (noteRoot) {
        url = "/api/library/notes/" + encodeURIComponent(noteRoot.getAttribute("data-note-id") || "") + "/tags/" + encodeURIComponent(slug);
      } else if (articleRoot) {
        url = "/api/runs/" + encodeURIComponent(articleRoot.getAttribute("data-run-name") || "") + "/tags/" + encodeURIComponent(slug);
      } else {
        return;
      }
      fetch(url, { method: "DELETE", headers: { "Accept": "application/json" } })
        .then(function() { window.location.reload(); })
        .catch(function() { window.location.reload(); });
    });
  });
})();
</script>`
