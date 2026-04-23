# Phase 03 — Rename and rewrite the opencode event bridge

Source plan: `docs/tui-implementation-plan.md` §10 Step 3.

## Execution Snapshot

- Phase: 03 / 09
- Source plan: `docs/tui-implementation-plan.md`
- Readiness: **Blocked** on Phase 02 (`RunnerEvent` and `EventBus` types must exist).
- Primary deliverable: `src/opencode-event-bridge.ts` (renamed from `src/telemetry-enrichment.ts`) exporting `createOpencodeEventBridge(config, { bus })` that emits typed `RunnerEvent`s instead of calling `console.log`. Plus `src/opencode-event-bridge.test.ts`.
- Blocking dependencies: Phase 02 (`RunnerEvent`, `EventBus`).
- Target measurements: scripted opencode SDK event sequence yields the expected typed events on the bus, in order; double `start()` does not double-subscribe; `grep -r telemetry-enrichment src/` returns zero hits.
- Next phase: 04 — delete old entry point.

## Why This Phase Exists

`src/telemetry-enrichment.ts` is the only place that knows how to translate the opencode SDK event stream into something the rest of the system can use. Today it translates straight to stdout strings, which is lossy and ties the runner to a TTY. This phase replaces every `logProgress` call with a typed `bus.emit`, fixes the misleading filename, and preserves the existing reasoning-buffer logic and the single-subscriber lifetime guarantee. After this phase, the bus carries every event the TUI needs.

## Start Criteria

- Phase 02 done: `RunnerEvent` and `EventBus` exist in `src/runner.ts`.
- The current behaviour of every `logProgress` site in `src/telemetry-enrichment.ts:57-340` is mapped to a target `RunnerEvent` kind (Confirmed — mapping enumerated in plan §10 Step 3).

## Dependencies And How To Check Them

| Dependency | Why | How to verify | Status |
|---|---|---|---|
| `RunnerEvent` union | Bridge emits these | `grep -n "export type RunnerEvent" src/runner.ts` | Done after Phase 02 |
| `EventBus` interface | Constructor parameter | `grep -n "EventBus" src/runner.ts` | Done after Phase 02 |
| `client.event.subscribe` from `@opencode-ai/sdk` | Source stream | Already imported in current `src/telemetry-enrichment.ts:147` | Done |
| Reasoning buffer functions (`shouldFlushReasoning`, `flushReasoning`) | Preserved unchanged | `src/telemetry-enrichment.ts:66-83` | Done |
| Langfuse tool observation lifecycle | Preserved unchanged | `src/telemetry-enrichment.ts:281-330` | Done |
| Single-subscriber guard at line 144 | Preserved | `src/telemetry-enrichment.ts:144` | Done |

## Target Measurements And Gates

Entry gate: Phase 02 tests green.

Exit gates:

- `bunx tsc --noEmit` exits 0.
- `bun test src/opencode-event-bridge.test.ts` exits 0; covers (per plan §13):
  - one of each interesting opencode event yields the expected typed bus event in the right order
  - 10 reasoning deltas without punctuation produce 0 `agent.reasoning` events; trailing `.` produces 1
  - double `start()` without `stop()` does not open a second subscriber
  - `stop()` aborts the iterator; second `start()` after `stop()` opens a fresh subscriber
- `grep -r telemetry-enrichment src/` returns no results (plan §13 regression check).

## Scope

- `git mv src/telemetry-enrichment.ts src/opencode-event-bridge.ts` (or equivalent).
- Rename exported function: `createTelemetryEnrichment` → `createOpencodeEventBridge`.
- Replace each `logProgress(role, text)` site with the matching `bus.emit({ kind: ..., role, ... })` per the table in plan §10 Step 3.
- Drop the `liveConsole` branch (`lines 36, 85-100`) entirely — the TUI is the only consumer.
- Add per-role counters `Map<role, { tools: number, errors: number }>` updated on tool/error events; emit `agent.telemetry` after each change (token fields stay undefined for now).
- Keep `persistArtifacts` behaviour; just remove its log lines.
- Keep the line-144 double-subscribe guard.
- Update Phase 02's `runQuorum` to use the real `createOpencodeEventBridge` instead of the stub factory.
- Ship `src/opencode-event-bridge.test.ts`.

## Out Of Scope

- Adding token-usage counters from model output (future work; emit `tokensIn/Out` as undefined now).
- Touching `src/index.ts` (Phase 04).
- Changing `persistArtifacts` semantics or output paths.
- Any TUI / React work.

## Implementation Details

Event-mapping table (from plan §10 Step 3, reproduced for execution):

| `src/telemetry-enrichment.ts` line | Old behaviour | New `bus.emit` kind |
|---|---|---|
| 109 | `session created` log | `session.created` |
| 119 / 122 | node start / end log | `graph.node` (`phase: "start" | "end"`) |
| 179 | `session ${nextStatus}` log | `session.status` |
| 192 | `session error` log | `session.error` |
| 214 | `permission asked` log | `agent.permission` |
| 225 | `assistant started` log | `agent.message.start` |
| 237–242 | reasoning buffer flush | `agent.reasoning` (text already trimmed/normalized by `flushReasoning`) |
| 332–335 | tool state log | `agent.tool` (`status: "running" | "completed" | "error"`) |

