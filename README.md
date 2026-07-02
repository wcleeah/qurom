# research-qurom 
A agent loop that generate a research document on a specific topic powered by Opencode. It runs one designated drafter and three auditors agent through a quorum review loop, with a local TUI built on `@opentui/react`.

https://github.com/user-attachments/assets/488d9741-d4ad-454f-bb34-422627048370

The generated document can be found in `./example/go-routine-parking.md`

## What It Does
- Accepts either a topic prompt or a topic document.
- Writes one full draft directly from the request and evidence, then runs revision rounds when needed.
- Runs three auditors in parallel to review the draft from different perspective. 
- Aggregates findings, rebuttals, and approvals until the run is approved or fails.
- Once a research run is approved, an optional **design quorum** turns the document into a single self-contained HTML page (`final.html`), reviewed by its own panel of design auditors.
- Streams live activity into a TUI with per-agent panels, dashboard and a summary screen after run.
- Captures Langfuse telemetry when configured.

## The Big Picture
1. `bun run dev` -> entry point index.tsx 
2. index.tsx setup the tui, load the config json, and at last render `App`.
3. `App` is the controller of the whole tui:
  - Obviously it does the rendering, by different stages render the startup `prompt screen`, the in progress `running screen`, and the `summary screen` once the whole thing is done.
  - It controls most of the ui state, such as keyboard interactions, on run, on summary action.
  - It also provide the function to start the agent loop
4. Starting the agent loop requires a few things:
  - Create an event bus, which will carry events from opencode, or the graph node, or simply lifecycle event from the pipeline
  - Bind that event bus with the central UI store (powered by zustand), so the UI can react and render those state.
  - then start the pipeline
5. The pipeline starts up, it will do a few initialization:
  - It sets up telemetry with langfuse
  - It opens the opencode event bridge
  - It binds the telemetry handler and opencode event bridge with the bus
6. And then the graph is invoked
- 6.1. Opencode session creation, summary agent generate summary if it is document mode, a bunch of initialization 
- 6.2. Draft agent starts to work, based on the topic:
- 6.2a. It writes one full draft directly from the request, evidence, and prompt contract
- 6.3. Audit agents receive the draft, review it from different angles, vote for / against the draft, and give findings-=
- 6.4. Draft agents then review the findings, post a rebuttal or accept the defeat
- 6.5. Audit agents review the rebuttles, and post a re-rebuttal or accept the rebuttal
- 6.6. 4-5 loops until either they agreed or the limit is reached
- 6.7. Draft agents rewrite the draft and goes back to step 6.3
- 6.8. If everyone is happy, voted yes for the draft, everything is done!
- 6.9. Do some finalization, like write the document plus run artifacts into `runs/`, send telemetry and event via bus, summarize agent summarize the whole document
7. Then the summary screen comes, showing the final verdict, summary, allow the user to review the document
8. The user can choose to rerun, it will all go back to step 3

## Current Agent Roles
Research quorum:
- `research-drafter`
- `source-auditor`
- `logic-auditor`
- `clarity-auditor`
- `markdown-summarizer` (post-run summary)

Design quorum (when `designQuorum.enabled` is true):
- `html-designer`
- `visual-layout-auditor`
- `technical-html-auditor`
- `script-security-auditor`
- `interactive-enhancer`

Recovery helpers (used by the structured-output recovery router):
- `json-fixer`

These are configured in `quorum.config.json` and backed by local agent definitions under `.opencode/agents/`.

## Requirements
- **Bun** (runtime + test runner)
- **OpenCode** (`opencode` binary on your `PATH`) — the app spawns `opencode serve` on the configured port if no server is already reachable at `OPENCODE_BASE_URL`. Alternatively, point `OPENCODE_BASE_URL` at an already-running OpenCode server and it will be reused as-is.
- Local agent definitions available to that OpenCode instance (the repo ships them under `.opencode/agents/`; OpenCode loads them automatically when `OPENCODE_DIRECTORY` points at this repo).

