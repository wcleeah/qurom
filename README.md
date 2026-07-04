# research-qurom 
A agent loop that generate a research document on a specific topic powered by Opencode. It runs one designated drafter and three auditors agent through a quorum review loop, with a web dashboard for starting runs, live monitoring, and artifact review.

https://github.com/user-attachments/assets/488d9741-d4ad-454f-bb34-422627048370

The generated document can be found in `./example/go-routine-parking.md`

## What It Does
- Accepts either a topic prompt or a topic document.
- Writes one full draft directly from the request and evidence, then runs revision rounds when needed.
- Runs three auditors in parallel to review the draft from different perspective. 
- Aggregates findings, rebuttals, and approvals until the run is approved or fails.
- Once a research run is approved, an optional **design quorum** turns the document into a single self-contained HTML page (`final.html`), reviewed by its own panel of design auditors.
- Streams live activity into the web dashboard with pipeline view, telemetry, reader interview, and artifact browser.
- Captures Langfuse telemetry when configured.

## The Big Picture
1. `bun run dev` starts the web dashboard at `http://localhost:3000`
2. Start a research run from the index page (topic, document path, resume, or design)
3. The run manager creates an event bus and starts `runResearchPipeline` / `runDesignPipeline`
4. OpenCode is started lazily only when a configured role uses the OpenCode provider
5. Live status is written to `live-status.json` and polled by the dashboard
6. Reader interview replies are submitted from the run page (`POST /runs/:name/reply`)
7. When the run completes, artifacts land under `{dataDir}/runs/` and the dashboard shows the verdict

## Current Agent Roles
Research quorum:
- `research-drafter`
- `source-auditor`
- `logic-auditor`
- `clarity-auditor`
- `markdown-summarizer` (post-run summary)

Design quorum (when `designQuorum.enabled` is true):
- `html-designer`
- `interactive-enhancer`

Recovery helpers (used by the structured-output recovery router):
- `json-fixer`

These are configured in the active SQLite config profile and backed by local OpenCode agent definitions under `.opencode/agents/`.

## Requirements
- **Bun** (runtime + test runner)
- **OpenCode** (`opencode` binary on your `PATH`) — when a role uses the OpenCode provider, the app spawns `opencode serve` on the configured port if no server is already reachable at `OPENCODE_BASE_URL`. Alternatively, point `OPENCODE_BASE_URL` at an already-running OpenCode server and it will be reused as-is.
- Local OpenCode agent definitions under `.opencode/agents/` (bootstrapped from `defaults/opencode/agents/` on first run; gitignored after that)

Prompt contracts and role instructions live in SQLite. Shipped starters are under `defaults/prompts/`, `defaults/roles/`, and default role provider bindings in `defaults/quorum-config.sqlite`.
Live quorum runs do not require the global `deep-dive-research` skill. Drafting behavior is owned by the repo defaults and the active config profile.

Optional:
- Langfuse credentials for trace export
- Git submodules under `reference/` and `references/` (only needed for browsing upstream sources; the app does not require them to run)

## Configuration
Runtime config is stored in SQLite under the Qurom data directory. Shipped defaults live in `defaults/` and are seeded on first run.

Data directory resolution:
1. `QUORUM_DATA_DIR` if set
2. otherwise `$XDG_DATA_HOME/qurom`
3. otherwise `~/.local/share/qurom`

Derived paths:
- `{dataDir}/quorum-config.sqlite` — quorum config, prompts, role instructions, bindings
- `{dataDir}/checkpoints.sqlite` — LangGraph checkpoints
- `{dataDir}/runs/` — run artifacts

Main environment variables:
- `OPENCODE_BASE_URL`
- `OPENCODE_DIRECTORY` — repo checkout (OpenCode workspace; `.opencode/agents/` lives here)
- `QUORUM_DATA_DIR` — optional override for the data directory above
- `QUORUM_OPENCODE_BOOTSTRAP` — non-interactive OpenCode agent bootstrap (`seed`, `overwrite`, `keep`)
- `QUORUM_CAPTURE_OPENCODE_EVENTS`
- `QUORUM_CAPTURE_SYNC_HISTORY`
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL`
Default values are defined in `src/config.ts` and `src/data-paths.ts`.

## Setup

1. Clone with submodules (or fetch them after the fact):
```bash
git clone --recurse-submodules <repo-url> qurom
cd qurom
# or, if already cloned without submodules:
git submodule update --init --recursive
```

2. Install JS dependencies (this also populates `.opencode/node_modules` for the agent defs):
```bash
bun install
```

3. Copy the env template and edit it to match your machine:
```bash
cp .env.example .env
```
Set at least:
- `OPENCODE_DIRECTORY` — absolute path to this repo (OpenCode workspace; `.opencode/agents/` is bootstrapped here)
- `OPENCODE_BASE_URL` — where the app should reach OpenCode. OpenCode is not started at dashboard boot; it starts when a run (or HTML ask) needs an OpenCode-bound role.

On first run, Qurom seeds SQLite from `defaults/` and may prompt you to copy OpenCode agent definitions into `.opencode/agents/`.
Existing repo-local `runs/` data is auto-migrated into `~/.local/share/qurom/` (or `$XDG_DATA_HOME/qurom`).

Leave the `LANGFUSE_*` keys blank to skip telemetry, or fill them in to export traces to Langfuse.

4. Make sure the `opencode` binary is on your `PATH` (the app shells out to `opencode serve`). `opencode --version` should work before you run.

5. (Optional) typecheck + tests to confirm the install:
```bash
bun run typecheck
bun run test
```

You're ready — `bun run dev` launches the dashboard at `http://localhost:3000`.