Behavioural preservation:

- Reasoning buffering logic (`shouldFlushReasoning`, `flushReasoning`, lines 66-83) untouched. Only the **flush sink** changes from `logProgress` to `bus.emit`.
- Langfuse observations: opening on tool start (`lines 281-300`) and closing on completed/error (`lines 305-330`) stays exactly as is.
- `start()` guard at line 144 stays. Calling `start()` again returns the already-running promise.
- `stop()` aborts via the existing `AbortController` and awaits the iterator drain.

Counter emission rule:

- On `agent.tool` `status:"running"` → `tools++`; emit `agent.telemetry { role, toolCallsTotal: tools }`.
- On `agent.tool` `status:"error"` → `errors++`; emit `agent.telemetry { role, toolCallsTotal: tools, ... }`. (Inferred: `agent.telemetry` does not currently carry an error count field; if needed for the dashboard, extend the union in Phase 02 retroactively. Default: emit only `toolCallsTotal`; the store derives `toolsErrored` from `agent.tool` events directly per plan §10 Step 6.)

Test scaffolding (`src/opencode-event-bridge.test.ts`):

- Stub `client.event.subscribe` to return an async iterator that yields a hand-written sequence covering each opencode event kind listed in plan §10 Step 3.
- Use a real `createEventBus()` (Phase 02), collect emitted events into an array, assert ordering and shape.
- For the buffering test: yield 10 `message.part.delta` events whose text contains no terminal punctuation; assert array length 0 of `agent.reasoning`. Then yield one with a `.`; assert length 1.
- For the double-`start` test: call `start()` twice; assert the stub `client.event.subscribe` was invoked exactly once.
- For the `stop()`/restart test: call `stop()`; assert the stub iterator's `return()` was called; call `start()` again and assert subscribe count is now 2.

## Execution Checklist

1. `git mv src/telemetry-enrichment.ts src/opencode-event-bridge.ts`.
2. Rename the exported function and update its return type/signature to take `{ bus: EventBus }`.
3. Remove the `liveConsole` branch and any code path that depends on it (`lines 36, 85-100`).
4. Walk every `logProgress` call site in the file; replace with `bus.emit(...)` per the mapping table. Delete `logProgress` itself.
5. Add per-role counters and `agent.telemetry` emission on tool events.
6. Wire the real `createOpencodeEventBridge` into `runQuorum`'s default `BridgeFactory` (`src/runner.ts`); remove the "not implemented" stub.
7. Write `src/opencode-event-bridge.test.ts` covering all bullets in "Implementation Details / Test scaffolding".
8. Run `bunx tsc --noEmit` and fix any importer errors (none expected in `src/`; `src/index.ts` will be deleted in Phase 04 but currently still imports the old name — see "Open Questions").
9. Run `bun test`. Both new test files pass.
10. `grep -r telemetry-enrichment src/` returns nothing.

## Files And Systems Likely Affected

- `src/telemetry-enrichment.ts` → `src/opencode-event-bridge.ts` (renamed + rewritten)
- `src/opencode-event-bridge.test.ts` (new)
- `src/runner.ts` (swap stub factory for real bridge)
- `src/index.ts` (still imports the old name; either patch the import temporarily or delete the file as part of this phase — see "Open Questions Or Blockers")

## Verification

- `bun test` — all new tests pass; Phase 02 tests still pass.
- `bunx tsc --noEmit` — exit 0.
- `grep -rn "telemetry-enrichment" src/` — empty.
- `grep -rn "logProgress" src/` — empty.
- Manual: scripted bridge test prints emitted events in order and they match the mapping table.

## Done Criteria

- File renamed; exported symbol renamed.
- Every `logProgress` site replaced with a typed `bus.emit`.
- Reasoning buffering, Langfuse lifecycle, and single-subscriber guard preserved.
- Tests green; typecheck clean; no stale references.
- `runQuorum` uses the real bridge.

## Handoff To Next Phase

- Next phase: **04 — Delete the old entry point** (`docs/phases/04-delete-old-entry.md`).
- What it depends on from this phase: every consumer that needs opencode SDK events now reads them off the bus through `runQuorum`. There is no remaining reason to keep `src/index.ts`.
- Becomes unblocked: Phases 04 and 05 (TUI shell can call `runQuorum` with a real bridge); Phase 06 (run store can drive its tests against the same bus shape).

## Open Questions Or Blockers

- `src/index.ts` currently imports `createTelemetryEnrichment`. Two viable orderings:
  1. Patch the import to the new name in this phase (keep `src/index.ts` compiling), then delete the file in Phase 04.
  2. Delete `src/index.ts` as part of this phase. (Cleaner; removes the chicken-and-egg.)
  Recommended: option 1 to preserve the strict per-phase scope. Status: Inferred default — confirm with executor before they pick.

## Sources

- `docs/tui-implementation-plan.md` §10 Step 3, §13.
- `src/telemetry-enrichment.ts:33-345` — entire current bridge.
- `src/telemetry-enrichment.ts:144` — single-subscriber guard.
- `src/telemetry-enrichment.ts:66-83` — reasoning buffer.
- `src/telemetry-enrichment.ts:281-330` — Langfuse tool observation lifecycle.
