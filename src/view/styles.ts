export const CSS = /* css */ `
/* ── Reset & variables ── */
:root {
  /* Light mode: crisp paper-white on hairline (grep.app feel) */
  --bg: #fafafa;
  --bg-subtle: #fafafa;
  --fg: #0a0a0a;
  --bg-card: #ffffff;
  --border: #e6e6e6;
  --accent: #0060df;
  --accent-dim: rgba(0, 96, 223, 0.07);
  --green: #167c3f;
  --green-bg: rgba(22, 124, 63, 0.09);
  --red: #cf2222;
  --red-bg: rgba(207, 34, 34, 0.08);
  --orange: #c2570c;
  --orange-bg: rgba(194, 87, 12, 0.09);
  --muted: #666666;
  --code-bg: #f6f6f6;
  --radius: 6px;
  --radius-sm: 4px;
  --font-sans: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: "Geist Mono", "JetBrains Mono", "Fira Code", "SF Mono", Menlo, monospace;
}
/* Dark mode: grep near-black, deliberately tuned (not an inversion).
   Applied when the OS prefers dark AND the user hasn't forced light,
   or when the user explicitly selects dark via the theme toggle. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0a0a0a;
    --bg-subtle: #0d0d0d;
    --fg: #ededed;
    --bg-card: #0f0f0f;
    --border: #1f1f1f;
    --accent: #4c8dff;
    --accent-dim: rgba(76, 141, 255, 0.12);
    --green: #4ade80;
    --green-bg: rgba(74, 222, 128, 0.12);
    --red: #f87171;
    --red-bg: rgba(248, 113, 113, 0.13);
    --orange: #fb923c;
    --orange-bg: rgba(251, 146, 60, 0.13);
    --muted: #8f8f8f;
    --code-bg: #141414;
  }
}
:root[data-theme="dark"] {
  --bg: #0a0a0a;
  --bg-subtle: #0d0d0d;
  --fg: #ededed;
  --bg-card: #0f0f0f;
  --border: #1f1f1f;
  --accent: #4c8dff;
  --accent-dim: rgba(76, 141, 255, 0.12);
  --green: #4ade80;
  --green-bg: rgba(74, 222, 128, 0.12);
  --red: #f87171;
  --red-bg: rgba(248, 113, 113, 0.13);
  --orange: #fb923c;
  --orange-bg: rgba(251, 146, 60, 0.13);
  --muted: #8f8f8f;
  --code-bg: #141414;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font-sans);
  background: var(--bg);
  color: var(--fg);
  line-height: 1.5;
  letter-spacing: -0.011em;
  -webkit-text-size-adjust: 100%;
}

button {
  font-family: var(--font-sans);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.35;
}

/* ── Layout (mobile-first: narrow) ── */
body.app-body {
  padding: 0;
  max-width: none;
  width: 100%;
  margin: 0;
}
.app-main {
  padding: 1rem 0.75rem;
  max-width: 960px;
  margin: 0 auto;
  min-width: 0;
  overflow-x: clip;
}

h1 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.02em; }
h2 { font-size: 1.1rem; font-weight: 600; letter-spacing: -0.015em; margin-top: 1.25rem; margin-bottom: 0.5rem; }
h3 { font-size: 0.95rem; font-weight: 600; letter-spacing: -0.01em; margin-top: 1rem; margin-bottom: 0.25rem; color: var(--muted); }

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ── Badges ── */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.12rem 0.45rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  white-space: nowrap;
}
.badge-approved { background: var(--green-bg); color: var(--green); }
.badge-failed   { background: var(--red-bg);   color: var(--red); }
.badge-running  { background: var(--orange-bg); color: var(--orange); }

/* ── Cards ── */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  margin-bottom: 0.75rem;
  max-width: 100%;
  min-width: 0;
}
.stack-card { display: flex; flex-direction: column; }
.stack-card-tight { gap: 0.15rem; }
.stack-card-history { gap: 0.3rem; }
.stack-card-roomy { gap: 0.5rem; }
.card-compact { margin-bottom: 0.5rem; }
.row-inline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.row-inline-spread {
  display: flex;
  gap: 0.25rem;
  align-items: center;
}
.page-title { margin-bottom: 0.75rem; }
.title-reset { margin: 0; }
.muted-note { color: var(--muted); font-size: 0.8rem; }
.source-note { margin-bottom: 1rem; }
.header-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.danger-text { color: var(--red); }
.success-text { color: var(--green); }
.running-text { color: var(--orange); }
.accent-text { color: var(--accent); }
.muted-text { color: var(--muted); }
.dim-text { opacity: 0.6; }
.tiny-text { font-size: 0.7rem; }
.design-badge { font-size: 0.6rem; padding: 0.1rem 0.35rem; }
.hero-heading-icon { font-size: 1.25rem; }

/* ── Stats dashboard ── */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  text-align: center;
}
.stat-card .stat-value {
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.2;
}
.stat-card .stat-label {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-top: 0.15rem;
}
.stat-total  .stat-value { color: var(--accent); }
.stat-approved .stat-value { color: var(--green); }
.stat-failed  .stat-value { color: var(--red); }
.stat-running .stat-value { color: var(--orange); }

/* ── Run cards (index) ── */
.run-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  margin-bottom: 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.run-card:hover {
  border-color: var(--muted);
  background: var(--bg-card);
}
.run-card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.5rem;
}
.star-button {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
  transition: color 0.12s ease, border-color 0.12s ease, background 0.12s ease;
}
.star-button:hover {
  color: var(--orange);
  border-color: var(--orange);
}
.star-button-active,
.star-button[aria-pressed="true"] {
  color: var(--orange);
  border-color: var(--orange);
  background: var(--orange-bg);
}
.star-button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.header-title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.header-title-row h1 {
  margin: 0;
}
.run-filters {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  font-size: 0.75rem;
}
.run-filters a {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted);
  text-decoration: none;
}
.run-filters a:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.run-filters a.active {
  color: var(--fg);
  border-color: var(--fg);
  font-weight: 600;
}
.new-run-section {
  margin-bottom: 1.25rem;
}
.new-run-section .new-run-card {
  padding: 1rem 1.1rem 1.1rem;
  margin-bottom: 0;
}
.new-run-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.85rem 1.25rem;
  margin-bottom: 0.85rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid var(--border);
}
.new-run-header-text h2 {
  margin: 0 0 0.2rem;
  font-size: 1.05rem;
}
.new-run-subtitle {
  margin: 0;
  font-size: 0.78rem;
}
.new-run-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.new-run-tab {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--muted);
  border-radius: 999px;
  padding: 0.3rem 0.8rem;
  font-size: 0.75rem;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.new-run-tab:hover {
  color: var(--fg);
  border-color: var(--muted);
}
.new-run-tab.active {
  color: var(--fg);
  border-color: var(--accent);
  background: var(--accent-bg, rgba(59, 130, 246, 0.08));
  font-weight: 600;
}
.new-run-panels {
  position: relative;
}
.new-run-panels .config-form.new-run-panel:not(.active) {
  display: none;
}
.new-run-panels .config-form.new-run-panel.active {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 0;
}
.new-run-hint {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--muted);
}
.new-run-textarea {
  min-height: 6.5rem;
  line-height: 1.55;
  font-family: inherit;
  resize: vertical;
}
.new-run-optional {
  font-size: 0.62rem;
  text-transform: lowercase;
  letter-spacing: normal;
  color: var(--muted);
  font-weight: normal;
}
.new-run-actions {
  margin-top: 0.15rem;
  padding-top: 0.15rem;
}
.new-run-active-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin-bottom: 0.85rem;
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius-sm);
  background: var(--orange-bg);
  border: 1px solid color-mix(in srgb, var(--orange) 25%, var(--border));
}
.new-run-error {
  margin-bottom: 0.85rem;
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius-sm);
  background: var(--red-bg);
  border: 1px solid color-mix(in srgb, var(--red) 25%, var(--border));
  color: var(--red);
  font-size: 0.82rem;
}
.run-cancel-form {
  margin-bottom: 0.75rem;
}
.run-cancel-button {
  font-size: 0.8125rem;
}
.run-controls-section {
  margin-bottom: 0.85rem;
}
.run-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  margin-bottom: 0.75rem;
}
.run-actions-label {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.run-actions-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.run-action-form {
  margin: 0;
}
.run-actions-note {
  margin: 0;
  font-size: 0.78rem;
}
.run-completion-banner {
  margin-bottom: 1rem;
}
.opencode-bootstrap-banner {
  margin-bottom: 1rem;
}
.opencode-bootstrap-banner .form-actions {
  gap: 0.5rem;
}
.run-card-title {
  font-weight: 600;
  font-size: 0.95rem;
  line-height: 1.3;
  word-break: break-word;
  flex: 1;
}
.run-card-title a {
  color: var(--fg);
  text-decoration: none;
}
.run-card-title a:hover { color: var(--accent); text-decoration: underline; }
.run-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.75rem;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--muted);
}
.run-card-meta span {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}

/* ── Run detail header ── */
.header-bar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.header-bar h1 {
  font-size: 1.15rem;
  word-break: break-word;
}
.meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
}
.meta-item {
  display: inline-flex;
  align-items: center;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}
.meta-item strong { color: var(--fg); font-weight: 600; }

/* ── App navbar (shared with HTML viewer) ── */
.app-navbar-shell {
  position: sticky;
  top: 0;
  z-index: 40;
  border-bottom: 1px solid var(--border);
  background: var(--bg-card);
  flex-shrink: 0;
}
.app-navbar,
.html-viewer-navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 0.75rem;
  background: var(--bg-card);
}
.app-navbar-start,
.html-viewer-navbar-start {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  flex: 1;
}
.app-navbar-pills {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}
.app-navbar-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.28rem 0.5rem;
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--muted);
  text-decoration: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
}
.app-navbar-pill:hover {
  border-color: var(--accent);
  color: var(--accent);
  text-decoration: none;
}
.app-navbar-pill-active {
  color: var(--fg);
  border-color: var(--fg);
  font-weight: 600;
}
.app-navbar-back,
.html-viewer-back {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.85rem;
  white-space: nowrap;
  flex-shrink: 0;
}
.app-navbar-back:hover,
.html-viewer-back:hover {
  text-decoration: underline;
}
.app-navbar-title,
.html-viewer-filename {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.app-navbar-actions,
.html-viewer-navbar-actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-shrink: 0;
}
.app-navbar-action,
.html-viewer-action {
  display: inline-flex;
  align-items: center;
  padding: 0.28rem 0.5rem;
  font-size: 0.72rem;
  color: var(--fg);
  text-decoration: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  cursor: pointer;
}
.app-navbar-action:hover,
.html-viewer-action:hover {
  border-color: var(--accent);
  color: var(--accent);
  text-decoration: none;
}
.app-navbar-theme-toggle,
.html-viewer-theme-toggle {
  position: static;
  top: auto;
  right: auto;
}
.app-navbar-sub {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.45rem 0.75rem;
  border-top: 1px solid var(--border);
  background: var(--bg);
}
.app-navbar-sub a {
  display: inline-flex;
  align-items: center;
  padding: 0.35rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--muted);
  text-decoration: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
}
.app-navbar-sub a:hover {
  color: var(--fg);
  text-decoration: none;
}
.app-navbar-sub a.active {
  color: var(--fg);
  border-color: var(--accent);
  background: var(--accent-dim);
}

/* ── JSON details (collapsible) ── */
.json-details {
  margin: 0.25rem 0;
}
.json-summary {
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--muted);
  padding: 0.4rem 0.5rem;
  border-radius: var(--radius-sm);
  user-select: none;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.json-summary::-webkit-details-marker { display: none; }
.json-summary::before {
  content: "▸";
  display: inline-block;
  font-size: 0.7rem;
  transition: transform 0.15s;
  color: var(--muted);
}
details[open] > .json-summary::before {
  transform: rotate(90deg);
}
.json-summary:hover {
  background: var(--code-bg);
}
.json-block {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.75rem;
  margin-top: 0.25rem;
  overflow-x: auto;
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 60vh;
  overflow-y: auto;
}

/* ── JSON viewer ── */
.json-viewer {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.json-viewer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.json-viewer-meta {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.json-viewer-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.json-viewer-btn {
  display: inline-flex;
  align-items: center;
  padding: 0.28rem 0.5rem;
  font-size: 0.72rem;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.json-viewer-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.json-viewer-body {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.json-viewer-card {
  margin-bottom: 0;
}
.json-kv-table td:last-child,
.json-data-table td {
  color: var(--fg);
  font-weight: 400;
  white-space: normal;
}
.json-nested {
  margin: 0.15rem 0;
}
.json-nested > summary {
  cursor: pointer;
  font-size: 0.78rem;
  color: var(--muted);
  user-select: none;
  list-style: none;
}
.json-nested > summary::-webkit-details-marker {
  display: none;
}
.json-nested > summary::before {
  content: "▸";
  display: inline-block;
  margin-right: 0.35rem;
  font-size: 0.7rem;
  transition: transform 0.15s;
}
.json-nested[open] > summary::before {
  transform: rotate(90deg);
}
.json-meta {
  color: var(--muted);
  font-size: 0.75rem;
}
.json-null {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 0.8rem;
}
.json-boolean {
  color: var(--orange);
  font-family: var(--font-mono);
  font-size: 0.8rem;
}
.json-number {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 0.8rem;
}
.json-string {
  color: var(--green);
  font-family: var(--font-mono);
  font-size: 0.8rem;
  word-break: break-word;
}
.json-unknown {
  font-family: var(--font-mono);
  font-size: 0.8rem;
}
.json-string-block {
  margin-top: 0.35rem;
  padding: 0.55rem 0.65rem;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 16rem;
  overflow: auto;
}
.json-array-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.35rem;
  padding-left: 0.15rem;
}
.json-array-item {
  font-size: 0.8rem;
}
.json-index {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--muted);
  margin-right: 0.35rem;
}
.json-primitive-root {
  padding: 0.85rem;
}
.json-empty {
  padding: 0.85rem;
  margin: 0;
}

/* ── Pre / code ── */
pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.75rem;
  overflow-x: auto;
  font-size: 0.78rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
code {
  font-family: var(--font-mono);
  font-size: 0.85em;
}

/* ── Hero link ── */
.hero-link {
  display: block;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem 1rem;
  text-align: center;
  font-weight: 500;
  font-size: 0.9rem;
  color: var(--accent);
  margin: 0.5rem 0;
}
.hero-link:hover {
  border-color: var(--accent);
  text-decoration: none;
}

/* ── File list (grouped) ── */
.file-group {
  margin-bottom: 0.75rem;
}
.file-group-title {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--muted);
  padding: 0.25rem 0;
  margin-bottom: 0.15rem;
}
.file-subgroup {
  margin-top: 0.45rem;
}
.file-subgroup:first-of-type {
  margin-top: 0;
}
.file-subgroup-title {
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 650;
  letter-spacing: 0.03em;
  padding: 0.15rem 0.15rem 0.25rem;
}
.file-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.file-list li a {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.55rem;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
}
.file-list li a:hover {
  background: var(--code-bg);
  border-color: var(--border);
  text-decoration: none;
}
.file-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.08rem;
}
.file-label {
  color: var(--fg);
  font-size: 0.82rem;
  font-weight: 600;
}
.file-desc {
  color: var(--muted);
  font-size: 0.7rem;
}
.file-name {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-size {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  white-space: nowrap;
}

/* ── Section spacing ── */
.section { margin-top: 1.25rem; }

/* ── Empty state ── */
.empty-state {
  text-align: center;
  color: var(--muted);
  padding: 3rem 1rem;
  font-size: 0.9rem;
}

/* ── Phase timeline ── */
.phase-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.phase-detail {
  font-size: 0.78rem;
  color: var(--muted);
}

/* ── Quick stats (run detail) ── */
.run-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.4rem;
  margin-bottom: 1rem;
}
.run-stat {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.5rem 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.run-stat-value {
  font-size: 1.1rem;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.2;
  color: var(--fg);
}
.run-stat-label {
  font-family: var(--font-mono);
  font-size: 0.64rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
@media (min-width: 640px) {
  .run-stats-grid { grid-template-columns: repeat(3, 1fr); }
}
@media (min-width: 1024px) {
  .run-stats-grid { grid-template-columns: repeat(4, 1fr); }
}

/* ── Markdown rendered content ── */
.md-content { word-break: break-word; }
.md-content h1 { font-size: 1.2rem; margin: 1rem 0 0.4rem; padding-bottom: 0.25rem; border-bottom: 1px solid var(--border); }
.md-content h2 { font-size: 1.05rem; margin: 0.9rem 0 0.35rem; }
.md-content h3 { font-size: 0.95rem; margin: 0.8rem 0 0.25rem; color: var(--fg); }
.md-content h4 { font-size: 0.88rem; margin: 0.7rem 0 0.2rem; }
.md-content h5, .md-content h6 { font-size: 0.82rem; margin: 0.6rem 0 0.2rem; color: var(--muted); }
.md-content p { margin: 0.4rem 0; }
.md-content ul, .md-content ol { margin: 0.4rem 0; padding-left: 1.25rem; }
.md-content li { margin: 0.1rem 0; }
.md-content blockquote {
  border-left: 3px solid var(--accent);
  padding: 0.2rem 0.6rem;
  margin: 0.4rem 0;
  color: var(--muted);
  background: var(--code-bg);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
.md-content code {
  background: var(--code-bg);
  padding: 0.1rem 0.25rem;
  border-radius: 3px;
  font-size: 0.85em;
}
.md-content pre { margin: 0.4rem 0; }
.md-content pre code { background: none; padding: 0; border-radius: 0; font-size: 0.82rem; }
.md-content a { color: var(--accent); }
.md-content hr { border: none; border-top: 1px solid var(--border); margin: 0.8rem 0; }
.md-content table { margin: 0.4rem 0; font-size: 0.8rem; width: 100%; border-collapse: collapse; }
.md-content th, .md-content td { padding: 0.3rem 0.5rem; text-align: left; border-bottom: 1px solid var(--border); }
.md-content th { color: var(--muted); font-weight: 600; }
.md-content img { max-width: 100%; height: auto; }
.md-content strong { font-weight: 600; }
.md-content input[type="checkbox"] { margin-right: 0.3rem; }

/* ── Structured JSON cards ── */
.structured-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  max-width: 100%;
  min-width: 0;
}
.structured-card + .structured-card { margin-top: 0.75rem; }

/* Outcome banner */
.outcome-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 0.85rem;
  font-weight: 600;
  font-size: 0.9rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.outcome-banner.approved { background: var(--green-bg); color: var(--green); border-color: var(--green-bg); }
.outcome-banner.needs-revision { background: var(--orange-bg); color: var(--orange); border-color: var(--orange-bg); }
.outcome-banner.failed { background: var(--red-bg); color: var(--red); border-color: var(--red-bg); }

/* Auditor header */
.auditor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.55rem 0.85rem;
  border-bottom: 1px solid var(--border);
  font-weight: 600;
  font-size: 0.85rem;
}
.auditor-vote {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.auditor-vote.approve { color: var(--green); }
.auditor-vote.revise { color: var(--red); }

/* Finding row */
.finding {
  padding: 0.55rem 0.85rem;
  border-bottom: 1px solid var(--border);
}
.finding:last-child { border-bottom: none; }
.finding-header {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  margin-bottom: 0.3rem;
}
.finding-severity {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 0.6rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.1rem 0.35rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  white-space: nowrap;
}
.finding-severity.blocker { background: var(--red-bg); color: var(--red); }
.finding-severity.major  { background: var(--orange-bg); color: var(--orange); }
.finding-severity.minor  { background: var(--code-bg); color: var(--muted); }
.finding-category {
  flex-shrink: 0;
  font-size: 0.65rem;
  color: var(--muted);
  font-weight: 500;
}
.finding-issue {
  font-size: 0.82rem;
  font-weight: 600;
  word-break: break-word;
  flex: 1;
}
.finding-required-fix {
  font-size: 0.75rem;
  color: var(--muted);
  margin-top: 0.2rem;
  padding-left: 0.2rem;
  border-left: 2px solid var(--accent);
}
.finding-evidence {
  margin-top: 0.3rem;
}
.finding-evidence summary {
  cursor: pointer;
  font-size: 0.7rem;
  color: var(--muted);
  font-weight: 600;
}
.finding-evidence ul {
  margin: 0.25rem 0 0 1.2rem;
  font-size: 0.72rem;
  color: var(--muted);
  list-style: disc;
}
.finding-evidence li { margin-bottom: 0.15rem; word-break: break-word; }
.finding-agent {
  font-size: 0.65rem;
  color: var(--muted);
  font-weight: 400;
  margin-top: 0.15rem;
}

/* Summary card */
.table-wrap {
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.summary-table {
  width: max-content;
  min-width: 100%;
  font-size: 0.82rem;
  border-collapse: collapse;
}
.summary-table th,
.summary-table td {
  padding: 0.3rem 0.6rem;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.summary-table th {
  color: var(--muted);
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}
.summary-table td:first-child {
  color: var(--muted);
  font-weight: 500;
  white-space: nowrap;
}
.summary-table tr:last-child td,
.summary-table tr:last-child th {
  border-bottom: none;
}

/* Drafter review card */
.section-nested {
  margin-top: 0.75rem;
}
.section-nested > h3,
.section-nested > h4 {
  margin-top: 0;
}
.review-section {
  padding: 0.55rem 0.85rem;
  border-bottom: 1px solid var(--border);
}
.review-section:last-child { border-bottom: none; }
.review-section h4 {
  font-size: 0.78rem;
  font-weight: 700;
  margin-bottom: 0.3rem;
  color: var(--fg);
}
.review-item {
  font-size: 0.75rem;
  padding: 0.2rem 0;
  color: var(--muted);
  display: flex;
  gap: 0.35rem;
}
.review-item .mono {
  font-family: var(--font-mono);
  font-size: 0.68rem;
}
.structured-summary-wrap { padding: 0.55rem 0.85rem; }
.audit-summary {
  padding: 0.55rem 0.85rem;
  font-size: 0.78rem;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}
.empty-inline { font-size: 0.75rem; color: var(--muted); }
.placeholder-muted { opacity: 0.5; }
.evidence-muted { opacity: 0.7; }
.concept-level-familiar { color: var(--green); }
.concept-level-heard-of { color: var(--accent); }
.concept-level-unknown { color: var(--red); }
.concept-level-default { color: var(--muted); }
.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
}
.id-chip {
  font-size: 0.65rem;
  background: var(--code-bg);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
}
.short-id { font-size: 0.65rem; }
.more-count { font-size: 0.7rem; color: var(--muted); }
.rebuttal-entry-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.3rem;
}
.updated-finding {
  margin-top: 0.4rem;
  padding: 0.4rem 0.6rem;
  background: var(--code-bg);
  border-radius: var(--radius-sm);
}
.updated-finding-title {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 0.2rem;
}

/* Rebuttal card */
.rebuttal-entry {
  padding: 0.55rem 0.85rem;
  border-bottom: 1px solid var(--border);
}
.rebuttal-entry:last-child { border-bottom: none; }
.rebuttal-decision {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 0.65rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  margin: 0.25rem 0;
}
.rebuttal-decision.withdraw { background: var(--green-bg); color: var(--green); }
.rebuttal-decision.uphold  { background: var(--red-bg); color: var(--red); }
.rebuttal-decision.soften  { background: var(--orange-bg); color: var(--orange); }
.rebuttal-speaker {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 0.15rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.rebuttal-text {
  font-size: 0.8rem;
  line-height: 1.45;
  word-break: break-word;
}

/* ── Tablet & up ── */
@media (min-width: 640px) {
  .app-main {
    padding: 1.5rem 1.25rem;
  }
  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.25rem; }
  .stats-grid { grid-template-columns: repeat(4, 1fr); gap: 0.75rem; }
  .stat-card { padding: 1rem; }
  .stat-card .stat-value { font-size: 2rem; }
  .run-card {
    padding: 0.85rem 1rem;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
  }
  .run-card-top { flex: 1; }
  .run-card-title { font-size: 1rem; }
  .run-card-meta { justify-content: flex-end; }
  .header-bar { flex-direction: row; justify-content: space-between; align-items: flex-start; }
  .header-bar h1 { font-size: 1.35rem; }
  .file-group { margin-bottom: 1rem; }
}

/* ── Desktop ── */
@media (min-width: 1024px) {
  .app-main { padding: 2rem 1.5rem; }
  .card { padding: 1rem 1.25rem; }
  .json-block { font-size: 0.8rem; }
  .md-content h1 { font-size: 1.4rem; }
  .md-content h2 { font-size: 1.2rem; }
  .md-content h3 { font-size: 1.05rem; }
}

/* ── Pipeline ── */
.pipeline-node {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.35rem 0;
}
.pipeline-node.active {
  background: var(--code-bg);
  border-left: 2px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: 0.45rem 0.5rem;
  margin: 0.2rem 0;
}
.pipeline-node-label {
  font-weight: 600;
  font-size: 0.85rem;
}
.pipeline-node-label a {
  color: var(--fg);
  text-decoration: none;
}
.pipeline-node-label a:hover {
  color: var(--accent);
  text-decoration: underline;
}
.pipeline-icon {
  display: inline-block;
  width: 1rem;
}
.pipeline-node-meta {
  font-size: 0.7rem;
  color: var(--muted);
}
.pipeline-agent-list {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding-left: 1.2rem;
  font-size: 0.75rem;
}
.pipeline-agent-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--muted);
}

/* ── Agent activity / history ── */
.agent-card-title { font-weight: 600; margin-bottom: 0.3rem; }
.agent-card-status { font-weight: 400; opacity: 0.6; font-size: 0.75rem; }
.agent-reasoning { margin-bottom: 0.25rem; }
.agent-reasoning pre {
  font-size: 0.78rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}
.summary-table-compact { font-size: 0.78rem; }
.summary-table-debug { font-size: 0.7rem; }
.cell-nowrap { white-space: nowrap; }
.cell-truncate {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cell-truncate-wide { max-width: 400px; }
.node-history-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.85rem;
}
.node-history-icon { flex-shrink: 0; }
.node-history-link { font-weight: 600; min-width: 140px; }
.node-history-meta { opacity: 0.6; font-size: 0.75rem; }
.node-history-extra { opacity: 0.5; font-size: 0.72rem; }
.node-history-error { color: var(--red); font-size: 0.72rem; }

.global-round-nav {
  margin-bottom: 0.65rem;
}
.global-round-strip {
  margin-bottom: 0.15rem;
}
.node-scope-panels {
  margin-top: 0.25rem;
}

.round-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.round-strip-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.65rem;
}
.round-strip-head h2 {
  margin: 0;
}
.round-strip-details-link {
  text-decoration: none;
}
.round-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  text-decoration: none;
  font-size: 0.82rem;
  background: inherit;
  color: inherit;
  cursor: pointer;
  font-family: inherit;
}
.round-audit-panels {
  margin-top: 0.75rem;
}
.round-audit-panel {
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--card-bg, var(--bg));
}
.round-audit-panel-head {
  margin-bottom: 0.5rem;
}
.final-output-links {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.round-chip.active {
  border-color: var(--accent);
  background: var(--accent-bg, rgba(59, 130, 246, 0.08));
}
.round-chip-num { font-weight: 700; }
.round-chip-live { color: var(--green); }

.round-audit-summaries {
  display: grid;
  gap: 0.85rem;
  margin-top: 0.85rem;
}
.round-audit-card {
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--card-bg, var(--bg));
}
.round-audit-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.round-audit-card-title {
  font-weight: 700;
  font-size: 0.88rem;
}
.round-audit-card-link {
  margin-left: auto;
  text-decoration: none;
}
.audit-vote-table-compact {
  margin-bottom: 0;
  font-size: 0.82rem;
}
.audit-vote-table-compact th,
.audit-vote-table-compact td {
  padding: 0.3rem 0.45rem;
}
.audit-row-status.running {
  color: var(--orange);
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
}
.audit-row-status.error { color: var(--red); font-size: 0.82rem; }
.audit-row-spinner {
  width: 0.65rem;
  height: 0.65rem;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: audit-row-spin 0.75s linear infinite;
}
@keyframes audit-row-spin {
  to { transform: rotate(360deg); }
}

.round-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 1rem;
}
.round-nav-chip {
  padding: 0.25rem 0.55rem;
  border: 1px solid var(--border);
  border-radius: 0.35rem;
  text-decoration: none;
  font-size: 0.78rem;
}
.round-nav-chip.active {
  border-color: var(--accent);
  font-weight: 700;
}
.round-nav-chip.done {
  opacity: 0.85;
}

.round-step {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem;
  padding: 0.35rem 0;
  font-size: 0.85rem;
}
.round-step.active .round-step-icon { color: var(--accent); }
.round-step.done .round-step-icon { color: var(--green); }
.round-step-label { font-weight: 600; min-width: 6rem; }

.node-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
  gap: 0.65rem;
}
.node-grid-card {
  display: block;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  text-decoration: none;
  color: inherit;
}
.node-grid-card.active {
  border-color: var(--accent);
  background: var(--accent-bg, rgba(59, 130, 246, 0.06));
}
.node-grid-card:hover {
  border-color: var(--accent);
}
.node-grid-title {
  font-weight: 600;
  font-size: 0.82rem;
  margin-bottom: 0.25rem;
}
.node-grid-kpis {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.72rem;
  opacity: 0.85;
}
.outcome-banner-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 0.85rem;
}
.audit-round-panel {
  margin-bottom: 1.25rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}
.audit-round-panel:last-child {
  border-bottom: none;
  margin-bottom: 0;
}
.audit-round-panel-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.65rem;
}
.audit-round-panel-header h3 {
  margin: 0;
  font-size: 1rem;
}
.audit-vote-table { margin-bottom: 0.75rem; }
.audit-findings-details { margin-top: 0.5rem; }
.audit-findings-details summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}
.audit-auditor-card { margin-top: 0.75rem; }
.audit-rounds-nav { margin-bottom: 1rem; }

.live-meta { opacity: 0.85; font-size: 0.85rem; }

.debug-log-scroll {
  max-height: 32rem;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}
.debug-log-viewer {
  margin-bottom: 0;
}
.debug-log-toolbar {
  padding: 0.65rem 0.85rem;
  border-bottom: 1px solid var(--border);
}
.debug-log-entry {
  border-bottom: 1px solid var(--border);
}
.debug-log-entry:last-child {
  border-bottom: none;
}
.debug-log-entry-flat,
.debug-log-summary {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
  padding: 0.55rem 0.85rem;
}
.debug-log-summary {
  cursor: pointer;
  list-style: none;
}
.debug-log-summary::-webkit-details-marker {
  display: none;
}
.debug-log-summary::before {
  content: "▸";
  color: var(--muted);
  font-size: 0.7rem;
  transition: transform 0.15s;
}
.debug-log-entry[open] > .debug-log-summary::before {
  transform: rotate(90deg);
}
.debug-log-time {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--muted);
  white-space: nowrap;
}
.debug-log-type {
  font-size: 0.62rem;
  word-break: break-word;
}
.debug-log-payload {
  padding: 0 0.85rem 0.75rem 1.35rem;
}

/* ── Active run hero ── */
.active-run-hero {
  border-left: 2px solid var(--orange);
  background: var(--bg-card);
}
.active-run-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}
.active-run-refresh {
  font-size: 0.65rem;
  color: var(--muted);
}
.active-run-topic {
  font-weight: 700;
  font-size: 1rem;
  margin-bottom: 0.25rem;
}
.active-run-topic a { color: var(--fg); }
.active-run-pipeline {
  font-size: 0.78rem;
  color: var(--muted);
  margin-bottom: 0.35rem;
}
.active-run-agents {
  font-size: 0.72rem;
  color: var(--muted);
}

/* ── Interview chat card ── */
.interview-profile-so-far {
  margin: 0.75rem 0 1rem;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
}
.interview-profile-so-far .reader-profile-summary {
  margin-top: 0.35rem;
}
.interview-card {
  background: var(--panel);
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  padding: 1rem;
}
.chat-transcript {
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0.5rem 0;
  font-size: 0.9rem;
}
.interviewer-msg, .reader-msg {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
}
.chat-icon {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding-top: 0.15rem;
  min-width: 1.8rem;
}
.interviewer-msg .chat-icon { color: var(--accent); }
.reader-msg .chat-icon { color: var(--green); }
.chat-text { white-space: pre-wrap; flex: 1; }
.chat-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.chat-form textarea {
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
  font-size: 0.9rem;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--fg);
  resize: vertical;
}
.chat-question-block {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-bottom: 0.6rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px dashed var(--border);
}
.chat-question-block:last-of-type {
  border-bottom: none;
}
/* ── Interview history toggle (problem 2) ── */
.interview-history {
  margin: 0.5rem 0;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  padding: 0.5rem;
  opacity: 0.9;
}
.interview-history > summary {
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--muted);
  user-select: none;
}
.interview-history > summary:hover {
  color: var(--fg);
}
.interview-history .chat-transcript {
  margin-top: 0.5rem;
  opacity: 0.75;
}
.chat-answered-turn {
  padding: 0.4rem 0.6rem;
  margin-bottom: 0.5rem;
  border-left: 2px solid var(--border);
}
.chat-turn-label {
  font-size: 0.7rem;
  color: var(--muted);
  margin-bottom: 0.3rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
/* ── Current pending turn (problem 2) ── */
.interview-current {
  margin-top: 0.75rem;
  padding: 0.75rem;
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: var(--radius);
}
.chat-current-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.chat-form button {
  align-self: flex-start;
  padding: 0.35rem 0.75rem;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--bg);
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 600;
}

/* ── Failure banner ── */
.failure-banner {
  background: var(--red-bg);
  border: 1px solid var(--red);
  border-radius: var(--radius);
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
}
.failure-banner-title {
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--red);
  margin-bottom: 0.3rem;
}
.failure-banner-detail {
  font-size: 0.8rem;
  color: var(--fg);
}
.failure-banner-error {
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: var(--muted);
  font-family: var(--font-mono);
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── Markdown preview ── */
.markdown-preview summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
  padding: 0.4rem 0;
  user-select: none;
  list-style: none;
}
.markdown-preview summary::-webkit-details-marker { display: none; }
.markdown-preview summary::before {
  content: "▸";
  margin-right: 0.35rem;
  font-size: 0.7rem;
  transition: transform 0.15s;
}
details[open] > .markdown-preview summary::before {
  transform: rotate(90deg);
}

.telemetry-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.75rem;
}

.telemetry-strip-compact {
  margin-bottom: 0.5rem;
}

.telemetry-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.22rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--fg);
}

.agent-card-tokens {
  font-family: var(--font-mono);
  font-size: 0.72rem;
}

.refresh-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.5rem 0 0.75rem;
  font-size: 0.75rem;
  color: var(--muted);
}
.refresh-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--muted);
  opacity: 0.5;
}
.refresh-dot.polling {
  background: var(--accent);
  opacity: 1;
}
.refresh-button {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--fg);
  padding: 0.22rem 0.45rem;
  cursor: pointer;
  font-size: 0.72rem;
}
.refresh-button:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.refresh-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  cursor: pointer;
  user-select: none;
}
.refresh-toggle input {
  margin: 0;
  accent-color: var(--accent);
}

.config-form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-top: 0.5rem;
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.form-field > span {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.form-field > small {
  color: var(--muted);
  font-size: 0.72rem;
  line-height: 1.35;
}
.form-section {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.form-section > h3 {
  margin: 0;
  color: var(--fg);
}
.form-checkbox {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 0.45rem;
  width: fit-content;
  max-width: 100%;
  cursor: pointer;
}
.form-checkbox > input[type="checkbox"] {
  margin: 0;
  flex-shrink: 0;
}
.form-checkbox > span {
  font-family: inherit;
  font-size: 0.85rem;
  color: var(--fg);
  text-transform: none;
  letter-spacing: normal;
}
.form-checkbox > small {
  width: 100%;
}
.checkbox-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
}
.form-input,
.form-field textarea,
.config-form textarea {
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
  font-size: 0.85rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--fg);
  resize: vertical;
}
.form-input:focus,
.form-field textarea:focus,
.config-form textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
}
.config-form textarea,
.form-field textarea.new-run-textarea {
  line-height: 1.55;
}
.config-readonly-agent {
  margin: 0;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  font-family: var(--font-mono);
  font-size: 0.85rem;
  line-height: 1.5;
  white-space: pre-wrap;
  max-height: 24rem;
  overflow: auto;
}
.form-fields-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.6rem;
}
@media (min-width: 640px) {
  .form-fields-grid { grid-template-columns: repeat(2, 1fr); }
}
.form-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.btn {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--fg);
  padding: 0.32rem 0.7rem;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 500;
}
.btn:hover { border-color: var(--accent); color: var(--accent); }
.btn-primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--bg);
}
.btn-primary:hover { color: var(--bg); opacity: 0.9; }
.btn-secondary {
  border-color: var(--border);
  background: transparent;
  color: var(--fg-muted);
}
.btn-secondary:hover { color: var(--accent); border-color: var(--accent); }
.inline-form {
  display: inline-block;
  margin: 0;
}
.form-actions .inline-form + .btn,
.form-actions .btn + .inline-form {
  margin-left: 0.5rem;
}
.provider-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  padding: 0.2rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  width: fit-content;
}
.provider-tab-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.provider-tab {
  display: inline-flex;
  align-items: center;
  padding: 0.3rem 0.7rem;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}
.provider-tab:hover { color: var(--fg); }
.provider-tab-input:checked + .provider-tab {
  background: var(--accent);
  color: var(--bg);
  font-weight: 600;
}
.provider-tab-input:focus-visible + .provider-tab {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* ── Theme toggle ── */
.theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.55rem;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.02em;
  color: var(--muted);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.theme-toggle:hover {
  color: var(--fg);
  border-color: var(--muted);
}

/* ── HTML viewer ── */
html:has(.html-viewer-body),
body.html-viewer-body {
  height: 100%;
  overflow: hidden;
  padding: 0;
  max-width: none;
  width: 100%;
  margin: 0;
}

.html-viewer-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  background: var(--bg);
}

.html-viewer-download {
  font-weight: 600;
}

.html-viewer-sidebar-toggle {
  display: inline-flex;
  align-items: center;
  padding: 0.3rem 0.55rem;
  font-size: 0.75rem;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.html-viewer-main {
  display: flex;
  flex: 1;
  min-height: 0;
}

.html-viewer-frame-wrap {
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--bg-subtle);
}

.html-viewer-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #fff;
}

.html-viewer-sidebar {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.85rem;
  border-left: 1px solid var(--border);
  background: var(--bg-card);
  min-height: 0;
  overflow: hidden;
  transition: width 0.2s ease, padding 0.2s ease, opacity 0.2s ease;
}

.html-viewer-shell.html-viewer-sidebar-collapsed .html-viewer-sidebar {
  width: 0;
  padding: 0;
  border-left-width: 0;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
}

.html-viewer-sidebar-header {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.html-viewer-sidebar-title-row {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

.html-viewer-sidebar-close {
  flex-shrink: 0;
  width: 1.6rem;
  height: 1.6rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  line-height: 1;
  color: var(--muted);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.html-viewer-sidebar-close:hover {
  color: var(--fg);
  border-color: var(--muted);
}

.html-viewer-sidebar-title {
  font-size: 0.95rem;
  font-weight: 600;
}

.html-viewer-sidebar-hint {
  font-size: 0.75rem;
  margin-top: 0.15rem;
}

.html-viewer-sidebar-tabs {
  display: flex;
  gap: 0.35rem;
  flex-shrink: 0;
}

.html-viewer-tab {
  flex: 1;
  padding: 0.3rem 0.45rem;
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--muted);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.html-viewer-tab-active {
  color: var(--fg);
  border-color: var(--accent);
  background: var(--accent-dim);
}

.html-viewer-panel {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.html-viewer-panel[hidden] {
  display: none !important;
}

.html-viewer-panel-header {
  flex-shrink: 0;
}

.html-viewer-highlight-unsupported {
  font-size: 0.75rem;
  padding: 0.45rem 0.55rem;
  border: 1px solid var(--orange);
  border-radius: var(--radius-sm);
  background: var(--orange-bg);
}

.html-viewer-highlight-compose {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.55rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.html-viewer-highlight-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--muted);
}

.html-viewer-highlight-selection {
  width: 100%;
  resize: vertical;
  min-height: 4rem;
  padding: 0.55rem;
  font-family: var(--font-sans);
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--fg);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.html-viewer-highlight-colors {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.html-viewer-color-swatch {
  width: 1.35rem;
  height: 1.35rem;
  border: 2px solid transparent;
  border-radius: 999px;
  cursor: pointer;
  padding: 0;
}

.html-viewer-color-swatch-active {
  border-color: var(--fg);
  box-shadow: 0 0 0 1px var(--border);
}

.html-viewer-highlight-actions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.html-viewer-highlight-save {
  font-weight: 600;
}

.html-viewer-highlight-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.html-viewer-highlight-empty {
  font-size: 0.75rem;
}

.html-viewer-highlight-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.45rem;
  padding: 0.55rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.html-viewer-highlight-item-main {
  display: flex;
  gap: 0.45rem;
  min-width: 0;
  flex: 1;
}

.html-viewer-highlight-swatch {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 999px;
  margin-top: 0.25rem;
  flex-shrink: 0;
  border: 1px solid var(--border);
}

.html-viewer-highlight-item-text {
  min-width: 0;
}

.html-viewer-highlight-quote {
  font-size: 0.8rem;
  line-height: 1.4;
  word-break: break-word;
}

.html-viewer-highlight-meta {
  font-size: 0.68rem;
  margin-top: 0.2rem;
}

.html-viewer-highlight-missing {
  font-size: 0.68rem;
  color: var(--orange);
}

.html-viewer-highlight-delete {
  flex-shrink: 0;
  padding: 0.2rem 0.45rem;
  font-size: 0.68rem;
  color: var(--red);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.html-viewer-highlight-delete:hover {
  border-color: var(--red);
  background: var(--red-bg);
}

.html-viewer-notes-form {
  display: flex;
  flex: 1;
  min-height: 0;
}

.html-viewer-notes {
  width: 100%;
  flex: 1;
  min-height: 12rem;
  resize: vertical;
  padding: 0.65rem;
  font-family: var(--font-sans);
  font-size: 0.85rem;
  line-height: 1.45;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.html-viewer-notes:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.html-viewer-save-status {
  flex-shrink: 0;
  font-size: 0.72rem;
}

.html-viewer-save-status-error {
  color: var(--red);
}

.html-viewer-save-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.72rem;
  color: var(--muted);
}

.html-viewer-save-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: var(--muted);
  flex-shrink: 0;
}

.html-viewer-save-indicator[data-state="idle"] .html-viewer-save-dot {
  background: var(--muted);
}

.html-viewer-save-indicator[data-state="unsaved"] .html-viewer-save-dot {
  background: var(--orange);
}

.html-viewer-save-indicator[data-state="saving"] .html-viewer-save-dot {
  background: var(--orange);
  animation: html-viewer-save-pulse 0.9s ease-in-out infinite;
}

.html-viewer-save-indicator[data-state="saved"] .html-viewer-save-dot {
  background: var(--green);
}

.html-viewer-save-indicator[data-state="error"] .html-viewer-save-dot {
  background: var(--red);
}

.html-viewer-save-indicator[data-state="saved"] .html-viewer-save-label {
  color: var(--green);
}

.html-viewer-save-indicator[data-state="error"] .html-viewer-save-label {
  color: var(--red);
}

.html-viewer-save-indicator-flash {
  animation: html-viewer-save-flash 1.2s ease;
}

@keyframes html-viewer-save-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@keyframes html-viewer-save-flash {
  0% { background: var(--green-bg); border-radius: var(--radius-sm); }
  100% { background: transparent; }
}

@media (max-width: 860px) {
  .html-viewer-sidebar {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 45;
    width: min(320px, 92vw);
    transform: translateX(100%);
    transition: transform 0.2s ease, width 0.2s ease, padding 0.2s ease, opacity 0.2s ease;
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
    opacity: 1;
    overflow: auto;
    pointer-events: auto;
  }

  .html-viewer-sidebar-open {
    transform: translateX(0);
  }
}

@media (min-width: 861px) {
  .html-viewer-sidebar-close {
    display: none;
  }
}

.html-viewer-highlight-item-actions {
  display: flex;
  gap: 0.35rem;
  flex-shrink: 0;
}

.html-viewer-highlight-ask {
  font-size: 0.72rem;
  padding: 0.2rem 0.45rem;
}

.html-viewer-panel[data-html-panel="ask"] {
  overflow: hidden;
}

.html-viewer-ask-layout {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  min-height: 0;
  flex: 1;
  height: 100%;
}

.html-viewer-ask-chat-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 9rem;
  overflow: auto;
  flex-shrink: 0;
}

.html-viewer-ask-chat-list-header {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.html-viewer-ask-chat-row {
  display: flex;
  align-items: stretch;
  gap: 0.25rem;
}

.html-viewer-ask-chat-row-active .html-viewer-ask-chat-open {
  border-color: var(--accent);
  background: var(--accent-bg, rgba(59, 130, 246, 0.08));
}

.html-viewer-ask-chat-open {
  flex: 1;
  min-width: 0;
  text-align: left;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--fg);
  border-radius: var(--radius-sm);
  padding: 0.4rem 0.55rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.html-viewer-ask-chat-title {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.html-viewer-ask-chat-meta {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.68rem;
  color: var(--muted);
}

.html-viewer-ask-chat-badge {
  display: inline-block;
  padding: 0.05rem 0.3rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
}

.html-viewer-ask-chat-delete {
  flex: 0 0 auto;
  width: 1.75rem;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
}

.html-viewer-ask-chat-delete:hover {
  color: var(--fg);
  border-color: var(--accent);
}

.html-viewer-ask-bootstrap {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex-shrink: 0;
}

.html-viewer-ask-bootstrap-label {
  font-size: 0.72rem;
  color: var(--muted);
}

.html-viewer-ask-bootstrap-select {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--fg);
  border-radius: var(--radius-sm);
  padding: 0.35rem 0.45rem;
  font-size: 0.78rem;
}

.html-viewer-ask-thread-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 8rem;
  overflow: auto;
}

.html-viewer-ask-thread {
  text-align: left;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--fg);
  border-radius: var(--radius-sm);
  padding: 0.4rem 0.55rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.html-viewer-ask-thread-active {
  border-color: var(--accent);
  background: var(--accent-bg, rgba(59, 130, 246, 0.08));
}

.html-viewer-ask-context {
  font-size: 0.78rem;
  padding: 0.45rem 0.55rem;
  border-radius: var(--radius-sm);
  background: var(--card);
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.html-viewer-ask-messages {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.25rem 0;
}

.html-viewer-ask-empty {
  margin: 0;
  font-size: 0.8rem;
}

.html-viewer-ask-message {
  display: flex;
}

.html-viewer-ask-message-user {
  justify-content: flex-end;
}

.html-viewer-ask-message-assistant {
  justify-content: flex-start;
}

.html-viewer-ask-message-body {
  max-width: 92%;
  padding: 0.45rem 0.6rem;
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.html-viewer-ask-message-user .html-viewer-ask-message-body {
  background: var(--accent-bg, rgba(59, 130, 246, 0.12));
  border: 1px solid var(--border);
}

.html-viewer-ask-message-assistant .html-viewer-ask-message-body {
  background: var(--card);
  border: 1px solid var(--border);
}

.html-viewer-ask-message-assistant .html-viewer-ask-message-body.md-content {
  white-space: normal;
}

.html-viewer-ask-message-assistant .md-content > :first-child {
  margin-top: 0;
}

.html-viewer-ask-message-assistant .md-content > :last-child {
  margin-bottom: 0;
}

.html-viewer-ask-message-assistant .md-content pre {
  overflow-x: auto;
}

.html-viewer-ask-form {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  flex-shrink: 0;
  margin-top: auto;
}

.html-viewer-ask-status {
  flex-shrink: 0;
  margin: 0;
  font-size: 0.72rem;
}

.html-viewer-ask-input {
  width: 100%;
  min-height: 3rem;
  max-height: 8rem;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.45rem 0.55rem;
  font-family: inherit;
  font-size: 0.78rem;
  line-height: 1.4;
  background: var(--bg);
  color: var(--fg);
}

.html-viewer-ask-input:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.html-viewer-ask-actions {
  display: flex;
  gap: 0.45rem;
}

.html-viewer-ask-send {
  flex: 1;
}

.html-viewer-ask-status-error {
  color: var(--red, #dc2626);
}

.html-viewer-ask-sheet {
  display: none;
}

@media (max-width: 860px) {
  .html-viewer-panel[data-html-panel="ask"] {
    position: relative;
  }

  .html-viewer-ask-sheet-open .html-viewer-ask-sheet {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 50;
    background: rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }

  .html-viewer-ask-sheet-open .html-viewer-panel[data-html-panel="ask"]:not([hidden]) {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 55;
    max-height: min(78vh, 640px);
    background: var(--bg);
    border-top: 1px solid var(--border);
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.18);
    padding: 0.75rem;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .html-viewer-ask-sheet-handle {
    width: 2.5rem;
    height: 0.25rem;
    border-radius: 999px;
    background: var(--border);
    margin: 0.5rem auto 0;
  }

  .html-viewer-ask-messages {
    flex: 1;
    min-height: 0;
  }
}

/* ── Mobile fixes ── */
@media (max-width: 400px) {
  .run-card-top { flex-direction: column; }
  .pipeline-agent-list { padding-left: 0.5rem; font-size: 0.7rem; }
  .file-list li a { word-break: break-all; }
}
`
