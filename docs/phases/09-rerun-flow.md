# Phase 09 — Re-run flow (r / n / f from summary, store reset between runs)

Source plan: `docs/tui-implementation-plan.md` §10 Step 9, §12 (double-subscribe risk), §13 (manual verification).

## Execution Snapshot

- Phase: 09 / 09 (final)
- Source plan: `docs/tui-implementation-plan.md`
- Readiness: **Blocked** on Phases 02 (`runQuorum` + bus), 05 (`openInEditor`), 06 (`createRunStore` + `bindBusToStore`), 07 (`App`'s screen state machine + `lastRequest` retention), 08 (`SummaryScreen.onAction` keyboard wiring).
- Primary deliverable: real implementations for `App`'s three summary actions — `rerun`, `new-topic`, `new-document` — plus the guarantee that the per-run store/bus/binding lifecycle is recreated cleanly between runs with no double-subscribers and no leftover scrollback.
- Blocking dependencies: all prior phases.
- Target measurements: two back-to-back runs produce no duplicated `agent.tool` events in any panel; `r` re-runs with the cached document content (refreshed from disk if the file still exists); `f` opens `$EDITOR` immediately on a fresh `requestId`; `n` returns to topic mode with empty input. This is the final phase, so the broader rollout/validation from plan §13 also lives here.
- Next phase: none. This phase ships the feature.

## Why This Phase Exists

Re-running is the one place where the runner's lifecycle, the editor's file conventions, and the renderer's state all collide. Done wrong, the second run shows every event twice (plan §12 "Double-subscribe on re-run"), or shows ghost scrollback from the previous run, or silently re-uses stale document content even though the user edited the file in another window. Pulling all three actions into one phase makes the contract testable as a single end-to-end story rather than three half-features.

This is also the natural place to do the full plan §13 manual verification because it is the first time the TUI has nothing left to add.

## Start Criteria

- Phase 02 done: `runQuorum(request, bus, opts)` resolves cleanly, awaits its own `bridge.stop()` in `finally`.
- Phase 05 done: `openInEditor({ requestId, renderer })` returns `{ ok, content, path } | { ok: false, reason }` and creates `runs/.drafts/<requestId>.md`.
- Phase 06 done: `createRunStore` + `bindBusToStore` + `unbind()`.
- Phase 07 done: `App.tsx` retains `lastRequest`, owns `runCtx = { bus, store, unbind, ac, promise }` per run, and recreates the store per run (so reset is a side effect of "run again").
- Phase 08 done: `SummaryScreen.onAction("rerun" | "new-topic" | "new-document")` is wired to a callback in `App` (currently a stub: `setScreen("prompt")`).

## Dependencies And How To Check Them

| Dependency | Why | How to verify | Status |
|---|---|---|---|
| `runQuorum` awaits bridge teardown | No leaked subscribers between runs | `grep -n "bridge.stop\\|finally" src/runner.ts` | Done after Phase 02/03 |
| `App` has `lastRequest` state | `r` can replay it | `grep -n "lastRequest" src/tui/App.tsx` | Done after Phase 07 |
| `App` recreates store per run | Reset between runs | `grep -n "createRunStore" src/tui/App.tsx` | Done after Phase 07 |
| `SummaryScreen.onAction` plumbed | Action dispatch | `grep -n "onAction" src/tui/components/SummaryScreen.tsx src/tui/App.tsx` | Done after Phase 08 |
| `openInEditor` honours an explicit `requestId` | `f` opens a fresh file | `grep -n "requestId" src/tui/editor.ts` | Done after Phase 05 |
| `runs/.drafts/` in `.gitignore` | New `requestId` files do not pollute git | `grep -n "runs/.drafts" .gitignore` | Done after Phase 01 |

## Target Measurements And Gates

Entry gate: all prior phases green; `bunx tsc --noEmit` exit 0; `bun test` exit 0.

Exit gates:

- `r` from a topic-mode summary re-runs with the same topic; counters reset to zero before the second run starts; no `agent.tool` event duplicates in any panel during the second run (plan §13 step 7).
- `r` from a document-mode summary re-reads `runs/.drafts/<requestId>.md` from disk before invoking `runQuorum`. If the file is missing or unreadable, fall back to the cached `document.content` from `lastRequest` and surface a footer hint (`"using cached document"`).
- `n` returns to `PromptScreen` in topic mode with an empty topic input.
- `f` returns to `PromptScreen` in document mode with a freshly generated `requestId`, immediately invokes `openInEditor` (renderer suspends), then returns to the prompt with the new document loaded. If the editor is cancelled (`{ ok: false, reason }`), the user lands on the prompt screen in document mode with no document and a hint matching the failure reason.
- After any of the above, the previous run's `bus`, `store`, and `unbind` are no longer referenced by `App` (verifiable manually by checking that the new run uses a different store identity in DevTools-equivalent: log the store reference into the system log buffer at run start and confirm it changes).
- The integration test from plan §13 (`src/runner.integration.test.ts`, gated on `RUN_INTEGRATION=1`) passes: two back-to-back runs produce exactly twice the events with no duplicates.
- `grep -r telemetry-enrichment src/` returns no results (regression check from plan §13).
- The full plan §13 manual verification passes for both an approved and a failed-quorum scenario.

## Scope

- Real implementations of three handlers in `src/tui/App.tsx`:
  - `handleRerun()`
  - `handleNewTopic()`
  - `handleNewDocument()`
- A small helper `startRun(request)` in `App.tsx` that encapsulates "create bus + store + binding + AbortController, call `runQuorum`, store `runCtx`, transition to running, transition to summary on resolve/reject, unbind in finally". Phase 07 already had a version of this — Phase 09 just hardens it.
- A "stale subscriber" smoke test (`src/runner.integration.test.ts`) gated on `RUN_INTEGRATION=1`.
- A `.gitignore` recheck (no change expected — Phase 01 already added `runs/.drafts/`).
- This README/handoff section is replaced with a **Rollout And Validation** section (per phase-execution-briefs skill rule for the final phase).

## Out Of Scope

- The 20-line CLI shim from plan §14 — explicitly back-pocket only, not built unless rollout breaks.
- Cleanup/garbage-collection of old `runs/.drafts/<requestId>.md` files — plan §12 says keep them, document `runs/.drafts/` as safe to delete.
- Cross-session persistence of `lastRequest` (so `r` would work after restart): not in plan.
- Telemetry observation hierarchy changes — must remain identical (regression check).

## Implementation Details

### `startRun(request)` (refactor in `App.tsx`)

```ts
function startRun(request: Request) {
  // Tear down any leftover ctx defensively (should already be unbound by previous .finally,
  // but guards against an action firing before that .finally has resolved).
  if (runCtx) {
    runCtx.ac.abort()
    runCtx.unbind()
  }

  const bus = createEventBus()
  const store = createRunStore({ config: quorumConfig })
  const unbind = bindBusToStore(bus, store)
  const ac = new AbortController()
  const promise = runQuorum(request, bus, { signal: ac.signal })
    .then((result) => {
      setLastResult(result)
      setScreen("summary")
    })
    .catch((err) => {
      setLastError(err)
      setScreen("summary")
    })
    .finally(() => {
      unbind()
    })

  setRunCtx({ bus, store, unbind, ac, promise })
  setLastRequest(request)
  setScreen("running")
}
```

Key invariants:

- `bus` and `store` are recreated per run, so all per-agent scrollback and counters start at zero.
- `unbind()` is called both inside `.finally` and inside the defensive `if (runCtx)` block — both are idempotent (Phase 06 must guarantee this; if it does not, retroactively patch).
- `lastRequest` is set on every `startRun`, not before, so a failed `runQuorum` invocation does not corrupt the cached request.

### `handleRerun()`

```ts
async function handleRerun() {
  if (!lastRequest) return // defensive; r should be disabled when no run yet
  if (lastRequest.mode === "document" && lastRequest.document) {
    const draftsPath = lastRequest.document.path
    let content = lastRequest.document.content
    try {
      const fresh = await fs.readFile(draftsPath, "utf8")
      if (fresh.trim().length > 0) content = fresh
      else setFooterHint("draft empty on disk — using cached document")
    } catch {
      setFooterHint("draft missing on disk — using cached document")
    }
    return startRun({ mode: "document", document: { path: draftsPath, content } })
  }
  return startRun(lastRequest)
}
```

`fs.readFile` is `node:fs/promises.readFile`. Note: do not re-open `$EDITOR` on `r` (plan §10 Step 9, §13 step 7).

### `handleNewTopic()`

```ts
function handleNewTopic() {
  setLastRequest(undefined) // optional — keeps PromptScreen pristine
  setScreen("prompt")
  // PromptScreen reads an `initialMode` prop or its own state; ensure it lands in "topic" mode.
}
```

Add an `initialMode?: "topic" | "document"` prop to `PromptScreen` so `App` can force the mode on entry.

### `handleNewDocument()`

```ts
async function handleNewDocument() {
  setScreen("prompt")
  // Switch PromptScreen to document mode, then auto-trigger openInEditor on a fresh requestId.
  const requestId = crypto.randomUUID()
  const renderer = rendererRef.current
  if (!renderer) return
  const result = await openInEditor({ requestId, renderer })
  if (result.ok) {
    return startRun({ mode: "document", document: { path: result.path, content: result.content } })
  }
  // Stay on prompt screen in document mode with a hint matching the failure reason.
  setComposeHint(result.reason === "empty" ? "(empty — nothing saved)" : "(cancelled)")
}
```

Open the editor synchronously from the action handler so the renderer's `suspend()` happens immediately and the user does not see the prompt screen flicker. The Phase 05 `openInEditor` already wraps `suspend/resume` in a `try/finally`, so cancellation is safe.

`rendererRef`: Phase 07 already exposes `useRenderer()` inside components; in `App.tsx` we need a renderer reference reachable from an action handler. Either store it in a ref via `useRenderer()` at the top of `App`, or move `handleNewDocument` into a child component that has access to `useRenderer()`. The first approach keeps the action handlers co-located.

### Wiring `SummaryScreen.onAction`

Replace Phase 07/08 stub:

```ts
function onSummaryAction(action: SummaryAction) {
  if (action === "rerun") return handleRerun()
  if (action === "new-topic") return handleNewTopic()
  if (action === "new-document") return handleNewDocument()
  if (action === "quit") return process.exit(0)
}
```

### Defense against `unbind` race

If a user mashes `r` while the previous run's `.finally` has not yet fired (rare on local hardware but possible if `bridge.stop()` blocks on a slow network), `startRun`'s defensive `unbind()` covers it. The single-subscriber guard inside the bridge (Phase 03, line 144 of the renamed file) is the second line of defense and the reason this is not a critical bug.

### Integration test (`src/runner.integration.test.ts`)

Gated on `RUN_INTEGRATION=1` (per plan §13). Wires the real `runQuorum` with a stub `createGraph` that yields a scripted sequence of node start/end + session-created events, and a stub bridge that emits a small handful of `agent.tool` events. Asserts:

1. The bus receives the full scripted sequence in order.
2. Running `runQuorum` twice in a row (second invocation after the first resolves) produces exactly twice the events — no duplication, no loss.
3. `bridge.start` is called exactly twice (one per run).

This is the automated complement to plan §13 step 7.

## Execution Checklist

1. Refactor `App.tsx` `startRun` per Implementation Details (idempotent unbind, store recreation, `runCtx.promise`).
2. Implement `handleRerun`, `handleNewTopic`, `handleNewDocument` in `App.tsx`.
3. Wire `onSummaryAction` to the three handlers + `quit`.
4. Add an `initialMode?: "topic" | "document"` prop to `PromptScreen` so `handleNewTopic` and `handleNewDocument` can land the user in the right place.
5. Add a `composeHint` mechanism to `PromptScreen` so `handleNewDocument`'s cancel/empty footer hint can be shown.
6. Add `src/runner.integration.test.ts` per spec.
7. `bunx tsc --noEmit`. Fix.
8. `bun test`. All green.
9. `RUN_INTEGRATION=1 bun test src/runner.integration.test.ts`. Green.
10. **Full manual verification (plan §13 steps 1–12).** Capture observations:
    - Step 6: confirm `outcome`, `output`, `trace` on `SummaryScreen` match what the old `src/index.ts:160-175` would have printed (compare against a captured side log from a pre-removal commit if possible).
    - Step 7: re-run after a topic-mode run; visually confirm zero duplicate `tool ... completed` lines.
    - Step 8: `f` from the summary; editor opens immediately; save and exit; document summary card appears; `Enter` runs.
    - Step 9: repeat step 8 but exit editor with `:cq` (non-zero status) and again with empty save; correct hints appear.
    - Step 10: `?` overlay toggles mid-run.
    - Step 11: resize narrower than 100 cols mid-run; layout switches without crash.
    - Step 12: `Ctrl-C` mid-run; clean exit within 1–2 s; no orphan opencode warning in next shell.
11. **Failed-quorum scenario:** craft an input that you know will fail audits (e.g. a deliberately ambiguous topic), run it through, confirm the summary screen shows `outcome: rejected` (or whichever string the runner emits), unresolved findings count > 0, and `r`/`n`/`f` still work afterward.
12. Regression checks (plan §13):
    - `runs/<requestId>/` artifacts (draft, summary, optional `opencode-events.json`) are still produced as before.
    - Langfuse trace tree (when env is configured) is unchanged structurally.
    - `grep -r telemetry-enrichment src/` returns nothing.

## Files And Systems Likely Affected

- `src/tui/App.tsx` (action handlers, `startRun` hardening, `rendererRef`)
- `src/tui/components/PromptScreen.tsx` (add `initialMode`, `composeHint`)
- `src/runner.integration.test.ts` (new)
- (No changes expected to `runner.ts`, `opencode-event-bridge.ts`, store, or editor — if any are needed they indicate a missing guarantee in an earlier phase and should be fixed there.)

## Verification

- `bunx tsc --noEmit` → exit 0.
- `bun test` → all suites green.
- `RUN_INTEGRATION=1 bun test src/runner.integration.test.ts` → green.
- Full plan §13 manual checklist passes for both approved and failed-quorum scenarios.
- `grep -r telemetry-enrichment src/` returns nothing.
- `runs/<requestId>/` contents are byte-identical in shape to a pre-TUI control run for the same input (small diffs in timestamps are fine).

## Done Criteria

- All three summary actions (`r`, `n`, `f`) work as specified, including the document-mode disk re-read for `r` and the immediate `$EDITOR` invocation for `f`.
- Two back-to-back runs produce no duplicated events; integration test proves it.
- The TUI is the only entry point — `src/index.ts` is gone (confirmed in Phase 04), all docs and `package.json` scripts route through `bun run src/tui/index.tsx` (Phase 01).
- Plan §13 manual verification completed end-to-end with no observed regressions.

## Rollout And Validation

This is the final phase. There is nothing to hand off. Instead:

- **Merge as one PR.** The change is large but localized (plan §14): adds `src/tui/`, adds `src/runner.ts`, renames+rewrites `src/telemetry-enrichment.ts` → `src/opencode-event-bridge.ts`, deletes `src/index.ts`, edits `package.json` and `tsconfig.json`. Reviewing it as one diff lets the reviewer follow the same throughline the plan does.
- **Smoke matrix before merge:** at minimum run plan §13 manual steps 1–8 on macOS in the developer's normal terminal (the only target — there is no deploy). Capture the `runs/<requestId>/` directory of one approved and one failed-quorum run as before/after evidence.
- **Rollback:** `git revert` the merge commit. Nothing in `runs/`, `quorum.config.json`, or the opencode side is affected (plan §14). If only the TUI breaks but the runner is good, the fallback is the 20-line CLI shim from plan §14 — not built proactively.
- **Post-merge watchpoints (first week of use):**
  - Watch for stray `console.warn` from telemetry/zod corrupting the alt-screen (plan §12 mitigation: the system-log interceptor — verify it is actually catching anything by surfacing the count in the help overlay or system log view).
  - Watch for slow `bridge.stop()` causing visible lag between summary and the next `r` press; if seen, add a brief "shutting down…" indicator on the summary screen.
  - Watch for `runs/.drafts/` growing large; document the cleanup command in the README.

## Open Questions Or Blockers

- The exact return shape of `runQuorum` (`runResult` vs side-channel artifacts) determines what `SummaryScreen` reads to compute "approved agents". Confirmed via Phase 02's `RunnerEvent.kind = "result"` payload; if details slipped, retroactively widen the type and re-test the summary computation.
- Whether the integration test's stub `createGraph` interface matches the real one closely enough to catch a real subscriber leak. Inferred — if the real `createGraph` evolves, the test must be kept in sync. Note this in `src/runner.integration.test.ts`.
- Whether `crypto.randomUUID()` is acceptable as the `requestId` source (vs the existing one in `src/index.ts:9-179`). Inferred from the rest of the plan; if `runQuorum` requires a specific shape, mirror it.

## Follow-up: re-introduce `agent.telemetry` (tokens-only)

Phase 06 deliberately dropped the `agent.telemetry` `RunnerEvent` variant and the per-role tool counters (`toolsTotal`, `toolsErrored`) on the grounds that per-role aggregation crosses the runner/TUI boundary. Token counts, by contrast, are legitimately surfaced by opencode's SDK on each assistant message and the TUI dashboard wants to show them per agent. This sub-task adds them back — tokens only, no tool counters.

Steps:

1. **Bridge emission** (`src/opencode-event-bridge.ts`): on each `message.updated` (or equivalent) SDK event whose `info.tokens` is populated, emit a new `RunnerEvent` of kind `agent.telemetry` carrying `{ sessionID, tokensIn, tokensOut }`. Source the values from `info.tokens.input` / `info.tokens.output` (verify exact field names against the SDK at implementation time).
2. **`RunnerEvent` union** (`src/runner.ts`): add `| { kind: "agent.telemetry"; sessionID: string; tokensIn: number; tokensOut: number }`. **Do not** add tool counters of any kind. Update `describeRunnerEvent` and the exhaustiveness check.
3. **Reducer** (`src/tui/state/runStore.ts`): add a case that routes via `sessionID → agent slot` (same lookup pattern as `agent.reasoning`) and **replaces** (not adds) `tokensIn` / `tokensOut` on the agent. Tokens from the SDK are cumulative per session, not deltas.
4. **Tests:** extend `tests/runStore.test.ts` with one case for `agent.telemetry` updating `tokensIn`/`tokensOut`. Extend `tests/opencode-event-bridge.test.ts` with one case asserting the bridge emits `agent.telemetry` when token info is present, and does not emit it when absent.
5. **Components** (Phase 07 deliverable, kept consistent here): `AgentPanel` already reads `tokensIn`/`tokensOut` placeholders; nothing should change in the component — only the underlying values become non-zero.

Out of scope for this sub-task: any per-role tool counter, cost computation, model-specific token pricing. Keep the variant minimal and additive.

## Sources

- `docs/tui-implementation-plan.md` §10 Step 9 (re-run flow), §11 (summary mock), §12 (double-subscribe risk + Ctrl-C + draft accumulation), §13 (full manual verification + integration test spec), §14 (rollback plan).
- `src/index.ts:9-179` — outgoing reference for the JSON outputs that `SummaryScreen` should match.
- `src/checkpointer.ts` — untouched across the entire migration; both old and new code share the same checkpoint sqlite at `config.env.QUORUM_CHECKPOINT_PATH` (plan §14).
- `reference/opentui/packages/core/src/renderer.ts:2107-2165` — `CliRenderer.suspend/resume` as used by `openInEditor` (relevant to `handleNewDocument`).
