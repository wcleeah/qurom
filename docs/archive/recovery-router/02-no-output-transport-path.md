# Phase 2 — Fix the No-Output / Transport Path

## Execution Snapshot

- **Phase:** 2
- **Source plan:** RecoveryRouter plan, Phase 2
- **Readiness status:** `Ready`
- **Primary deliverable:** Distinguish "file not written" / "empty" / "unreadable" / "transport error"; give `sendPrompt` bounded transport retry instead of immediate throw; stop silently swallowing the `Continue` retry's own errors.
- **Blocking dependencies:** Phase 1 (`await` fix + `coerceJson`) — `Done`.
- **Target measurements:** Transport retry bounded at 2; no swallowed continue-retry errors.
- **Next phase:** `03-recovery-router.md`

## Why This Phase Exists

Today `readOutputFile` conflates three distinct causes into one `undefined`:

- **File not written at all** (agent never wrote — scenario #1, #7).
- **Empty file** (agent wrote nothing meaningful — scenario #5).
- **Unreadable / write in flight / permission denied** (scenarios #31, #32).

And `sendPrompt` makes two transport mistakes:

- **`response.error`** or **missing `response.data`** throws immediately with no retry (scenario #27).
- The empty-text **`Continue` retry** is one-shot, **swallows `continueResponse.error` silently** (so a transport error on the continue looks like a successful-but-empty result), and never escalates (scenarios #5, #28).

Without Phase 2, Phase 3's router cannot tell `nooutput` from `transport` from `syntax` — it would all look like one bin (and route wrong). Phase 2 is what makes the router's classifier able to trust its inputs.

## Start Criteria

- Phase 1 lands: `coerceJson` exists, both `return await parseAndReturn(...)` edits present, `bun test` green.
- `readOutputFile` in `src/opencode.ts` is still `Promise<string | undefined>` (confirm before editing).
- `sendPrompt`'s empty-retry block still has `if (continueResponse.data && !continueResponse.error)` (swallows error), and is still a single retry (no loop).

## Dependencies And How To Check Them

| Dependency | Why it matters | How to verify | Status |
|---|---|---|---|
| Phase 1 `await` fix | Phase 2 edits live in `promptAgent` near the parse sites; need Phase 1's reachable-catch base so behavior changes are observable | `grep -n "return await parseAndReturn" src/opencode.ts` returns two hits | `Unknown` (will be `Done` once Phase 1 merges — check at execution time) |
| Phase 1 `coerceJson` exists | Even though this phase doesn't touch parsing, the codebase base is post-Phase-1 | `grep -n "function coerceJson" src/opencode.ts` returns a hit | `Unknown` (same gating as above) |
| `readOutputFile` signature is `string \| undefined` | The discriminated-union rewrite depends on this being the current shape | `grep -n "async function readOutputFile" src/opencode.ts` + read its body | `Done` (Confirmed current shape) |
| `assistantInfoSchema` casts `response.data.info` | Phase 2 must surface `info.error` categorization cleanly; confirm it already exists | `grep -n "assistantInfoSchema" src/opencode.ts` | `Done` |
| Telemetry `endObservation` exists for error paths | Phase 2 must keep emitting observations on the new failure modes | `grep -n "endObservation" src/telemetry.ts` | `Done` |

## Target Measurements And Gates

| Measurement | Threshold | Method | Gate | Status |
|---|---|---|---|---|
| Transport retry attempts | ≤ 2 (initial + 1 retry) before throwing | Stubbed OpenCode client returning `response.error` once, ok on second; assert exactly 2 `client.session.prompt` calls + run ended without `failure.json` if a real caller exercises it (Phase 5 covers this formally) | Exit | `Unknown` |
| `Continue` empty-retry loop bound | ≤ 2 `Continue` calls, stops on first continue that returns an error (no silent swallow) | Unit test (Phase 5): stub inline empty then continue-error; assert `Continue` called once and the surfaced fault is `transport`, not `nooutput` HTMLElement-clean | Exit | `Unknown` |

## Scope

- `src/opencode.ts`:
  - Replace `readOutputFile(): Promise<string \| undefined>` with `readOutputFile(): Promise<{ ok: true; text: string } | { ok: false; reason: "missing" \| "empty" \| "unreadable"; err?: string }>`.
  - In `sendPrompt`: loop `Continue` up to 2× only while prior continue was error-free; if any continue returns `response.error` or has no `data`, stop and surface `transport` to the caller (return a discriminated signal or throw a typed error — see Implementation Details).
  - Wrap the outer `client.session.prompt` in a 2-attempt backoff retry on `response.error` / missing `data` (exponential-ish or fixed 200ms is fine); on final failure throw a `transport`-classified error.
  - Update the two `parseAndReturn`-adjacent branch sites to consume the new `readOutputFile` shape (file-branch only when `ok`; fall to inline / `nooutput` otherwise). **Do NOT** rewrite the catch logic — that is Phase 3 — just thread the new `reason` so Phase 3 has it.

## Out Of Scope

- `RecoveryRouter` classification / `repairWithJsonFixer` / same-agent `reprompt` (Phase 3).
- Persisting inline→file (Phase 4).
- Telemetry new events (Phase 6) — but keep emitting existing observations on every error path so we don't regress observability.
- Changing `promptAgent`'s public signature/type. The new typed-error seam (`StructuredRecoveryError`) lands in Phase 3; Phase 2 may throw plain `Error`s with a machine-readable prefix, to be replaced by the typed class in Phase 3.

## Implementation Details

### `readOutputFile` discriminated union

```
const file = Bun.file(input.outputFile)
if (!(await file.exists())) return { ok: false, reason: "missing" }
const content = await file.text()
if (!content.trim()) return { ok: false, reason: "empty" }
// optional: a tiny read-stabilization retry for race-on-read (scenario #31)
return { ok: true, text: content }
```

"unreadable" branch is reserved for a Bun read that throws (wrap in try/catch, return `reason: "unreadable", err: e.message`).

### `Continue` retry hardening

Current (paraphrased):

```
if (!finalText.trim()) {
  const r = await client.session.prompt({...Continue...})
  if (r.data && !r.error) finalText = extractText(r.data.parts)
}
```

Rewrite to:

```
let continueAttempts = 0
while (!finalText.trim() && continueAttempts < 2) {
  continueAttempts++
  const r = await client.session.prompt({...Continue...})
  if (r.error || !r.data) {
    // DO NOT swallow — this is a transport fault, not just empty
    throw new Error(`transport.continue_failed: ${JSON.stringify(r.error ?? "no data")}`)
  }
  finalText = extractText(r.data.parts)
}
```

The thrown string `transport.*` prefix is a temporary seam — Phase 3 replaces it with `StructuredRecoveryError({ fault: "transport" })`.

### Outer transport retry

Wrap the initial `client.session.prompt({...})` similarly: on `response.error` / no `data`, retry once after a short backoff; on second failure, throw `transport.prompt_failed: <error>`. Keep existing `endObservation(... ERROR ...)` calls on each failure path.

### Thread into the branches

Update the file-branch precondition:

```
const read = await readOutputFile()
if (read.ok) { fileContent = read.text }
else { fileContent = undefined; remember read.reason for Phase 3 }
```

Leave the actual catch behavior intact — Phase 3 will consume `read.reason` via closure or refactor it into the router.

## Execution Checklist

- [ ] Change `readOutputFile` return type to the discriminated union; implement missing / empty / unreadable branches.
- [ ] Replace `if (continueResponse.data && !continueResponse.error)` with the bounded `while` loop above; throw `transport.continue_failed` on continue-error (Phase 3 retypes this).
- [ ] Add 2-attempt retry with backoff around the initial `client.session.prompt` in `sendPrompt`; on final failure throw `transport.prompt_failed` and keep the existing `endObservation(ERROR)`.
- [ ] Update the file-branch precondition site to consume `{ ok, reason, text }`; pass `reason` forward (closure or local var) so Phase 3 can see it. Leave the existing catch bodies untouched.
- [ ] Keep every existing `endObservation` call so telemetry is not regressed.
- [ ] `bunx tsc --noEmit` clean.
- [ ] `bun test` green (formal new tests land in Phase 5).

## Files And Systems Likely Affected

- `src/opencode.ts` (`readOutputFile`, `sendPrompt` empty-retry, `sendPrompt` outer transport retry, file-branch precondition).
- Touches nothing in callers; `promptAgent`'s external shape unchanged (still throws plain `Error` until Phase 3 retypes it).
- Run artifacts: no path/name changes.

## Verification

- `bunx tsc --noEmit` clean.
- `bun test` green; specifically `opencode-event-bridge.test.ts` (which stubs the OpenCode client) must still pass — confirm the stub harness is compatible with the new conjunctive `response.error` handling. If a stub returns `{ error: undefined, data: undefined }`, the new code path may now throw where it didn't before; adjust the stub to the documented contract (`error` XOR `data`).
- Manual: introduce a scratch stub where `response.error` is set once then clears; assert the `sendPrompt` outer retry consumed exactly 2 prompt calls before throwing (print counts; formal test is Phase 5).
- Manual: introduce a stub where the first prompt returns empty text and the follow-up Continue returns `response.error`; assert the throw message starts with `transport.continue_failed` (proves no silent swallow).
- Confirmed no regression: the existing happy path (file written + valid) returns the same `{ text, structured, model, provider }` envelope.

## Done Criteria

- `readOutputFile` returns the discriminated union; no caller still reads it as `string | undefined`.
- `Continue` retry is bounded at 2 attempts; any Continue `response.error` triggers a throw with a `transport.continue_failed`-prefixed message.
- Outer `client.session.prompt` retries once on transport error and throws `transport.prompt_failed` on second failure.
- `bunx tsc --noEmit` clean; `bun test` green.
- Every error path still emits the prior observation (no telemetry regression).

## Handoff To Next Phase

- **Next phase:** `03-recovery-router.md`.
- **Artifact this phase leaves to the next:** `readOutputFile.reason` and `transport.*`-prefixed error strings are the raw inputs the Phase 3 classifier will consume to decide between `nooutput` / `truncated` / `syntax` / `schema` / `transport`.
- **What becomes unblocked:** Phase 3 can write a real classifier whose inputs are categorized; the router can re-prompt the same agent with `kind: "nooutput"` / `"truncated"` / `"transport"` distinctly.

## Open Questions Or Blockers

- **Confirmed / Inferred:** The OpenCode SDK's transport failures are surfaced as `response.error` (an object) and/or `!response.data` — `Inferred` from current `sendPrompt` code that already checks both. If the SDK exposes a richer `finishReason`/stop-cause, truncation (scenario #6) could be auto-detected instead of inferred from a malformed payload — Phase 3's `truncated` classifier will infer today; flag for Phase 3 to verify against the SDK types (`@opencode-ai/sdk/v2`) before finalizing `classifyFault`.
- Assumption: a per-call backoff of ~200ms is acceptable (no SLO defined). If opencode has a stricter latency contract, raise this; otherwise default to 200ms.

## Sources

- `src/opencode.ts`: `readOutputFile` (~line 318), `sendPrompt` empty-retry (~line 281), `sendPrompt` transport handling (~lines 255–275).
- `src/telemetry.ts`: `endObservation` used for `ERROR` paths.
- Plan: Phase 2 (no-output/transport path), scenarios #1, #5, #7, #27, #28, #31, #32.