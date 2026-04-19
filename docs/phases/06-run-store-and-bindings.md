# Phase 06 — Run store with batched dispatch + event bindings

Source plan: `docs/tui-implementation-plan.md` §10 Step 6.

## Execution Snapshot

- Phase: 06 / 09
- Source plan: `docs/tui-implementation-plan.md`
- Readiness: **Blocked** on Phases 01 (toolchain) and 02 (`RunnerEvent` / `EventBus`). Can run in parallel with Phase 05 — the store has no dependency on the renderer.
- Primary deliverable: `src/tui/state/runStore.ts` (pure reducer + state container) and `src/tui/state/eventBindings.ts` (`bindBusToStore` with ~50ms batching). Plus `src/tui/state/runStore.test.ts` and `src/tui/state/eventBindings.test.ts`.
- Blocking dependencies: Phase 02 (typed events).
- Target measurements: 100 reasoning events in one tick yield exactly one `store.set` call, with all 100 entries preserved in order; reducer round-trips every `RunnerEvent` kind.
- Next phase: 07 — Components.

## Why This Phase Exists

Two separate worries live here:

1. **State shape.** Components need a single source of truth that maps each `RunnerEvent` to per-agent scrollback, counters, and lifecycle. The reducer encodes that mapping once so each `AgentPanel` does not have to reinvent it.
2. **Render storms.** Reasoning deltas burst at >30/s per agent (plan §3, §6, §12). Without coalescing, React would dispatch hundreds of updates per second and the renderer would thrash. Batching at ~50ms ticks turns a burst into one render.

Both problems are pure-function shaped, so this phase is also the most testable, and lands the bulk of the automated coverage.

## Start Criteria

- Phase 02 done: `RunnerEvent` and `EventBus` exist.
- Phase 01 done: `bun test` works.

## Dependencies And How To Check Them

| Dependency | Why | How to verify | Status |
|---|---|---|---|
| `RunnerEvent` discriminated union | Reducer's input type | `grep -n "RunnerEvent" src/runner.ts` | Done after Phase 02 |
| `EventBus` interface | Bindings subscribe to it | Same | Done after Phase 02 |
| `quorum.config.json` shape | Role-key mapping (`auditor:source` → `source-auditor`) | `cat quorum.config.json` shows `designatedDrafter` + `auditors` | Done |
| `bun test` | Reducer + bindings tests | Phase 01 | Done after Phase 01 |

## Target Measurements And Gates

Entry gate: Phase 02 + Phase 01 green.

Exit gates:

- `bun test src/tui/state/runStore.test.ts src/tui/state/eventBindings.test.ts` exits 0.
- For every `RunnerEvent.kind`, the reducer test asserts a known prior-state → next-state diff (10 cases listed in plan §13).
- An `agent.tool` event with `status:"error"` increments both `toolsTotal` and `toolsErrored`.
- Role-key mapping: `"auditor:source"` resolves to the `source-auditor` slot.
- Bindings test: 100 `agent.reasoning` events in one tick → one `store.set` call, scrollback contains all 100 in order.
- `unbind()` returned from `bindBusToStore` removes listeners; subsequent `emit` does not mutate the store.
- `bunx tsc --noEmit` exit 0.

## Scope

- `src/tui/state/runStore.ts`: state shape, `createRunStore({ config })` returning `{ get, set, subscribe }`, and a pure `reduce(state, event) → state`.
- `src/tui/state/eventBindings.ts`: `bindBusToStore(bus, store)` returning `unbind()`. Internal queue + `setTimeout(flush, 50)` coalescing.
- Role-key mapping helper inside the store (or its own file): `resolveRoleKey(rawRole, quorumConfig) → "drafter" | "<auditor-name>" | "root"`.
- Tests for both modules.

## Out Of Scope

- React hooks / wiring components to the store (Phase 07).
- Renderer / `App.tsx` changes (Phases 05, 07).
- The actual `runQuorum` invocation from `App` (Phase 07/09).

## Implementation Details

State shape (from plan §10 Step 6):

```ts
type AgentState = {
  sessionID?: string
  status: "idle" | "running" | "error" | "complete"
  lastEventAt: number
  scrollback: Array<{ kind: "reasoning" | "tool" | "permission" | "system"; text: string; ts: number }>
  tokensIn: number
  tokensOut: number
  toolsTotal: number
  toolsErrored: number
  activeTool?: { tool: string; callID: string; startedAt: number }
  pendingPermission?: string
}

type RunStoreState = {
  lifecycle: { phase: "starting" | "running" | "complete" | "error"; requestId?: string; traceId?: string; outputDir?: string; error?: unknown }
  graph: { node?: string; round: number; status: string }
  agents: Record<string, AgentState>
  result?: unknown
}
```

Initial agent map is seeded from `config.quorumConfig.designatedDrafter` + `config.quorumConfig.auditors`, all in `idle`.

Reducer per `RunnerEvent.kind`:

