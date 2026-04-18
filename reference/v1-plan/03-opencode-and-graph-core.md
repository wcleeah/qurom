# Phase 3: OpenCode And Graph Core

## Execution Snapshot

- Phase number: 3
- Source plan: `IMPLEMENTATION_PLAN.md`, Step 6 and Step 7 (`IMPLEMENTATION_PLAN.md:827-938`)
- Readiness status: `Blocked`
- Primary deliverable: a working OpenCode adapter and LangGraph workflow that can draft, audit, rebut, revise, and finalize
- Blocking dependencies: Phase 1 scaffold and Phase 2 contracts are not complete
- Target measurements summary: no numeric thresholds; exit gates are working startup checks, graph routing, and persisted checkpointer wiring
- Next phase: `04-telemetry-and-cli.md`

## Why This Phase Exists

This phase turns the static design into a functioning orchestrator. It is where the OpenCode worker runtime and the LangGraph control runtime meet.

## Start Criteria

- Phase 1 scaffold files exist.
- Phase 2 agent files exist.
- Phase 2 schemas exist in `src/schema.ts`.
- `quorum.config.json` exists and is trusted as the runtime source of role names and rebuttal limits.

## Dependencies And How To Check Them

| Dependency | Why it matters | How to verify it | Status |
| --- | --- | --- | --- |
| Phase 1 scaffold complete | Needed for adapter and graph implementation files | Confirm `src/opencode.ts` and `src/graph.ts` exist | Not Done |
| Phase 2 schemas complete | Graph nodes need stable input/output types | Inspect `src/schema.ts` for audit and rebuttal schemas | Not Done |
| Phase 2 agent definitions complete | Startup validation should fail if required roles are missing | Confirm all four agent files exist and names match config | Not Done |
| Skill visibility check strategy exists | The adapter must verify `deep-dive-research` before first draft | Confirm startup code path exists for `app.skills` validation | Not Done |

## Target Measurements And Gates

Entry gates:

- None beyond dependency completion

Exit gates:

- Measurement: OpenCode adapter can validate runtime prerequisites
  Pass condition: startup path checks agents and confirms `deep-dive-research`
  Measurement method: run startup verification against a live OpenCode server
  Current evidence: not implemented
  Status: `Not Met`

- Measurement: graph persistence is wired
  Pass condition: LangGraph compiles with a SQLite checkpointer and can create a `thread_id` backed run
  Measurement method: integration smoke run
  Current evidence: not implemented
  Status: `Not Met`

- Measurement: rebuttal routing works
  Pass condition: targeted rebuttals only go to the auditor that owns the disputed finding
  Measurement method: unit test and smoke run
  Current evidence: not implemented
  Status: `Not Met`

## Scope

- implement the OpenCode adapter in `src/opencode.ts`
- implement LangGraph state and nodes in `src/graph.ts`
- wire the SQLite checkpointer
- implement bounded rebuttal and revision routing
- write artifacts for approved and failed runs

## Out Of Scope

- Langfuse tracing
- OpenCode SSE enrichment
- CLI user experience polish beyond what is needed to invoke the workflow
- non-LLM test suite hardening beyond basic graph-level proofs

## Implementation Details

OpenCode adapter requirements from the source plan (`IMPLEMENTATION_PLAN.md:827-853`):

- connect to an existing server or start one
- list agents on startup and fail fast if a configured role is missing
- list skills on startup and fail fast if `deep-dive-research` is missing
- create sessions
- send prompts to a named agent
- request structured output for audits and rebuttals

LangGraph workflow requirements from the source plan (`IMPLEMENTATION_PLAN.md:855-938`):

- implement nodes:
  - `ingestRequest`
  - `bootstrapRun`
  - `draftInitial`
  - `runParallelAudits`
  - `reviewFindingsByDrafter`
  - `runTargetedRebuttals`
  - `aggregateConsensus`
  - `reviseDraft`
  - `finalizeApprovedDraft`
  - `finalizeFailedRun`

- implement routing rules:
  - draft -> audits
  - audits -> drafter review
  - rebuttals only when present
  - aggregate -> approve or revise or fail

Persistence detail:

- the graph must use a SQLite checkpointer, not in-memory persistence, because the source plan treats recovery and inspection as first-class concerns (`IMPLEMENTATION_PLAN.md:637-641`, `934-938`)

Artifact detail:

- approved runs must write `runs/<requestId>/final.md` and `runs/<requestId>/summary.json`
- failed runs must still preserve the latest draft and the unresolved findings/rebuttal outcomes

## Execution Checklist

1. Implement OpenCode client creation and server attach/start logic in `src/opencode.ts`.
2. Add startup validation for required agents.
3. Add startup validation for the `deep-dive-research` skill using the app skills surface.
4. Implement session creation and role-specific agent invocation.
5. Implement structured-output requests for audits and rebuttals.
6. Implement the LangGraph state definition and node registration in `src/graph.ts`.
7. Wire a SQLite checkpointer into the graph.
8. Implement `reviewFindingsByDrafter` so accepted findings and rebuttals are separated deterministically.
9. Implement `runTargetedRebuttals` so only the owning auditor gets the rebuttal.
10. Implement `aggregateConsensus` so rebuttal outcomes affect the unresolved finding set.
11. Implement final artifact writing for both approved and failed runs.

## Files And Systems Likely Affected

- `src/opencode.ts`
- `src/graph.ts`
- `src/output.ts`
- `src/config.ts`
- `src/schema.ts`
- `quorum.config.json`

Systems involved:

- OpenCode v2 SDK
- OpenCode headless server
- LangGraph workflow runtime
- SQLite checkpointer integration

## Verification

Commands to run:

```bash
opencode serve --port 4096
bun run typecheck
```

Behaviors to check:

- startup fails cleanly if a required agent is missing
- startup fails cleanly if `deep-dive-research` is not visible
- a draft can be created from a topic input
- auditors return structured audit objects
- the drafter can issue rebuttals
- rebuttals are routed only to the targeted auditor
- finalization writes artifacts to `runs/<requestId>/`

Regression checks:

- the graph does not skip rebuttal handling when rebuttals are present
- the graph does not loop forever after `maxRounds` or rebuttal caps are hit

Success signals:

- one end-to-end dry run reaches either a bounded failure or a completed draft artifact set
- SQLite-backed state can be inspected after the run

## Done Criteria

- `src/opencode.ts` can connect, validate prerequisites, and invoke named agents
- `src/graph.ts` compiles and routes through the planned nodes
- rebuttals are first-class workflow objects, not ad hoc strings
- approved and failed runs both write artifacts
- Phase 4 can add tracing and operator-facing surfaces without changing the core control logic

## Handoff To Next Phase

Next phase: `04-telemetry-and-cli.md`

This phase must deliver:

- a stable OpenCode adapter
- a stable graph with persisted state and bounded routing
- artifact output paths

What becomes unblocked:

- adding Langfuse spans around nodes and agent calls
- adding optional OpenCode SSE and sync-history enrichment
- exposing the workflow through a CLI

What the next phase should pick up:

- instrument `src/telemetry.ts`
- implement `src/telemetry-enrichment.ts`
- wire the workflow into `src/index.ts`

## Open Questions Or Blockers

- Unknown: whether you want the adapter to always start a local server or prefer attach-first behavior with start as fallback.
- Unknown: whether failed runs should write one combined `summary.json` or separate `latest-draft.md` and `failure.json` artifacts.

## Sources

- Source plan Step 6 and Step 7: `IMPLEMENTATION_PLAN.md:827-938`
- Source plan persistence requirement: `IMPLEMENTATION_PLAN.md:637-641`
