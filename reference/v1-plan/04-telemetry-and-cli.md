# Phase 4: Telemetry And CLI

## Execution Snapshot

- Phase number: 4
- Source plan: `IMPLEMENTATION_PLAN.md`, Step 8 through Step 10 (`IMPLEMENTATION_PLAN.md:940-1010`)
- Readiness status: `Blocked`
- Primary deliverable: Langfuse tracing, optional OpenCode telemetry enrichment, and a Bun CLI entrypoint that can run the orchestrator
- Blocking dependencies: Phase 3 adapter and graph core do not exist yet
- Target measurements summary: no numeric thresholds; exit gates are trace coverage, event capture, and successful CLI invocation
- Next phase: `05-verification-and-hardening.md`

## Why This Phase Exists

This phase makes the orchestrator operable and observable. The workflow is not enough by itself; you need a way to run it and a way to inspect what happened without reading source code or raw logs.

## Start Criteria

- Phase 3 OpenCode adapter exists.
- Phase 3 LangGraph workflow exists.
- Artifact output paths are implemented.
- Langfuse credentials strategy is known, at least for local development.

## Dependencies And How To Check Them

| Dependency | Why it matters | How to verify it | Status |
| --- | --- | --- | --- |
| Phase 3 graph core complete | Tracing and CLI need a stable workflow to wrap | Confirm `src/graph.ts` exists and can be imported by `src/index.ts` | Not Done |
| Phase 3 adapter complete | Tracing wraps agent calls and event enrichment filters session IDs from adapter-created runs | Confirm `src/opencode.ts` exists and exposes agent/session calls | Not Done |
| Artifact writing exists | Trace metadata should be able to reference run outputs | Confirm `src/output.ts` exists and is used by the workflow | Not Done |
| Langfuse env strategy exists | Needed to run traces meaningfully | Check `.env.example` for Langfuse placeholders after Phase 1 | Not Done |

## Target Measurements And Gates

Entry gates:

- None beyond dependency completion

Exit gates:

- Measurement: workflow trace coverage
  Pass condition: one run produces a root Langfuse observation plus nested observations for rounds, agent calls, audit results, and rebuttal exchanges
  Measurement method: inspect the Langfuse UI or query trace output after a sample run
  Current evidence: not implemented
  Status: `Not Met`

- Measurement: OpenCode event enrichment works when enabled
  Pass condition: one run captures at least `message.updated`, `message.part.updated`, `session.status`, and `permission.asked` or `session.error` when those occur
  Measurement method: inspect captured event artifact or debug output
  Current evidence: not implemented
  Status: `Not Met`

- Measurement: CLI entrypoint works
  Pass condition: `bun run dev -- --topic "..."` launches the workflow and exits with a run result
  Measurement method: local command invocation
  Current evidence: not implemented
  Status: `Not Met`

## Scope

- implement Langfuse tracing in `src/telemetry.ts`
- implement optional OpenCode SSE and sync-history enrichment in `src/telemetry-enrichment.ts`
- implement the Bun CLI in `src/index.ts`
- ensure CLI supports `--topic` and `--file`

## Out Of Scope

- broad test-suite hardening
- PDF and DOCX ingestion
- HTTP API or hosted deployment
- replacing Langfuse with OpenCode event streams as the primary observability layer

## Implementation Details

Langfuse requirements from the source plan (`IMPLEMENTATION_PLAN.md:940-966`):

- root run observation
- nested observation per graph node
- nested `agent` observation per OpenCode call
- nested `evaluator` observation per audit result
- nested `chain` observation per rebuttal exchange

Required trace metadata:

- `requestId`
- `round`
- `agentName`
- `sessionId`
- `status`
- `vote`
- `model`
- `findingIssue`
- `rebuttalDecision`

OpenCode enrichment requirements from the source plan (`IMPLEMENTATION_PLAN.md:968-989`):

- live SSE enrichment through `client.event.subscribe()`
- optional global monitoring through `client.global.event()`
- post-run backfill through `client.sync.history.list()`
- event capture should be filtered by the workflow's session IDs

CLI requirements from the source plan (`IMPLEMENTATION_PLAN.md:991-1010`):

- support `--topic`
- support `--file`
- run through Bun, not npm

## Execution Checklist

1. Add Langfuse client initialization and wrappers in `src/telemetry.ts`.
2. Wrap graph execution and OpenCode agent calls with Langfuse observations.
3. Add metadata fields for votes, rebuttals, rounds, and session IDs.
4. Implement optional SSE subscription in `src/telemetry-enrichment.ts`.
5. Filter OpenCode events to only the sessions relevant to the current workflow run.
6. Implement optional post-run sync-history fetch and raw artifact persistence.
7. Implement `src/index.ts` to parse `--topic` and `--file` inputs.
8. Wire the CLI to execute the graph and emit useful terminal output.
9. Ensure the CLI examples and scripts are Bun-based.

## Files And Systems Likely Affected

- `src/telemetry.ts`
- `src/telemetry-enrichment.ts`
- `src/index.ts`
- `src/graph.ts`
- `src/opencode.ts`
- `.env.example`
- `package.json`

Systems involved:

- Langfuse JS tracing
- OpenCode SSE and sync-history APIs
- Bun CLI runtime

## Verification

Commands to run:

```bash
opencode serve --port 4096
bun run dev -- --topic "How Raft leader election works"
```

Behaviors to check:

- CLI accepts the topic and invokes the workflow
- Langfuse root and nested spans are created
- audit spans appear separately from rebuttal spans
- enabling OpenCode event enrichment captures session-scoped events for the run
- post-run sync-history fetch can persist raw events for later analysis

Regression checks:

- disabling `src/telemetry-enrichment.ts` does not break the core workflow
- missing Langfuse configuration fails clearly or degrades in a controlled way, depending on your chosen policy

Success signals:

- one CLI run is observable in Langfuse
- one CLI run can optionally produce an event artifact from OpenCode

## Done Criteria

- Langfuse tracing is implemented at the workflow level
- optional OpenCode event enrichment is implemented and isolated from core workflow state
- the CLI can run a topic-based workflow from Bun
- Phase 5 can focus on deterministic tests and completion verification rather than basic operability

## Handoff To Next Phase

Next phase: `05-verification-and-hardening.md`

This phase must deliver:

- a working CLI
- primary workflow traces in Langfuse
- optional low-level event capture

What becomes unblocked:

- writing deterministic tests around routing and aggregation
- running the full verification plan from the implementation plan
- packaging the project for handoff or further development

What the next phase should pick up:

- add tests
- run verification commands
- validate done criteria and fallback behavior

## Open Questions Or Blockers

- Unknown: whether OpenCode event enrichment should be enabled by default or only behind a feature flag.
- Unknown: how verbose the CLI output should be during long-running audit and rebuttal rounds.

## Sources

- Source plan Step 8 through Step 10: `IMPLEMENTATION_PLAN.md:940-1010`
- Source plan telemetry comparison: `IMPLEMENTATION_PLAN.md:604-635`
