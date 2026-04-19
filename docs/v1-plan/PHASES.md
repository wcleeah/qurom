# Phase To File Mapping

This package maps the 11 implementation steps in `IMPLEMENTATION_PLAN.md` into 6 execution phases, with two follow-on gap-closure phases inserted after the first Phase 3 pass.

- `01-foundation-and-runtime.md`
  Covers source plan Step 1, Step 2, and Step 3.
  Purpose: create the Bun project scaffold, bind the existing `deep-dive-research` skill by name, and define quorum configuration.

- `02-agent-and-schema-contracts.md`
  Covers source plan Step 4 and Step 5.
  Purpose: define OpenCode role prompts and the structured schemas for audits, rebuttals, and graph state.

- `03-opencode-and-graph-core.md`
  Covers source plan Step 6 and Step 7.
  Purpose: implement the OpenCode adapter and the LangGraph workflow with bounded rebuttal and revision routing.

- `03.1-rebuttal-and-convergence-gap-closure.md`
  Extends source plan Step 7 with the missing bounded-control behavior discovered after the first Phase 3 pass.
  Purpose: add multi-turn rebuttal handling, rebuttal caps, stagnation detection, and complete topic/file core inputs before telemetry is layered on.

- `03.5-live-progress-console.md`
  Adds an intermediate operability slice between corrected core workflow behavior and full telemetry.
  Purpose: surface live run progress from OpenCode SSE so long-running workflow turns are visible in the terminal.

- `04-telemetry-and-cli.md`
  Covers source plan Step 8, Step 9, and the remaining operator-facing CLI work after Phase 3.1 and Phase 3.5 close the core graph and live-progress gaps.
  Purpose: add Langfuse tracing, optional OpenCode event enrichment and artifact capture, and CLI operability polish on top of the corrected graph behavior and live progress console.

- `05-verification-and-hardening.md`
  Covers source plan Step 11 plus the source plan's verification and rollback requirements.
  Purpose: add deterministic tests, run end-to-end verification, and package the system for handoff or next-phase expansion.

Sequencing note:

- Phases 2 through 5 depend on deliverables that do not exist yet in the repo.
- Phase 1 is the only phase that is currently `Ready` based on verified repo state.
