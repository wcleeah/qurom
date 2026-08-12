# research-qurom

An agent loop that generates a research document on a specific topic. Each agent role runs through a **provider** — **OpenCode** (default) or **Cursor** — configured per role in SQLite. One drafter and three auditors debate through a quorum review loop, orchestrated by a web dashboard for starting runs, live monitoring, and artifact review.

https://github.com/user-attachments/assets/488d9741-d4ad-454f-bb34-422627048370

## What It Does

- Accepts either a topic prompt or a document (paste in the browser, load a local file, or provide a server path).
- Runs an optional **reader discovery** interview to learn what the reader already knows before drafting.
- Writes a full draft from the request and evidence, then runs revision rounds when needed.
- Runs three auditors in parallel to review the draft from different perspectives.
- Aggregates findings, rebuttals, and approvals until the run is approved or fails.
- When enabled, an optional **design quorum** turns an approved document into a self-contained HTML page (`final.html`).
- Streams live activity into the web dashboard: pipeline, telemetry, reader interview, HTML viewer, and artifact browser.
- Captures Langfuse telemetry when configured.

## The Big Picture

1. `bun run dev` starts the web dashboard (default `http://localhost:3000`).
2. Start a research run from the index page (topic, pasted document, or resume).
3. The run manager creates an event bus and starts `runResearchPipeline`.
4. Each role's provider is started lazily when that role is first needed (`opencode` or `cursor`).
5. Live status is written to `live-status.json` and polled by the dashboard.
6. Reader interview replies are submitted from the run page (`POST /runs/:name/reply`).
7. When the run completes, artifacts land under `{dataDir}/runs/` and the dashboard shows the verdict.

## Current Agent Roles

Research quorum:

- `research-drafter`
- `source-auditor`
- `logic-auditor`
- `clarity-auditor`
- `markdown-summarizer` (post-run summary)

Reader discovery:

- `reader-interviewer`
- `reader-profile-repairer` (intent-only upgrade on **Rerun (repair profile)**)

Design quorum (when `designQuorum.enabled` is true):

- `html-designer`
- `interactive-enhancer`
- `reading-experience-enhancer`

HTML viewer:

- `html-reading-companion` (ask-about-page agent in the HTML viewer)
- `html-repair` (viewer Fix flow: repair `final.html` bugs and verify with Playwright MCP)

Recovery helpers (structured-output recovery router):

- `json-fixer`

These roles are configured in the active SQLite config profile. Each role is bound to a provider (`opencode` by default, or `cursor`) in `/config`.

**OpenCode-backed roles** also need matching agent definitions under `.opencode/agents/` (bootstrapped from `defaults/opencode/agents/` on first run). **Cursor-backed roles** need `CURSOR_API_KEY` and use Cursor cloud agents instead of local OpenCode sessions.

## Requirements

- **Bun** (runtime + test runner)
- **At least one agent provider** configured for the roles you plan to run:
  - **OpenCode** (default) — `opencode` on your `PATH`, plus `.opencode/agents/` seeded from `defaults/opencode/agents/`. Qurom always launches and owns `opencode serve`; startup fails if the configured port is already occupied.
  - **Cursor** (optional) — `CURSOR_API_KEY` and role bindings set to the `cursor` provider in `/config`. No local OpenCode server or agent files required for Cursor-only roles.

Full call-site prompts live in SQLite. Shipped starters are under `defaults/prompts/` (one file per role×task). OpenCode agent files under `defaults/opencode/agents/` hold model/permissions frontmatter only. Default role provider bindings live in `defaults/quorum-config.sqlite`.

Optional:

- Langfuse credentials for trace export

## Configuration

Runtime config is stored in SQLite under the Qurom data directory. Shipped defaults live in `defaults/` and are seeded on first run.

The `/config/mcp` dashboard page is the sole MCP registry for both Cursor and OpenCode. Add a structured local server (`command`, arguments, environment, optional working directory) or remote server (`url`, headers, optional OAuth), then select the globally enabled servers. This enabled list is independent of `researchTools.prefer`. Values may reference environment variables as `${NAME}`, `${env:NAME}`, or `{ENV:NAME}`; placeholders remain stored and are resolved immediately before provider startup.

New profiles (and lazy migration) seed a headless Playwright MCP server (`npx @playwright/mcp@latest --headless`) and enable it by default so the HTML Fix agent can verify scroll, mobile overflow, and UI checks in a real browser.

Qurom does not read `~/.cursor/mcp.json`, role-level `mcpServers`, or external OpenCode MCP configuration. It preserves unrelated JSON from `OPENCODE_CONFIG_CONTENT`, replaces its `mcp` section with the enabled registry, and passes the result to the OpenCode process it launches.

Data directory resolution:

1. `QUORUM_DATA_DIR` if set
2. otherwise `$XDG_DATA_HOME/qurom`
3. otherwise `~/.local/share/qurom`

