# Phase To File Mapping

This package maps the 11 implementation steps in `IMPLEMENTATION_PLAN.md` into 5 execution phases, as requested.

- `01-foundation-and-runtime.md`
  Covers source plan Step 1, Step 2, and Step 3.
  Purpose: create the Bun project scaffold, bind the existing `deep-dive-research` skill by name, and define quorum configuration.

- `02-agent-and-schema-contracts.md`
  Covers source plan Step 4 and Step 5.
  Purpose: define OpenCode role prompts and the structured schemas for audits, rebuttals, and graph state.

- `03-opencode-and-graph-core.md`
  Covers source plan Step 6 and Step 7.
  Purpose: implement the OpenCode adapter and the LangGraph workflow with bounded rebuttal and revision routing.

- `04-telemetry-and-cli.md`
  Covers source plan Step 8, Step 9, and Step 10.
  Purpose: add Langfuse tracing, optional OpenCode event enrichment, and the Bun CLI entrypoint.

- `05-verification-and-hardening.md`
  Covers source plan Step 11 plus the source plan's verification and rollback requirements.
  Purpose: add deterministic tests, run end-to-end verification, and package the system for handoff or next-phase expansion.

Sequencing note:

- Phases 2 through 5 depend on deliverables that do not exist yet in the repo.
- Phase 1 is the only phase that is currently `Ready` based on verified repo state.