Prompt contracts are repo-owned and loaded from `assets/prompts/`.
Live quorum runs do not require the global `deep-dive-research` skill. Drafting behavior is owned by the repo prompt bundle and the repo agent definitions under `.opencode/agents/`.

Optional:
- Langfuse credentials for trace export
- Git submodules under `reference/` and `references/` (only needed for browsing upstream sources; the app does not require them to run)

## Configuration
Runtime config is loaded from environment variables and `quorum.config.json`.

Important `quorum.config.json` fields:
- `recursionLimit`: LangGraph superstep limit for a run.
- `promptAssetsDir`: repo-local prompt asset directory.
- `promptManagement`: currently `local` only; the app loads prompt files from disk at startup.

Main environment variables:
- `OPENCODE_BASE_URL`
- `OPENCODE_DIRECTORY`
- `QUORUM_CHECKPOINT_PATH`
- `QUORUM_CAPTURE_OPENCODE_EVENTS`
- `QUORUM_CAPTURE_SYNC_HISTORY`
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL`
Default values are defined in `src/config.ts`.

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
- `OPENCODE_DIRECTORY` — absolute path to this repo (used as the OpenCode server's working dir so it can see `.opencode/agents/` and the prompt assets)
- `OPENCODE_BASE_URL` — where the app should reach OpenCode. If nothing is running there, the app starts `opencode serve` itself on that port.

Leave the `LANGFUSE_*` keys blank to skip telemetry, or fill them in to export traces to Langfuse.

4. Make sure the `opencode` binary is on your `PATH` (the app shells out to `opencode serve`). `opencode --version` should work before you run.

5. (Optional) typecheck + tests to confirm the install:
```bash
bun run typecheck
bun run test
```

You're ready — `bun run dev` launches the TUI.

## Run
```bash
bun run dev      # launch the TUI
```

Other entry points:
```bash
bun run view     # web dashboard for live + past runs at http://localhost:3000
bun run design <run-directory-or-request-id>   # resume the design phase from the run checkpoint
bun run design   # in the TUI, paste a run ID to resume the design phase from checkpoint
```

## Test And Typecheck
```bash
bun run typecheck
bun run test
```

## TUI Flow

The TUI has two screens:

### Prompt screen
- Type a topic and press `Enter` to start a run
- `Tab` toggles between topic and document mode (paste a file path)
- `Ctrl-C` quits

### Running screen
- Shows current graph node, round, elapsed time, and active agents with tool names
- Prints the view-server URL — open this in a browser for full detail
- `Ctrl-C` cancels the run and exits

All post-run detail (pipeline, findings, rebuttals, round history, artifacts) is available in the
web dashboard at `http://localhost:3000` (`bun run view`).

## Notes
- The repo may contain large `reference/` and `langfuse/` directories used as local references; the active app code is under `src/` and `tests/`.
- Draft documents created from the TUI are stored under `runs/.drafts/`.
- Run artifacts now include the request, per-round drafts, audits, rebuttal reviews, aggregated findings, and final or failure outputs under each run directory in `runs/`.
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

When `designQuorum.enabled` is true in `quorum.config.json`, an approved research run can be turned into a single self-contained HTML document by the main graph's design phase. It mirrors the research loop: a designated `html-designer` drafts, `interactive-enhancer` adds representation-layer improvements, three design auditors (`visual-layout-auditor`, `technical-html-auditor`, `script-security-auditor`) review in parallel, findings are aggregated, and the designer revises until approved or `designQuorum.maxRounds` is hit. If `designQuorum.browserQa.enabled` is true, `browser-qa-enhancer` performs a final browser/computer-use QA pass after `final.html` is written.

Resume it for an existing approved run directory or request id:
```bash
bun run design runs/my-topic-abc123
```
The CLI and TUI both resume the original graph checkpoint, so reruns use the same design pipeline as normal approved research runs. Output is written to `<run-directory>/final.html`.

## Improvements / Enhancements
- A LOT, see `references/docs/pending`, a bunch of uiux polish, functional enhancement, checkpoint recovery, real cli packaging
- Also an implementation plan flow