Derived paths:

- `{dataDir}/quorum-config.sqlite` — quorum config, prompts, role instructions, bindings
- `{dataDir}/checkpoints.sqlite` — LangGraph checkpoints
- `{dataDir}/runs/` — run artifacts
- `{dataDir}/archive/` — archived run directories (moved out of `runs/`)

Main environment variables:

- `OPENCODE_BASE_URL`
- `OPENCODE_DIRECTORY` — repo checkout (OpenCode workspace; `.opencode/agents/` lives here)
- `QUORUM_DATA_DIR` — optional override for the data directory above
- `QUORUM_OPENCODE_BOOTSTRAP` — non-interactive OpenCode agent bootstrap (`seed`, `overwrite`, `keep`)
- `QUORUM_CAPTURE_OPENCODE_EVENTS`
- `QUORUM_CAPTURE_SYNC_HISTORY`
- `VIEW_PORT` / `VIEW_HOST` — dashboard bind address (default `3000` / `0.0.0.0`)
- `CURSOR_API_KEY` — Cursor provider API key
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL`
- `LANGFUSE_TRACING_ENVIRONMENT` — optional; falls back to `RAILWAY_ENVIRONMENT_NAME` or `default`
- `LANGFUSE_RELEASE` — optional; falls back to `RAILWAY_GIT_COMMIT_SHA`

Default values are defined in `src/config.ts` and `src/data-paths.ts`.

## Setup

1. Clone the repo:

```bash
git clone <repo-url> qurom
cd qurom
```

2. Install dependencies (also populates `.opencode/node_modules` for agent defs):

```bash
bun install
```

3. Copy the env template and edit it:

```bash
cp .env.example .env
```

Set at least:

- `OPENCODE_DIRECTORY` — absolute path to this repo (OpenCode workspace when using the OpenCode provider)
- `OPENCODE_BASE_URL` — OpenCode server URL (only needed for OpenCode-bound roles)

If any role uses Cursor, also set `CURSOR_API_KEY`.

On first dashboard start, Qurom seeds SQLite from `defaults/`, auto-seeds missing `.opencode/agents/` files when using OpenCode, and shows a bootstrap banner on the index page if local agents differ from shipped defaults. Existing repo-local `runs/` data is auto-migrated into `~/.local/share/qurom/` (or `$XDG_DATA_HOME/qurom`).

Leave the `LANGFUSE_*` keys blank to skip cloud tracing. When set, Qurom uses a process-level OpenTelemetry provider (`batched` export) and mirrors token usage into Langfuse Generations/Agents for OpenCode and Cursor. Local `session-telemetry.json` remains the dashboard cost source of truth.

4. If you use OpenCode-bound roles, confirm `opencode` is on your `PATH` (`opencode --version`).

5. (Optional) typecheck and tests:

```bash
bun run typecheck
bun run test
```

Then run `bun run dev` and open `http://localhost:3000`.

## Run

```bash
bun run dev          # web dashboard + run orchestration
bun run view:admin   # same, with shipped-defaults editor routes enabled
```

Start runs from the index page, or via HTTP API:

- `POST /api/runs` — new research run (`inputMode`, `topic` or `documentText` / `documentPath`)
- `POST /api/runs/:id/restart-from-source` — new document run from a prior run's `input.md`
- `POST /api/runs/:id/rerun` — new run from a prior run's topic or `input.md` (`interview=reuse|fresh`; reuse seeds `reader-profile.json` and skips the interview)
- `POST /api/runs/:id/resume` — resume research or design from checkpoint (`node` optional)
- `POST /api/runs/:id/cancel` — cancel active run
- `POST /api/runs/:id/archive` — move an idle run into `{dataDir}/archive/`
- `POST /api/runs/:id/unarchive` — restore an archived run back into `runs/`
- `GET /api/status` — active run + provider lifecycle status

## Static export

Export every successful run as a read-only site that needs no build step or
server at deployment time:

```bash
bun run export:static
# or choose a destination
bun run export:static --output ./public
```

The default destination is `dist/static`. Upload that directory directly to a
static host such as Cloudflare Pages, Railway, or S3 website hosting. The
export contains a catalog at `/`, a stripped detail page for each successful
run, and the exact generated artifact at `/runs/<id>/share/`. Links are
relative, so the directory can also be hosted below a URL prefix.

Only runs with approved research and a completed `final.html` are included.
Regenerating the export replaces the destination, removing stale runs.
Generated HTML may reference CDN resources of its own; the exporter preserves
`final.html` byte-for-byte and does not download or rewrite those dependencies.

For a repository already linked to a Railway service, export and deploy in one
command:

```bash
bun run deploy:railway
```

This regenerates `dist/static` and uploads the complete directory with
Railway's gitignore filtering disabled.

### Live app on Railway

The live dashboard deploys from the repo `Dockerfile` (Bun + OpenCode). Persist
data with a volume mounted at `/data` (`QUORUM_DATA_DIR=/data`).