| Event | State change |
|---|---|
| `lifecycle` | `state.lifecycle = { ...event }`; on `complete`, freeze `result` if present |
| `graph.node` | `state.graph.node = event.node`; track `round` if node implies it (Inferred — graph nodes encode rounds; reuse existing logic from `src/graph.ts` if available) |
| `session.created` | `agents[role].sessionID = event.sessionID` |
| `session.status` | `agents[role].status = derive(event.status)` |
| `session.error` | `agents[role].status = "error"`; append scrollback `{kind:"system", text:"error: ${name}: ${message}"}` |
| `agent.message.start` | append scrollback `{kind:"system", text:"assistant started"}` |
| `agent.reasoning` | append scrollback `{kind:"reasoning", text}` |
| `agent.tool` `running` | `agents[role].activeTool = {...}`; `toolsTotal++`; append scrollback `{kind:"tool", text:"tool ${tool} running"}` |
| `agent.tool` `completed` | clear `activeTool`; append `{kind:"tool", text:"tool ${tool} completed"}` |
| `agent.tool` `error` | clear `activeTool`; `toolsErrored++`; append `{kind:"tool", text:"tool ${tool} failed: ${error}"}` |
| `agent.permission` | `agents[role].pendingPermission = event.permission`; append scrollback |
| `agent.telemetry` | apply `tokensIn` / `tokensOut` / `toolCallsTotal` if defined |
| `result` | `state.result = event.runResult` |

All updates set `agents[role].lastEventAt = Date.now()`.

Role mapping:

- Incoming role strings (per plan §10 Step 6, §3 Confirmed): `"root" | "drafter" | "auditor:<name>"`.
- Map to internal keys:
  - `"root"` → no agent slot; lifecycle/graph/dashboard only.
  - `"drafter"` → `quorumConfig.designatedDrafter` (e.g. `"research-drafter"`).
  - `"auditor:source"` → `"source-auditor"` (the matching entry in `quorumConfig.auditors`).
- If a role does not map, drop the event and log to the system log buffer (do not crash).

`createRunStore`:

- Holds `state` in a closure; `get()` returns it; `set(next)` replaces and notifies subscribers; `subscribe(fn)` returns `unsubscribe`.
- No React dependency in this file.

`bindBusToStore(bus, store)`:

- Maintains `pendingEvents: RunnerEvent[]` and `flushScheduled: boolean`.
- On each `bus.emit`, push to `pendingEvents`; if not scheduled, `setTimeout(flush, 50)` and set the flag.
- `flush()`: drain queue, fold every event through `reduce(state, e)` once, then call `store.set(nextState)`.
- Returns `unbind()` that removes the bus listener and cancels any pending flush.

Tests:

- `runStore.test.ts`:
  - For each event kind, build a known prior state, dispatch the event through `reduce`, assert the diff matches.
  - `agent.tool` `error` → `toolsTotal++` and `toolsErrored++` both true.
  - Role mapping: `"auditor:source"` resolves to `source-auditor` slot for a config matching `quorum.config.json`.
- `eventBindings.test.ts`:
  - Stub `bus` (or use real `createEventBus()` from Phase 02). Stub `store.set` with a counter.
  - Emit 100 `agent.reasoning` events synchronously inside one tick. After the 50ms flush, assert `store.set` called exactly once and resulting state has scrollback length 100 in event order.
  - `unbind()` then `emit` more events; assert `store.set` not called again.

## Execution Checklist

1. Create `src/tui/state/runStore.ts` with state shape, `reduce`, `createRunStore`, role-mapping helper.
2. Create `src/tui/state/eventBindings.ts` with `bindBusToStore` per Implementation Details.
3. Create `src/tui/state/runStore.test.ts` covering every event kind + role mapping + tool error counter.
4. Create `src/tui/state/eventBindings.test.ts` covering batching + unbind.
5. Run `bunx tsc --noEmit`. Fix.
6. Run `bun test src/tui/state/`. All tests green.

## Files And Systems Likely Affected

- `src/tui/state/runStore.ts` (new)
- `src/tui/state/eventBindings.ts` (new)
- `src/tui/state/runStore.test.ts` (new)
- `src/tui/state/eventBindings.test.ts` (new)

## Verification

- `bunx tsc --noEmit` → exit 0.
- `bun test src/tui/state/` → all tests pass.
- Manual: `grep -n "setTimeout" src/tui/state/eventBindings.ts` shows the 50ms flush.
- Manual: `grep -n "console\\." src/tui/state/` returns nothing (state is pure).

## Done Criteria

- Reducer handles every `RunnerEvent.kind` deterministically.
- Bindings batch bursts into one `store.set` per ~50ms tick.
- All listed unit tests pass.
- TS typecheck clean.
- No React imports in `runStore.ts` or `eventBindings.ts` (so they remain unit-testable without a renderer).

## Handoff To Next Phase

- Next phase: **07 — Components** (`docs/phases/07-components.md`).
- What it depends on from this phase: `createRunStore`, the state shape, and `bindBusToStore`. Components subscribe with selectors; `App` constructs one store per run and one binding per bus.
- Becomes unblocked: Phase 07 (every component reads from this store), Phase 09 (re-run flow resets the store between runs).

## Open Questions Or Blockers

- Whether `graph.node` events imply `round` deltas: Inferred. Confirm by reading the graph node names in `src/graph.ts:1175-1213` during execution; if rounds are emitted as their own event today, extend `RunnerEvent` retroactively (small Phase 02 amendment).
- 50ms tick value is a starting point. Plan §12 mentions falling back to `requestAnimationFrame`-style throttling if still jittery; Inferred — keep 50ms unless manual smoke (Phase 07) shows visible thrash.

## Sources

- `docs/tui-implementation-plan.md` §10 Step 6, §3, §6, §12, §13.
- `quorum.config.json:1-15` — drafter + auditor names for role mapping.
- `src/graph.ts:1175-1213, 1244-1255` — observer hook shapes that produce role strings.