## Run
```bash
bun run dev      # web dashboard + run orchestration (http://localhost:3000)
bun run view:admin   # same, with defaults editor routes enabled
```

Start runs from the index page, or via HTTP API:
- `POST /api/runs` — new research run (`inputMode`, `topic` or `documentPath`)
- `POST /api/runs/:id/resume` — resume research (`node` optional)
- `POST /api/runs/:id/design` — resume design quorum
- `POST /api/runs/:id/cancel` — cancel active run
- `GET /api/status` — active run + provider lifecycle status

## Test And Typecheck
```bash
bun run typecheck
bun run test
```

## Dashboard Flow

### Index (`/`)
- Start a topic or document run, resume research, or resume design
- One active pipeline run at a time
- Live refresh for the active-run hero when a run is in progress

### Run detail (`/runs/:name`)
- Pipeline, telemetry, agent activity, reader interview, artifacts
- Cancel while running; completion banner when done
- Configure quorum/roles/prompts under `/config`

## Notes
- The repo may contain large `reference/` and `langfuse/` directories used as local references; the active app code is under `src/` and `tests/`.
- Shipped defaults live under `defaults/`. User data (runs, SQLite DBs) lives under `~/.local/share/qurom/` by default.
- Draft documents from document-mode runs are read from the path you provide on the server.
- Run artifacts include the request, per-round drafts, audits, rebuttal reviews, aggregated findings, and final or failure outputs under each run directory.
- The runner now aborts created OpenCode sessions when a run is cancelled.
- Failed runs attempt to recover the latest checkpointed state and write failure artifacts when possible.

## Recovery & Telemetry

When an agent produces malformed, missing, or schema-invalid structured output, `promptAgent` runs an in-session **recovery router** before failing the run. The ladder is `D` (free `coerceJson` pre-clean) → `A`/`B`/`C` (same-agent reprompt, schema-aware reprompt with `<zod_issues>`, or `json-fixer` agent on disk) → `R` (auditor-only fresh-session restart) → run failure. On budget exhaustion a typed `StructuredRecoveryError` is thrown.

Every recovery tier emits a standardized debug-log event so post-hoc triage can see *which* tier caught a fault without re-reading raw stacks. Grep `runs/<rid>/debug-log.jsonl` for:

| Event | Emitted by | Meaning |
|---|---|---|
| `session.recovery.classify` | recovery router | A fault was classified (`nooutput`/`truncated`/`syntax`/`schema`/`transport`) with remaining budgets |
| `session.recovery.reprompt` | A/B branches | Same-agent in-session reprompt with `kind` |
| `session.repair.json_fixer` | C branch | `json-fixer` agent invoked on disk |
| `audit.restart_from_scratch` | `auditWithRestart` (R tier) | Auditor re-run on a fresh OpenCode session |
| `session.dual_output` | persistence | Agent wrote `outputFile` AND returned valid inline JSON that differs; file is preferred |
| `recovery.systemic_drift` | drift detector | Same agent restarted across two distinct `requestId`s in one process — prompt/schema drift suspected; the run fails loud instead of silently looping |

### Kill-switch

`auditRestart.maxRestarts` in `quorum.config.json` controls the R tier. Set it to `0` to disable fresh-session restarts entirely — `promptAgent` then throws `StructuredRecoveryError` directly with no `audit.restart_from_scratch` events. Default is `1`.

## Design Quorum

When `designQuorum.enabled` is true in `quorum.config.json`, an approved research run can be turned into a single self-contained HTML document by the main graph's design phase. The design phase is linear: `html-designer` drafts `design-html-round-0.html`, `interactive-enhancer` adds representation-layer improvements, and `finalizeDesign` writes `final.html`.

Resume design for an existing approved run from the dashboard **Design** tab or:
```bash
curl -X POST http://localhost:3000/api/runs/my-topic-abc123/design
```
The CLI and TUI both resume the original graph checkpoint, so reruns use the same design pipeline as normal approved research runs. Output is written to `<run-directory>/final.html`.

## Improvements / Enhancements
- A LOT, see `references/docs/pending`, a bunch of uiux polish, functional enhancement, checkpoint recovery, real cli packaging
- Also an implementation plan flow