Push local runtime config and missing runs to the linked Railway volume:

```bash
bun run migrate:prod
# bun run migrate:prod --dry-run
# bun run migrate:prod --skip-runs
# bun run migrate:prod --skip-config
```

Do not run this casually against production without reviewing what will upload.

When `QUORUM_DEFAULTS_GIT_PR=1` and `GITHUB_TOKEN` are set, saving shipped
defaults in the admin UI opens a GitHub PR against `QUORUM_GITHUB_PR_BASE`
(default `main`) for the changed files under `defaults/`.

## Dashboard Flow

### Index (`/`)

- Start a topic or document run, or resume a prior run from checkpoint
- One active pipeline run at a time
- Live refresh for the active-run hero when a run is in progress
- OpenCode agent bootstrap controls when local agents differ from defaults
- Filter tabs: Unread / Read / All / Archived (`/?archived=1` lists archived runs and can unarchive them)

### Run detail (`/runs/:name`)

- Pipeline, telemetry, agent activity, reader interview, artifacts
- On-demand public share link at `/share/:token` (create/revoke from the run page; requires `final.html`)
- Cancel while running; completion banner when done
- Archive idle runs (moves the directory into `{dataDir}/archive/`)
- Configure quorum, roles, and prompts under `/config`

## Notes

- Shipped defaults live under `defaults/`. User data (runs, SQLite DBs) lives under `~/.local/share/qurom/` by default.
- Document-mode runs accept pasted markdown in the browser (saved as `input.md` in the run directory), a local file loaded into the compose area, or a path on the server.
- Run artifacts include the request, per-round drafts, audits, rebuttal reviews, aggregated findings, reader profile/transcript, and final or failure outputs.
- Run cancellation aborts the pipeline; OpenCode sessions opened during the run are explicitly aborted.
- Failed runs attempt to recover the latest checkpointed state and write failure artifacts when possible.

## Recovery & Telemetry

When an agent produces malformed, missing, or schema-invalid structured output, `promptAgent` runs an in-session **recovery router** before failing the run. The ladder is `D` (free `coerceJson` pre-clean) → `A`/`B`/`C` (same-agent reprompt, schema-aware reprompt with `<zod_issues>`, or `json-fixer` agent) → `R` (auditor-only fresh-session restart) → run failure. On budget exhaustion a typed `StructuredRecoveryError` is thrown.

Every recovery tier emits a standardized debug-log event. Grep `{dataDir}/runs/<rid>/debug-log.jsonl` for:

| Event | Emitted by | Meaning |
|---|---|---|
| `session.recovery.classify` | recovery router | Fault classified (`nooutput`/`truncated`/`syntax`/`schema`/`transport`) with remaining budgets |
| `session.recovery.reprompt` | A/B branches | Same-agent in-session reprompt with `kind` |
| `session.repair.json_fixer` | C branch | `json-fixer` agent invoked |
| `audit.restart_from_scratch` | `auditWithRestart` (R tier) | Auditor re-run on a fresh provider session (OpenCode today) |
| `session.dual_output` | persistence | Agent wrote `outputFile` AND returned valid inline JSON that differs; file is preferred |
| `recovery.systemic_drift` | drift detector | Same agent restarted across two distinct `requestId`s in one process |

### Kill-switch

`auditRestart.maxRestarts` in the active SQLite quorum config (editable at `/config`) controls the R tier. Set it to `0` to disable fresh-session restarts. Default is `1`.

## Design Quorum

When `designQuorum.enabled` is true, an approved research run can be turned into a single self-contained HTML document. The design phase is linear: `html-designer` writes `design-html-html-designer.html`, `interactive-enhancer` writes comprehension-focused `design-html-interactive-enhancer.html`, `reading-experience-enhancer` writes screen-reading ergonomics to `design-html-reading-experience-enhancer.html`, and `finalizeDesign` publishes `final.html`.

Resume design from the dashboard **Resume run** action or:

```bash
curl -X POST http://localhost:3000/api/runs/my-topic-abc123/resume
```

Output is written to `<run-directory>/final.html`.

## Documentation

| Doc | Purpose |
|---|---|
| [docs/architecture.md](./docs/architecture.md) | Deep dive: subsystems, data flow, debugging |
| [docs/provider-integration.md](./docs/provider-integration.md) | Adding or changing agent providers |
| [docs/archive/recovery-router/](./docs/archive/recovery-router/) | Completed plan: structured-output recovery router |
| [docs/archive/reader-discovery/](./docs/archive/reader-discovery/) | Reader interview plan (phases 1–2 shipped; 3–4 open) |
| [docs/archive/v1-implementation/](./docs/archive/v1-implementation/) | Completed plan: original v1 build |
| [docs/archive/tui-implementation/](./docs/archive/tui-implementation/) | Completed plan: OpenTUI shell (superseded by web dashboard) |
