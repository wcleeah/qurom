# Phase 5 — Tests

## Execution Snapshot

- **Phase:** 5
- **Source plan:** RecoveryRouter plan, Phase 5
- **Readiness status:** `Blocked` until Phases 1 + 2 + 3 + 3.5 + 4 are code-complete (this phase formalizes their manual matrices).
- **Primary deliverable:** A `tests/json-repair.test.ts` matrix that proves `coerceJson`, the `RecoveryRouter` (D→A/B/C), the Phase 3.5 restart wrapper, and Phase 4 persistence all behave; plus regression guards that the typed-error catch path is reachable (the `await` bug cannot return in spirit) and that the **non-structured** path is untouched.
- **Blocking dependencies:** Phases 1–4 deliverables — `Unknown` until merged.
- **Target measurements:** All matrix cases green; `schema`-fault path never invokes `json-fixer`.
- **Next phase:** `07-telemetry-systemic-drift-guard.md` (Phase 6).

## Why This Phase Exists

Phases 1–4 each carry a "manual matrix scratch" verification. Phase 5 codifies them into committed, machine-checked tests so the ladder's invariants cannot silently regress — especially:

- The `await`-bug-from-Phase-1 cannot return in spirit (any future branch's catch being dead).
- The `schema`-fault → B-not-C invariant — Phase 3's central correctness claim.
- The auditor restart matching only `StructuredRecoveryError` — Phase 3.5's no-mask-of-programmer-errors contract.
- Persistence's no-phantom-success invariant — Phase 4's consistency guarantee.

## Start Criteria

- Phase 1: `coerceJson` exported (or at least testable) + both `await` edits in.
- Phase 2: `readOutputFile` discriminated union; `Continue` retry bounded; transport retry in place.
- Phase 3: `StructuredRecoveryError` exported; router loop replaces both old catches; `repairWithJsonFixer`/`repromptSameAgent` exist; `buildStructuredRepairPrompt` embeds `<zod_issues>` on `schema`.
- Phase 3.5: `auditWithRestart` exported; both auditor callers wrapped; `auditRestart.maxRestarts` config field.
- Phase 4: parse-OK persists inline-valid to `outputFile`; `session.dual_output` logged on diverge.
- All phases: `bunx tsc --noEmit` clean; existing `bun test` green.

## Dependencies And How To Check Them

| Dependency | Why it matters | How to verify | Status |
|---|---|---|---|
| `coerceJson` exported (or inline-importable) | Phase 5 unit-tests it directly | `grep -n "export function coerceJson\|function coerceJson" src/opencode.ts` | `Unknown` |
| `StructuredRecoveryError` exported | Phase 5 imports it to assert `instanceof` and to drive Phase 3.5 tests | `grep -n "export class StructuredRecoveryError" src/opencode.ts` | `Unknown` |
| `auditWithRestart` exported | Phase 5 calls it directly with a stubbed `promptAgent` | `grep -n "export async function auditWithRestart\|auditWithRestart" src/*.ts` | `Unknown` |
| Existing stub harness in `tests/opencode-event-bridge.test.ts` | Reuse for OpenCode-client stubbing (mock `client.session.prompt`/`createSession`) | `grep -n "createOpencodeClient\|session.prompt" tests/opencode-event-bridge.test.ts` | `Done` (existing stub pattern) |
| `auditResultSchema` importable | One test drives the router end-to-end with the real semantic `superRefine` schema | `tests/schema.test.ts` already imports it | `Done` |

## Target Measurements And Gates

| Measurement | Threshold | Method | Gate | Status |
|---|---|---|---|---|
| Matrix coverage | All sections in "Execution Checklist" present and passing | `bun test tests/json-repair.test.ts` | Exit | `Unknown` |
| `schema` → B not C | zero `json-fixer` agent invocations on `schema` faults | Assert the stub's `prompt` calls never pass `agent: "json-fixer"` on the enum-drift case | Exit | `Unknown` |
| Free-tier resolves with ≤1 LLM call | fenced-only failure yields exactly 1 `client.session.prompt` call total | Counter on stubbed prompt | Exit | `Unknown` |
| Non-structured path unchanged | `promptAgent({ schema: undefined })` returns `{ text }` with zero recovery attempts | Snapshot/assert no debug-log `session.recovery.*` events | Exit | `Unknown` |
| `bun test` (full suite) green | no regressions in `schema.test.ts`, `runner.test.ts`, `runner.integration.test.ts`, `opencode-event-bridge.test.ts` | `bun test` | Exit | `Unknown` |

## Scope

- New file `tests/json-repair.test.ts` (the matrix).
- Extend `tests/opencode-event-bridge.test.ts` **only if** its stubs need shape updates to satisfy Phase 2's stricter `error` XOR `data` contract (Phase 2's checklist already flags this; if Phase 2 already adjusted, this is a no-op).
- No production code changes; pure tests + helpers.
- Mirror restart tests against `runDesignAudits` paths (Phase 3.5 covered both auditor callers).

