# research-qurom

Terminal research workflow that runs one designated drafter and three auditors through a quorum review loop, with a local TUI built on `@opentui/react`.

## What It Does

- Accepts either a topic prompt or a drafted document
- Runs a designated drafter to produce or revise the draft
- Runs three auditors in parallel to review the draft
- Aggregates findings, rebuttals, and approvals until the run is approved or fails
- Streams live activity into a TUI with per-agent panels and summary screens
- Captures optional Langfuse telemetry when configured

## Current Agent Roles

- `research-drafter`
- `source-auditor`
- `logic-auditor`
- `clarity-auditor`

These are configured in `quorum.config.json` and backed by local agent definitions under `.opencode/agents/`.

## Requirements

- Bun
- An OpenCode server reachable at `OPENCODE_BASE_URL`
- Local agent and skill definitions available to that OpenCode instance

Optional:

- Langfuse credentials for trace export

## Configuration

Runtime config is loaded from environment variables and `quorum.config.json`.

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

## Install

```bash
bun install
```

## Run

Start the TUI:

```bash
bun run start
```

Or during development:

```bash
bun run dev
```

## Test And Typecheck

```bash
bun run typecheck
bun run test
```

## TUI Flow

### Prompt screen

- `Tab`: switch between topic and document modes
- `Enter`: run
- document mode only: `e` opens the editor
- document mode only: `Esc` switches back to topics

### Running screen

- `h/j/k/l`: move selection
- `Tab` and `Shift-Tab`: cycle selection
- `Enter`: enter the selected panel
- `Esc`: leave the active panel
- active panel only:
  - `j/k`: scroll
  - `Ctrl-d/u`: half page
  - `Ctrl-f/b`: page
  - `gg`: top
  - `G`: bottom
- `?`: help
- `Ctrl-C`: abort the run and exit after shutdown
- `Q`: force-quit confirmation

### Summary screen

- `r`: rerun same input
- `n`: new topic
- `f`: new document
- `q`: quit

## Project Layout

- `src/tui/`: terminal UI
- `src/runner.ts`: run orchestration, lifecycle, telemetry listener, abort handling
- `src/graph.ts`: LangGraph workflow and state transitions
- `src/opencode.ts`: OpenCode client helpers
- `src/opencode-event-bridge.ts`: event stream bridge into runner events
- `src/schema.ts`: zod schemas for run input and graph state
- `tests/`: repo tests
- `docs/`: implementation docs and phase briefs

## Notes

- The repo may contain large `reference/` and `langfuse/` directories used as local references; the active app code is under `src/` and `tests/`.
- Draft documents created from the TUI are stored under `runs/.drafts/`.
- The runner now aborts created OpenCode sessions when a run is cancelled.
