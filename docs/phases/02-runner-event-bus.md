# Phase 02 — Define `RunnerEvent` and the bus, extract `runQuorum()`

Source plan: `docs/tui-implementation-plan.md` §10 Step 2.

## Execution Snapshot

- Phase: 02 / 09
- Source plan: `docs/tui-implementation-plan.md`
- Readiness: **Blocked** on Phase 01.
- Primary deliverable: `src/runner.ts` exporting `RunnerEvent` (discriminated union), `createEventBus()`, and `runQuorum({ config, prerequisites, request, bus, signal? })`. Plus `src/runner.test.ts`.
- Blocking dependencies: Phase 01 (TS toolchain accepts `.ts` and `bun test` works — already true for `.ts`, so this phase can technically run before Phase 01 finishes; gated only by `bun test`).
- Target measurements: `bunx tsc --noEmit` exit 0; `bun test src/runner.test.ts` exit 0.
- Next phase: 03 — opencode event bridge.

## Why This Phase Exists

Today `src/index.ts:99-176` couples argument parsing, graph invocation, telemetry lifecycle, and process exit. The TUI cannot start a run from inside a long-lived process while that coupling exists. This phase extracts the orchestration into a function the TUI can call, defines the typed event surface the React tree will consume, and provides the bus that decouples emitters (graph observer + opencode bridge) from consumers (run store).

This is the keystone of the refactor: every later phase either emits onto this bus or reads from it.

## Start Criteria

- Phase 01 done (or `bun test` and `tsc` work without it).
- The current behaviour of `src/index.ts:99-176` (graph invoke, telemetry start/shutdown, observer wiring) is understood and reproducible (Confirmed by source plan §4).

## Dependencies And How To Check Them

| Dependency | Why | How to verify | Status |
|---|---|---|---|
| Phase 01 toolchain | Need `bun test` and `tsc` to run | `bun test --help` works; `bunx tsc --noEmit` succeeds on baseline | Done after Phase 01 |
| `createGraph(...)` from `src/graph.ts` | Runner invokes it | `grep -n "createGraph" src/graph.ts` finds export | Done |
| `observer.onSessionCreated/onNodeStart/onNodeEnd` hooks | Runner re-routes them onto bus | `src/graph.ts:1175-1213, 1244-1255` | Done |
| `createTelemetry(...)` from `src/telemetry.ts` | Runner owns telemetry shutdown | `grep -n "createTelemetry" src/telemetry.ts` | Done (Inferred — file exists; not opened in plan) |
| `loadRuntimeConfig`, `ensureArtifactDir`, `validateRuntimePrerequisites` | Runner accepts these as inputs | Existing `src/index.ts:52-57` calls them | Done |
| `createOpencodeEventBridge` | Runner starts/stops it | Will not exist until Phase 03 | **Not Done** — see Open Questions |

## Target Measurements And Gates

Entry gate: `bun test` runs (Phase 01).

Exit gates:

- `bunx tsc --noEmit` exits 0 with `src/runner.ts` and `src/runner.test.ts` present.
- `bun test src/runner.test.ts` exits 0 — covers bus delivery, listener `off`, listener-error isolation, and a compile-time `assertNever` on `RunnerEvent`.
- No `console.log` or `console.warn` emitted by `src/runner.ts` outside of explicit error reporting (plan §3 constraint).

## Scope

- Define `RunnerEvent` discriminated union with the kinds listed in plan §10 Step 2.
- Implement `createEventBus()` returning `{ emit, on, off }`. Synchronous emit; listener errors caught and ignored (plan §6 implicit, §13 test bullet).
- Implement `runQuorum({ config, prerequisites, request, bus, signal? })` that:
  - generates `requestId`,
  - creates and starts `createOpencodeEventBridge(config, { bus })` (will be wired in Phase 03 — temporarily stub the call behind a small interface to unblock this phase; see Implementation Details),
  - constructs `telemetry` via `createTelemetry(...)`,
  - emits `lifecycle{phase:"starting",...}`,
  - calls `createGraph(...).invoke(...)` exactly as today, but routes observer hooks into `bus.emit(...)`,
  - on success emits `result` then `lifecycle{phase:"complete"}`,
  - on error emits `lifecycle{phase:"error", error}`,
  - **always** awaits `telemetry.shutdown()` and `bridge.stop()` in `finally`.
- Ship unit tests in `src/runner.test.ts`.

## Out Of Scope

- Rewriting `src/telemetry-enrichment.ts` (Phase 03).
- Deleting `src/index.ts` (Phase 04).
- Any TUI / React code (Phase 05+).
- Wiring real model-usage tokens into `agent.telemetry` (plan §10 Step 3 says "tokens can stay 0").

## Implementation Details

`src/runner.ts` exports:

```ts
export type RunnerEvent =
  | { kind: "lifecycle"; phase: "starting" | "running" | "complete" | "error"; requestId: string; traceId?: string; outputDir?: string; error?: unknown }
  | { kind: "graph.node"; node: string; phase: "start" | "end" }
  | { kind: "session.created"; sessionID: string; role: string }
  | { kind: "session.status"; sessionID: string; role: string; status: string }
  | { kind: "session.error"; sessionID: string; role: string; name: string; message?: string }
  | { kind: "agent.message.start"; role: string; messageID: string }
  | { kind: "agent.reasoning"; role: string; text: string }
  | { kind: "agent.tool"; role: string; tool: string; status: "running" | "completed" | "error"; callID: string; error?: string }
  | { kind: "agent.permission"; role: string; permission: string }
  | { kind: "agent.telemetry"; role: string; tokensIn?: number; tokensOut?: number; toolCallsTotal?: number }
  | { kind: "result"; runResult: unknown }
```