## Out Of Scope

- Telemetry/systemic-drift detection tests (Phase 6).
- Live end-to-end timing tests (covered by Phase 6's end-to-end run report; out of scope for unit matrix).
- Performance/timing benchmarks (router retry bounds are correctness tests, not perf tests).

## Implementation Details

### Helpers

- Stub the OpenCode client (`client.session.prompt`, `client.session.create`) via the existing pattern; capture a call log so tests can assert `agent`, `prompt` content (e.g., contains `<zod_issues>` for the schema branch), `outputFile`, `sessionID` distinctness, and call counts.
- Wrap `Bun.file`/`writeFile` so Phase 4 test cases can inject persist-throws and read-back assertions.
- A thin `coerceJson` re-import: export `coerceJson` from `src/opencode.ts` (Phase 1 may already; if not, export it now).

### Test sections (matrix)

1. **`coerceJson` unit**
   - bare object → unchanged
   - ```` ```json{…}``` ```` → inner object
   - `"I reviewed the draft…\n{…}"` → first `{…}` (the `010a399c` regression)
   - trailing prose after `}` → trimmed
   - nested braces inside strings → not miscounted
   - `<json>…</json>` tag-wrapped → inner
   - backticks **inside** a legitimate string value → not stripped (scenario #20 guard)
2. **Router matrix** (stubbed OpenCode: scripted fault sequences)
   - nooutput → A reprompt same-agent → valid
   - truncated → A continue → valid
   - fence-only → D, **one** `client.session.prompt` total, zero repair events (D resolves free)
   - unescaped quotes → C `json-fixer` → valid; assert `json-fixer` agent passed to stub
   - enum drift (`severity:"critical"`) → **B** same-agent with zod issues in prompt; **assert `json-fixer` was never called**
   - approve-with-findings (`superRefine`) → B; reuses `auditResultSchema` end-to-end
   - budget exhausted (always-throw same fault) → final throw is `StructuredRecoveryError` with `fault` preserved; error message contains `${fault}_unresolved`, not a raw `JSON Parse error`
3. **Transport retry** (Phase 2)
   - `response.error` once → second call ok → asserts exactly 2 `client.session.prompt` calls + run did not crash
   - empty inline + Continue returns error → asserts `Continue` called once and surfaced fault is `transport`, not `nooutput`
4. **Phase 3.5 restart** (`auditWithRestart` with stubbed `promptAgent`)
   - `StructuredRecoveryError(schema)` once → valid on attempt 2 → asserts 2 distinct `createSession`, reused `outputFile`, valid struct
   - Plain `Error("bug")` → asserts exactly 1 `createSession`; error propagated unchanged
   - Always-throw `StructuredRecoveryError`, `maxRestarts:1` → exactly 2 `createSession`; final throw preserves `fault`
   - Design-audit mirror: same as first row against `runDesignAudits`
5. **Persistence** (Phase 4)
   - inline-valid with `outputFile` → after `promptAgent` returns, `Bun.file(outputFile)` exists + parses to same struct
   - persist throws → asserts no bare `{ structured }` returned (escalates or fails cleanly)
   - inline + different valid file → `session.dual_output` in debug-log; returned struct matches the **file**
6. **Non-structured path snapshot**
   - `promptAgent({ schema: undefined })` returns `{ text }` unchanged; zero `session.recovery.*` events
7. **Semantic-no-regression**
   - `tests/schema.test.ts` unchanged in behavior (do not edit it; re-run only)

### Reachability (the Phase-1 spirit-regression guard)

Add one assertion appended to the exhausted-budget case: the escaped error chain originates inside a `catch` block (the test's stub records the *intermediate* `session.recovery.classify` event before the throw), proving the catch path ran. This guards against the `await` bug reappearing in any future branch.

## Execution Checklist

- [ ] Open `tests/json-repair.test.ts`.
- [ ] Export `coerceJson` from `src/opencode.ts` if Phase 1 left it non-exported.
- [ ] Build the OpenCode client stub harness (reuse `opencode-event-bridge.test.ts` pattern) with a call log + scripted responses.
- [ ] Write sections 1–7 per Implementation Details.
- [ ] For each `schema`-fault case, assert `"json-fixer"` never appears in the stub's captured `agent` list.
- [ ] Mirror the Phase 3.5 restart tests against `runDesignAudits` (function exported or indirectly exercised via a small harness).
- [ ] Run `bun test tests/json-repair.test.ts` → all green.
- [ ] Run `bun test` → full suite green; confirm `tests/schema.test.ts`, `tests/runner.test.ts`, `tests/runner.integration.test.ts`, `tests/opencode-event-bridge.test.ts` unchanged.
- [ ] Confirm the `010a399c` regression case (prose-prefix via `coerceJson`) is a named test (`"010a399c regression: prose-prefixed JSON coerces"` or similar) for easy triage.

## Files And Systems Likely Affected

- New: `tests/json-repair.test.ts`.
- Possibly: `src/opencode.ts` (export `coerceJson` if not already).
- Possibly: `tests/opencode-event-bridge.test.ts` (shape alignment, if Phase 2 didn't already).
- No run artifacts; no production code beyond exports.

## Verification

- `bun test tests/json-repair.test.ts` → all matrix cases green.
- `bun test` → full suite green.
- Specifically: `schema`-fault test fails to call `json-fixer` (negative assertion holds).
- Specifically: free-tier (fence-only) test asserts exactly 1 prompt call (D resolves free).
- Specifically: any exhausted-budget final throw is a `StructuredRecoveryError` (type guard holds — the Phase 1 spirit guard).
- Manual spot-check: run `coerceJson('I reviewed the draft.\n```json\n{"vote":"approve","summary":"x","findings":[]}\n```')` in a scratch and confirm the inner object is returned (the `010a399c` repro shape).

## Done Criteria

- `tests/json-repair.test.ts` exists with all 7 sections.
- All matrix cases green; `bun test` full suite green.
- The `schema`-faults-not-`json-fixer` invariant has an explicit failing-built assertion.
- The `010a399c` regression is a named, traceable test.

## Handoff To Next Phase

- **Next phase:** `07-telemetry-systemic-drift-guard.md` (Phase 6).
- **Artifact this phase leaves to the next:** a stable, machine-checked matrix of recoverable behaviors + the event-name vocabulary Phase 5 implicitly relies on (`session.recovery.classify`, `audit.restart_from_scratch`, `session.dual_output`, `session.file_repair`, `session.empty_response`) — Phase 6's detector unit tests will assert these events fire on the right transitions.
- **What becomes unblocked:** Phase 6 telemetry/systemic-drift work with full confidence that the recovery surface behaves as documented.

## Open Questions Or Blockers

- **Inferred:** `auditWithRestart` and `runDesignAudits` are unit-testable without a live OpenCode server by stubbing `promptAgent`. If `auditWithRestart` lives in `src/audit-restart.ts` and imports `promptAgent` directly, stubbing requires module mocking (Bun supports `mock.module`). Confirm the stubbing approach works against the repo's module style before writing the matrix; if problematic, refactor 3.5 to inject `promptAgent` so the wrapper is testable without `mock.module`.
- **Unknown:** whether `runDesignAudits` is directly importable in tests without dragging the whole design-quorum graph (init/telemetry wiring). If import is heavy, mirror the restart test only against `auditWithRestart` directly and rely on `runner.test.ts` for the design-quorum integration.

## Sources

- Existing stub pattern: `tests/opencode-event-bridge.test.ts`.
- Semantic schema rules: `tests/schema.test.ts` + `src/schema.ts` (`superRefine`).
- Plan: Phase 5 (Tests) — scenarios #15, #16, #20, #4, #27, #2, #9, #6.