import type { ArticleTagRecord, NoteTagRecord } from "../tags-store"
import { escapeHtml } from "./utils"

export type TagPickerOption = {
  slug: string
  label: string
}

function allTagsDataset(allTags: TagPickerOption[]): string {
  return escapeHtml(JSON.stringify(allTags))
}

export function renderTagChip(slug: string, label: string, removable = false, source?: string): string {
  const sourceAttr = source ? ` data-tag-source="${escapeHtml(source)}"` : ""
  const removeBtn = removable
    ? `<button type="button" class="tag-chip-remove" data-tag-slug="${escapeHtml(slug)}" aria-label="Remove tag ${escapeHtml(label)}">×</button>`
    : ""
  return `<span class="tag-chip" data-tag-slug="${escapeHtml(slug)}"${sourceAttr}><span class="tag-chip-label">${escapeHtml(label)}</span>${removeBtn}</span>`
}

export function renderTagPicker(input: {
  allTags: TagPickerOption[]
  noteId?: string
  runName?: string
  label?: string
  placeholder?: string
}): string {
  const attrs = [
    'class="tag-picker"',
    'data-tag-picker',
    `data-all-tags="${allTagsDataset(input.allTags)}"`,
  ]
  if (input.noteId) attrs.push(`data-note-id="${escapeHtml(input.noteId)}"`)
  if (input.runName) attrs.push(`data-run-name="${escapeHtml(input.runName)}"`)
  const label = input.label ?? "Add tags"
  const placeholder = input.placeholder ?? "Search or create tags…"
  return `<div ${attrs.join(" ")}>
  <label class="form-field tag-picker-field"><span>${escapeHtml(label)}</span>
    <div class="tag-picker-control">
      <input class="form-input tag-picker-input" type="text" placeholder="${escapeHtml(placeholder)}" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list">
      <div class="tag-picker-menu" hidden role="listbox"></div>
    </div>
  </label>
</div>`
}

