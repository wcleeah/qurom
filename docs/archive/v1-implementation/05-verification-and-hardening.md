# Phase 5: Verification And Hardening

## Execution Snapshot

- Phase number: 5
- Source plan: `IMPLEMENTATION_PLAN.md`, Step 11 plus the source plan verification and rollback sections (`IMPLEMENTATION_PLAN.md:1012-1388`)
- Readiness status: `Blocked`
- Primary deliverable: deterministic tests, completed verification checks, and a handoff-ready v1 package with known fallback paths
- Blocking dependencies: Phases 1 through 4 deliverables do not exist yet
- Target measurements summary: no invented metrics; exit gates are passing tests, successful verification commands, and validated recovery paths
- Next phase: Final phase

## Why This Phase Exists

This phase proves the implementation works and can fail safely. The earlier phases build the system. This phase shows that the system is actually usable, bounded, and handoff-ready.

## Start Criteria

- Phase 4 CLI works.
- Phase 4 tracing works.
- Phase 3 workflow can execute one full run.
- Artifact writing is implemented.

## Dependencies And How To Check Them

| Dependency | Why it matters | How to verify it | Status |
| --- | --- | --- | --- |
| Phase 1 scaffold complete | Tests and verification commands need a runnable project | Check for `package.json` and Bun scripts | Not Done |
| Phase 2 contracts complete | Test suite should validate actual schema and routing contracts | Inspect `src/schema.ts` and `.opencode/agents/` | Not Done |
| Phase 3 graph core complete | Verification needs a real workflow to exercise | Confirm `src/graph.ts` and `src/opencode.ts` are implemented | Not Done |
| Phase 4 telemetry and CLI complete | Final verification includes traces and CLI execution | Confirm `src/telemetry.ts` and `src/index.ts` are implemented | Not Done |

## Target Measurements And Gates

Entry gates:

- None beyond prior phase completion

Exit gates:

- Measurement: deterministic test coverage for workflow logic
  Pass condition: tests exist for vote aggregation, stagnation detection, route selection, rebuttal routing, and rebuttal application
  Measurement method: inspect test files and run test command
  Current evidence: tests do not exist yet
  Status: `Not Met`

- Measurement: end-to-end verification pass
  Pass condition: the commands and checks in the source plan verification section complete successfully
  Measurement method: run the verification checklist from `IMPLEMENTATION_PLAN.md:1151-1270`
  Current evidence: not executed
  Status: `Unknown`

- Measurement: rollback paths are practical
  Pass condition: documented fallbacks can be explained and exercised where reasonable
  Measurement method: inspect fallback behavior and, where possible, simulate one degraded mode
  Current evidence: not implemented
  Status: `Unknown`

## Scope

- add deterministic tests for non-LLM logic
- run the full verification plan
- validate fallback paths that matter for v1
- produce a handoff-ready result with known pass/fail evidence

## Out Of Scope

- building phase 2 features like HTTP APIs or PDF ingestion
- redesigning the workflow shape
- changing the telemetry architecture unless verification proves it is broken

## Implementation Details

Required test targets from the source plan (`IMPLEMENTATION_PLAN.md:1012-1028`, `1259-1270`):

- schema validation
- vote aggregation
- finding deduplication
- rebuttal routing
- rebuttal application to unresolved findings
- stagnation detection
- route selection between `approve`, `revise`, and `fail`

Required verification targets from the source plan (`IMPLEMENTATION_PLAN.md:1151-1270`):

- environment verification
- config verification
- research-tool verification
- structured-output verification
- workflow verification
- telemetry verification
- OpenCode event verification
- regression checks

Required fallback targets from the source plan (`IMPLEMENTATION_PLAN.md:1272-1344`):

- LangGraph fallback to an imperative loop
- SQLite fallback to in-memory for local spikes
- one-server fallback to multi-server routing if contamination appears
- Langfuse fallback to shallower tracing
- OpenCode event-enrichment fallback to Langfuse-only telemetry

## Execution Checklist

1. Add tests for vote aggregation and finding deduplication.
2. Add tests for rebuttal routing and rebuttal application.
3. Add tests for stagnation detection and route selection.
4. Run the environment verification commands.
5. Run config verification including skill visibility and agent presence.
6. Run research-tool smoke tasks for Context7, Exa, and Grep.app if those tools are enabled.
7. Run structured-output verification for both audit and rebuttal payloads.
8. Run at least one topic-based end-to-end workflow verification.
9. Verify Langfuse traces for the run.
10. Verify OpenCode event enrichment and `/sync/history` backfill if that optional layer is enabled.
11. Review the rollback section and make sure each fallback still matches the implemented code shape.

## Files And Systems Likely Affected

- test files or test directories added in the new Bun project
- `src/schema.ts`
- `src/graph.ts`
- `src/opencode.ts`
- `src/telemetry.ts`
- `src/telemetry-enrichment.ts`
- `src/index.ts`
- `package.json`
- `runs/`

Systems involved:

- Bun test/runtime scripts
- OpenCode server
- LangGraph checkpointer
- Langfuse trace viewer
- optional OpenCode SSE and sync-history surfaces

## Verification

Commands to run:

```bash
opencode serve --port 4096
bun run test
bun run dev -- --topic "How Raft leader election works"
```

Behaviors to check:

- tests pass for non-LLM workflow logic
- one real run completes with bounded behavior
- Langfuse shows the expected trace hierarchy
- optional OpenCode event enrichment either works or can be disabled cleanly
- final artifacts are written to the `runs/` directory

Regression checks:

- no infinite loops after rebuttal or revision caps are hit
- disabling enrichment does not change approval logic
- fallback decisions in the plan still match the implemented file layout and module boundaries

Success signals:

- deterministic tests pass
- one full run is observable and artifact-producing
- the final state of the project matches the implementation plan closely enough for another agent to continue from there

## Done Criteria

- all non-LLM tests identified in the source plan exist and pass
- the verification plan has been exercised with recorded results
- final artifacts and traces exist for at least one representative run
- fallback paths are still valid against the actual code structure
- the project is ready for handoff, iteration, or expansion

## Handoff To Next Phase

Next phase: Final phase

This is the final execution packet in the 5-phase breakdown.

What this phase must deliver:

- passing tests
- completed verification evidence
- validated fallback paths

What becomes unblocked:

- real feature iteration on top of a working v1
- future additions like HTTP API, richer file ingestion, or multi-server isolation

What should be picked up next:

- either begin implementation from the completed verified base, or create a new implementation plan for the next feature set

## Open Questions Or Blockers

- Unknown: what exact Bun test runner or test framework you want to standardize on in the new project.
- Unknown: whether you want verification evidence written into markdown artifacts or only surfaced in traces and terminal output.

## Sources

- Source plan Step 11: `IMPLEMENTATION_PLAN.md:1012-1028`
- Source plan verification section: `IMPLEMENTATION_PLAN.md:1151-1270`
- Source plan rollback and recovery section: `IMPLEMENTATION_PLAN.md:1272-1344`
