# research-qurom 
A agent loop that generate a research document on a specific topic powered by Opencode. It runs one designated drafter and three auditors agent through a quorum review loop, with a local TUI built on `@opentui/react`.

## What It Does
- Accepts either a topic prompt or a topic document.
- Plans an outline, drafts sections, stitches a full draft, then runs revision rounds when needed.
- Runs three auditors in parallel to review the draft from different perspective. 
- Aggregates findings, rebuttals, and approvals until the run is approved or fails.
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
  6.1. Opencode session creation, summary agent generate summary if it is document mode, a bunch of initialization 
  6.2. Draft agent starts to work, based on the topic:
    6.2a. It will first generate an outline of the document
    6.2b. By each section generate the draft for that section
    6.2c. Stitch them together in a final prompt
  6.3. Audit agents receive the draft, review it from different angles, vote for / against the draft, and give findings
  6.4. Draft agents then review the findings, post a rebuttal or accept the defeat
  6.5. Audit agents review the rebuttles, and post a re-rebuttal or accept the rebuttal
  6.6. 4-5 loops until either they agreed or the limit is reached
  6.7. Draft agents rewrite the draft and goes back to step 6.3
  6.8. If everyone is happy, voted yes for the draft, everything is done!
  6.9. Do some finalization, like write the document to an md, send telemetry and event via bus, summarize agent summarize the whole document
7. Then the summary screen comes, showing the final verdict, summary, allow the user to review the document
8. The user can choose to rerun, it will all go back to step 3

## Current Agent Roles
- `research-drafter`
- `source-auditor`
- `logic-auditor`
- `clarity-auditor`
These are configured in `quorum.config.json` and backed by local agent definitions under `.opencode/agents/`.

## Requirements
- Bun
- An OpenCode server reachable at `OPENCODE_BASE_URL`
- Local agent definitions available to that OpenCode instance
Prompt contracts are repo-owned and loaded from `assets/prompts/`.

Optional:
- Langfuse credentials for trace export

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

## Install
```bash
bun install
```

## Run
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
- `Ctrl-C`: quit
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
- `Ctrl-C`: quit

## Notes
- The repo may contain large `reference/` and `langfuse/` directories used as local references; the active app code is under `src/` and `tests/`.
- Draft documents created from the TUI are stored under `runs/.drafts/`.
- The runner now aborts created OpenCode sessions when a run is cancelled.
- Failed runs attempt to recover the latest checkpointed state and write failure artifacts when possible.

## Improvements / Enhancements
- A LOT, see `references/docs/pending`, a bunch of uiux polish, functional enhancement, checkpoint recovery, real cli packaging
- Also an implementation plan flow