export function renderArticleTagsSection(input: {
  runName: string
  tags: ArticleTagRecord[]
  allTags: TagPickerOption[]
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
  ${renderTagPicker({
    allTags: input.allTags,
    runName: input.runName,
    label: "Add tags",
    placeholder: "Search or create article tags…",
  })}
</div>
${TAG_FORMS_SCRIPT}`
}

export function renderNoteTagsEditor(input: {
  noteId: string
  tags: NoteTagRecord[]
  allTags: TagPickerOption[]
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
  ${renderTagPicker({
    allTags: input.allTags,
    noteId: input.noteId,
    label: "Tags",
    placeholder: "Search or create tags…",
  })}
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

  function normalizeTagQuery(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function readAllTags(picker) {
    try { return JSON.parse(picker.getAttribute("data-all-tags") || "[]"); } catch { return []; }
  }

  function existingSlugs(editor) {
  if (!editor) return [];
    return Array.from(editor.querySelectorAll(".tag-chip[data-tag-slug]")).map(function(chip) {
      return chip.getAttribute("data-tag-slug") || "";
    }).filter(Boolean);
  }

  function closeMenu(menu, input) {
    if (!(menu instanceof HTMLElement)) return;
    menu.hidden = true;
    if (input instanceof HTMLInputElement) input.setAttribute("aria-expanded", "false");
  }

  function openMenu(menu, input) {
    if (!(menu instanceof HTMLElement)) return;
    menu.hidden = false;
    if (input instanceof HTMLInputElement) input.setAttribute("aria-expanded", "true");
  }

  function renderTagMenu(picker, query) {
    var input = picker.querySelector(".tag-picker-input");
    var menu = picker.querySelector(".tag-picker-menu");
    if (!(input instanceof HTMLInputElement) || !(menu instanceof HTMLElement)) return;
    var editor = picker.closest("[data-note-tags], [data-article-tags]");
    var allTags = readAllTags(picker);
    var slugs = new Set(existingSlugs(editor));
    var q = String(query || "").trim().toLowerCase();
    var matches = allTags.filter(function(tag) {
      if (slugs.has(tag.slug)) return false;
      if (!q) return true;
      return tag.label.toLowerCase().indexOf(q) !== -1 || tag.slug.indexOf(q) !== -1;
    }).slice(0, 20);
    var normalized = normalizeTagQuery(q);
    var canCreate = !!q && !slugs.has(normalized) && !allTags.some(function(tag) { return tag.slug === normalized; });
    var html = "";
    for (var i = 0; i < matches.length; i++) {
      var tag = matches[i];
      html += '<button type="button" class="tag-picker-option" role="option" data-tag-value="' + tag.slug.replace(/"/g, "&quot;") + '">' +
        tag.label.replace(/</g, "&lt;") + '</button>';
    }
    if (canCreate) {
      html += '<button type="button" class="tag-picker-option tag-picker-option-create" role="option" data-tag-value="' + q.replace(/"/g, "&quot;") + '">Create "' + q.replace(/</g, "&lt;") + '"</button>';
    }
    if (!html) {
      html = '<div class="tag-picker-empty muted-text">No matching tags</div>';
    }
    menu.innerHTML = html;
    openMenu(menu, input);
  }

  function addTagFromPicker(picker, tagValue, onSuccess) {
    var noteId = picker.getAttribute("data-note-id");
    var runName = picker.getAttribute("data-run-name");
    var tag = String(tagValue || "").trim();
    if (!tag) return Promise.resolve();
    var url = noteId
      ? "/api/library/notes/" + encodeURIComponent(noteId) + "/tags"
      : "/api/runs/" + encodeURIComponent(runName || "") + "/tags";
    return postJson(url, "POST", { tag: tag }).then(function(data) {
      if (picker.getAttribute("data-tag-refresh") === "event") {
        picker.dispatchEvent(new CustomEvent("quorum-tag-added", { bubbles: true, detail: data }));
        return data;
      }
      if (typeof onSuccess === "function") onSuccess();
      else window.location.reload();
      return data;
    }).catch(function() {
      window.location.reload();
    });
  }

  function initTagPickers(scope) {
    var root = scope || document;
    root.querySelectorAll("[data-tag-picker]:not([data-tag-picker-ready])").forEach(function(picker) {
      if (!(picker instanceof HTMLElement)) return;
      picker.setAttribute("data-tag-picker-ready", "true");
      var input = picker.querySelector(".tag-picker-input");
      var menu = picker.querySelector(".tag-picker-menu");
      if (!(input instanceof HTMLInputElement) || !(menu instanceof HTMLElement)) return;

      input.addEventListener("focus", function() {
        renderTagMenu(picker, input.value);
      });
      input.addEventListener("input", function() {
        renderTagMenu(picker, input.value);
      });
      input.addEventListener("keydown", function(event) {
        if (event.key === "Escape") {
          closeMenu(menu, input);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          var first = menu.querySelector(".tag-picker-option");
          if (first instanceof HTMLButtonElement) {
            addTagFromPicker(picker, first.getAttribute("data-tag-value"));
          } else if (input.value.trim()) {
            addTagFromPicker(picker, input.value);
          }
        }
      });

      menu.addEventListener("mousedown", function(event) {
        event.preventDefault();
      });
      menu.addEventListener("click", function(event) {
        var option = event.target instanceof Element ? event.target.closest(".tag-picker-option") : null;
        if (!(option instanceof HTMLButtonElement)) return;
        var value = option.getAttribute("data-tag-value");
        addTagFromPicker(picker, value).then(function() {
          input.value = "";
          renderTagMenu(picker, "");
          input.focus();
        });
      });

      document.addEventListener("click", function(event) {
        if (!(event.target instanceof Node) || !picker.contains(event.target)) {
          closeMenu(menu, input);
        }
      });
    });
  }

  document.querySelectorAll("[data-note-tags], [data-article-tags]").forEach(function(editor) {
    editor.addEventListener("click", function(event) {
      var button = event.target instanceof Element ? event.target.closest(".tag-chip-remove") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      event.preventDefault();
      var slug = button.getAttribute("data-tag-slug");
      if (!slug) return;
      var noteRoot = button.closest("[data-note-tags]");
      var articleRoot = button.closest("[data-article-tags]");
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

  window.quorumInitTagPickers = initTagPickers;
  initTagPickers();
})();
</script>`
