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
@media (prefers-color-scheme: dark) {
  :root {
    /* Dark mode: grep near-black, deliberately tuned (not an inversion) */
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

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font-sans);
  background: var(--bg);
  color: var(--fg);
  line-height: 1.5;
  letter-spacing: -0.011em;
  -webkit-text-size-adjust: 100%;
}

/* ── Layout (mobile-first: narrow) ── */
body {
  padding: 1rem 0.75rem;
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
  overflow-x: auto;
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
.header-main { flex: 1; min-width: 0; }
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
  gap: 0.5rem 1rem;
}
.meta-item {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}
.meta-item strong { color: var(--fg); font-weight: 600; }

/* ── Back link ── */
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
  color: var(--muted);
}
.back-link:hover { color: var(--accent); }

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
  grid-template-columns: auto minmax(0, 1fr) auto;
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
.file-icon { font-size: 1rem; }
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
.summary-table {
  width: 100%;
  font-size: 0.82rem;
  min-width: 300px;
}
.summary-table td {
  padding: 0.3rem 0.6rem;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.summary-table td:first-child {
  color: var(--muted);
  font-weight: 500;
  white-space: nowrap;
  width: 1%;
}
.summary-table tr:last-child td { border-bottom: none; }

/* Drafter review card */
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
  body {
    padding: 1.5rem 1.25rem;
    max-width: 960px;
    margin: 0 auto;
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
  body { padding: 2rem 1.5rem; }
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
.debug-log-scroll {
  max-height: 500px;
  overflow-y: auto;
  font-size: 0.72rem;
  font-family: var(--font-mono);
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
  padding: 0.5rem 1rem;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--bg);
  cursor: pointer;
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

/* ── Run navigation ── */
.run-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  font-size: 0.8rem;
}
.run-nav a { color: var(--muted); }
.run-nav a:hover { color: var(--accent); }
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
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  font: inherit;
}
.refresh-button:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* ── Mobile fixes ── */
@media (max-width: 400px) {
  .run-card-top { flex-direction: column; }
  .pipeline-agent-list { padding-left: 0.5rem; font-size: 0.7rem; }
  .file-list li a { word-break: break-all; }
  .run-nav { flex-direction: column; align-items: flex-start; }
}
`