`createEventBus()`:

- Backed by `Set<(e: RunnerEvent) => void>`.
- `emit(e)` iterates the set; each listener is wrapped in `try/catch` so one bad listener does not break others.
- `on(fn)` returns an `off` function and also adds the listener to the set.
- `off(fn)` removes from the set.

`runQuorum(args)`:

- Signature: `({ config, prerequisites, request, bus, signal? }: RunQuorumArgs) => Promise<RunResult>`.
- Mirror `src/index.ts:99-129` for `createGraph(...).invoke(input, { configurable: { thread_id: requestId } })`.
- Replace `progress.trackNodeStart/End/Session` with `bus.emit({ kind: "graph.node", ... })` and `bus.emit({ kind: "session.created", ... })`.
- `lifecycle{phase:"running"}` is emitted right before `.invoke(...)`.
- Construct the bridge through a small injected factory parameter to keep this phase shippable before Phase 03 lands:
  ```ts
  type BridgeFactory = (config: Config, opts: { bus: EventBus }) => { start(): Promise<void>; stop(): Promise<void> }
  ```
  Default to `createOpencodeEventBridge` when it exists; tests pass a stub.
- `signal` is plumbed into `createGraph(...).invoke(input, { signal, configurable })` — Inferred: LangGraph honours `signal` via the underlying runnable. If not, abort by `bridge.stop()` + bus emit of `lifecycle{phase:"error"}`.
- `finally` block: `await telemetry.shutdown()` then `await bridge.stop()`. Both must complete even if one throws (use sequential `try/catch` inside).

Tests in `src/runner.test.ts`:

- `createEventBus` delivers a `lifecycle` event to two listeners; both fire exactly once.
- `off()` returned from `on()` removes the listener; subsequent `emit` does not call it.
- A listener that throws does not prevent the next listener from running.
- Compile-time exhaustiveness: a small `assertNever` switch over `RunnerEvent.kind` compiles (no runtime assertion needed; a missing case fails `bunx tsc --noEmit`).

## Execution Checklist

1. Create `src/runner.ts` with `RunnerEvent`, `EventBus`, `createEventBus`, and an empty `runQuorum` exported with the right signature.
2. Implement `createEventBus` per "Implementation Details".
3. Implement `runQuorum` body, routing graph observer hooks to `bus.emit`. Use the injected `BridgeFactory` parameter; default factory throws "not implemented" until Phase 03.
4. Ensure `finally` always awaits `telemetry.shutdown()` and `bridge.stop()` (sequential, each in its own `try`).
5. Write `src/runner.test.ts` covering the bus tests above and a `runQuorum` smoke test using a stub graph + stub bridge that emits one of every `RunnerEvent` kind.
6. Run `bunx tsc --noEmit` and `bun test src/runner.test.ts`. Fix until both green.

## Files And Systems Likely Affected

- `src/runner.ts` (new)
- `src/runner.test.ts` (new)
- No modifications to existing files in this phase. (`src/index.ts` continues to import `telemetry-enrichment` until Phase 03; runner is built parallel until then.)

## Verification

- `bunx tsc --noEmit` exits 0.
- `bun test src/runner.test.ts` exits 0; output shows ≥ 4 passing assertions.
- Manual: `grep -n "console\\." src/runner.ts` returns at most one line (an explicit error path).
- Manual: search `src/runner.ts` for `bus.emit` — every observer hook reroutes to it.
- Manual: confirm `finally` is present and awaits both shutdown calls.

## Done Criteria

- `src/runner.ts` exports `RunnerEvent`, `createEventBus`, `runQuorum`.
- All listed unit tests pass.
- TS typecheck clean.
- Bridge construction is behind a factory so Phase 03 can plug in without changing this file.

## Handoff To Next Phase

- Next phase: **03 — opencode event bridge** (`docs/phases/03-opencode-event-bridge.md`).
- Artifacts the next phase relies on: `RunnerEvent` union and `EventBus` type from `src/runner.ts` (Phase 03 imports these to emit typed events instead of `console.log`).
- Becomes unblocked: Phase 03 can replace its stub factory with the real bridge; Phase 06 can begin in parallel against the typed event surface.

## Open Questions Or Blockers

- LangGraph `invoke` honouring `AbortSignal` is **Inferred**, not Confirmed in the plan. If it does not, document the workaround inside `runQuorum` (best-effort: cancel via `bridge.stop()` and let the in-flight `invoke` finish).
- `agent.telemetry` token fields are emitted only when known; for now `tokensIn`/`tokensOut` may stay undefined (plan §10 Step 3).

## Sources

- `docs/tui-implementation-plan.md` §10 Step 2, §6, §8.
- `src/index.ts:52-57, 99-176` — current orchestration shape to extract.
- `src/graph.ts:1175-1213, 1244-1255` — observer hooks and session creation.
- `src/telemetry.ts` (Inferred — `createTelemetry`/`telemetry.shutdown()` referenced in plan §10).
