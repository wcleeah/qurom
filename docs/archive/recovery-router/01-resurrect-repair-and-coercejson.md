# Phase 1 — Resurrect Repair Branches + Add Free `coerceJson` Pre-clean

## Execution Snapshot

- **Phase:** 1
- **Source plan:** RecoveryRouter plan, Phase 1
- **Readiness status:** `Ready`
- **Primary deliverable:** Dead `try/catch` repair branches become reachable; prose-prefixed / fenced / trailing-prose JSON is parsed for free with no LLM call.
- **Blocking dependencies:** None (first phase).
- **Target measurements:** None (correctness only).
- **Next phase:** `02-no-output-transport-path.md`

## Why This Phase Exists

The latest run died at `runs/highlighting-text-in-html-across-010a399c…/failure.json` with:

> `Structured response from inline response from agent source-auditor could not be parsed: JSON Parse error: Unexpected identifier "I"`

The source-auditor emitted inline prose starting with `I` before the JSON. Two real bugs:

1. **Hard bug (disables all repair):** the file branch (`src/opencode.ts` ~line 432) and inline branch (~line 470) use `return parseAndReturn(...)` **without `await`**. `parseAndReturn` is `async` and throws inside its own `catch` → the rejection skips the surrounding `try/catch` and crashes the run. Verified empirically: `no-await: leaked to outer` vs `with-await: caught`.
2. **Brittleness:** `parseStructuredResponse` does strict `JSON.parse(text)` with no extraction, so fences / leading prose / trailing notes all fail and (once repair is alive) cascade into an LLM round-trip unnecessarily.

Phase 1 alone fixes the reported crash class with zero new infra.

## Start Criteria

- Repo builds: `bunx tsc --noEmit` clean (baseline).
- `bun test` passes (baseline).
- The run artifact from the failure above is present for a post-fix regression reproduction: `runs/highlighting-text-in-html-across-010a399c-c5a0-40f7-aa35-91a34dd451b0/failure.json`.

## Dependencies And How To Check Them

| Dependency | Why it matters | How to verify | Status |
|---|---|---|---|
| `parseAndReturn` is `async` in `src/opencode.ts` | The `await` fix is only meaningful if rejection actually propagates as a thenable | `grep -n "async function parseAndReturn" src/opencode.ts` | `Done` (Confirmed: ~line 415) |
| Two `return parseAndReturn(...)` call sites without `await` | Confirms the dead-catch bug is present and is the change target | `grep -n "return parseAndReturn" src/opencode.ts` returns two hits, neither prefixed with `await` | `Done` |
| No `coerceJson` helper exists yet | Confirms the add is net-new | `grep -rn "coerceJson" src/` returns nothing | `Done` |
| `parseStructuredResponse` uses raw `JSON.parse` | Confirms the coerced-parse edit target | `grep -n "JSON.parse" src/opencode.ts` | `Done` |

## Target Measurements And Gates

| Measurement | Threshold | Method | Gate | Status |
|---|---|---|---|---|
| None | — | — | — | This phase is correctness-only |

## Scope

- `src/opencode.ts`:
  - Add `coerceJson(text)` helper (fence-strip, tag-strip, balanced `{}`/`[]` slice from the first opener, **string-aware** so backticks/quotes inside string values are never stripped).
  - Replace `JSON.parse(text)` with `JSON.parse(coerceJson(text))` inside `parseStructuredResponse`.
  - Add `await` at both `return parseAndReturn(...)` sites.

## Out Of Scope

- Router classification (Phase 3).
- Transport / empty-response / no-output handling (Phase 2) — leave the existing one-shot `Continue` retry as-is even though it swallows errors.
- New tests for `coerceJson` (those land in Phase 5, but a tiny inline sanity check during this phase is fine).
- Inline-when-file persistence (Phase 4).
- Any change to callers (`graph.ts`, `design-quorum.ts`, `summarizer.ts`) — `promptAgent`'s contract is unchanged.

## Implementation Details

### `coerceJson` (string-aware balance)

Algorithm (failure scenario #15/#16/#19/#22/#23/#24):

1. `t = text.trim()`.
2. Strip a single leading ```` ```json ```` / ```` ``` ```` fence and a single trailing ```` ``` ```` if present.
3. Strip a single leading `<json>…</json>` / `<output>…</output>` tag wrap.
4. Find the first `{` or `[`. If none, return `t` (let `JSON.parse` fail naturally with a real error).
5. Walk from that opener with a string-aware counter (`inStr`, `esc` toggling on `\`), incrementing on the matching opener, decrementing on the matching closer. Stop when depth hits 0 → that index is `end`.
6. If `end === -1` (truncated / no balance), return `t` unchanged (do **not** invent a slice; Phase 3 routes truncation to the same agent).
7. Return `t.slice(start, end + 1)`.

**Critical correctness rule (scenario #20):** backtick-stripping MUST only run when a fence wraps the *whole* payload. Never strip backticks mid-string. The string-aware brace walker prevents mid-string fences from corrupting the slice.

### `await` insertion

Two sites in `promptAgent`:

- File branch (~line 432): `return await parseAndReturn(input.schema, fileContent, \`from file ${input.outputFile}\`)`.
- Inline branch (~line 470): `return await parseAndReturn(input.schema, initialResponse.text, "from inline response")`.

No other change to either branch in this phase. The dead repair code inside the catches now becomes reachable, but its correctness is not part of Phase 1 — it is replaced wholesale in Phase 3.

## Execution Checklist

- [ ] Add `coerceJson(text: string): string` to `src/opencode.ts` (string-aware, per algorithm above).
- [ ] In `parseStructuredResponse`, use `JSON.parse(coerceJson(text))`.
- [ ] At file-branch parse site: prefix `parseAndReturn(...)` call with `await`.
- [ ] At inline-branch parse site: prefix `parseAndReturn(...)` call with `await`.
- [ ] Run `bunx tsc --noEmit` → clean.
- [ ] Run `bun test` → existing tests still green (no regressions).
- [ ] Smoke: confirm `coerceJson('I reviewed the draft.\n```json\n{"vote":"approve","summary":"x","findings":[]}\n```')` returns `'{"vote":"approve","summary":"x","findings":[]}'` (a 2-line scratch script is fine; the formal test belongs to Phase 5).

## Files And Systems Likely Affected

- `src/opencode.ts` (`coerceJson` new; `parseStructuredResponse` edit; two `return await` edits).
- No caller files; no schema files; no telemetry files.
- No run artifacts change (the same run rerun will produce different behavior, but artifact filenames/paths are unchanged).

## Verification

- `bunx tsc --noEmit` → no new type errors.
- `bun test` → all suites green; `schema.test.ts`, `runner.test.ts`, `opencode-event-bridge.test.ts` unchanged.
- Inline smoke (above) for the `010a399c`-shaped prose-prefix input.
- **Regression proof the catch path is now reached:** temporarily inject a guaranteed-bad schema reply in a throwaway test or scratch script and confirm the error message that escapes is the one from inside the `catch` (`"remained invalid after repair"` for the existing inline branch, or `"…could not be parsed…"` rethrown by `parseAndReturn`) — proves the catch ran, not the prior dead-catch leak. (The catch will be rewritten in Phase 3; this check only validates that Phase 1's `await` makes it reachable.)
- Optional live repro (if opencode is running): re-run the `010a399c` topic and expect a clean parse with **no `failure.json`**, debug-log shows no `session.*_repair` (because `coerceJson` resolves it without a repair round-trip). If opencode is not available in this environment, defer this step to the Phase-6 end-to-end verification and rely on the smoke above.

## Done Criteria

- `coerceJson` exists in `src/opencode.ts` and is used inside `parseStructuredResponse`.
- Both `return parseAndReturn(...)` sites are `return await parseAndReturn(...)`.
- `bunx tsc --noEmit` clean.
- `bun test` green.
- The prose-prefix smoke (`I reviewed the draft…{…}`) coerces to the inner object.

## Handoff To Next Phase

- **Next phase:** `02-no-output-transport-path.md`.
- **Artifact this phase leaves to the next:** reachable `try/catch` repair branches (currently invoking `json-fixer` for files and same-agent retry for inline). Phase 2 does **not** touch the catch branches either (those are replaced in Phase 3), but it fixes `sendPrompt`/`readOutputFile` so that when Phase 3 rewrites the catches it sees clean, categorizable outputs instead of `undefined`-everywhere ambiguity.
- **What becomes unblocked:** the bug "agent fails to write `#1` looks like a JSON parse failure" becomes fixable in Phase 2; Phase 3's router can then classify `nooutput`/`truncated`/`transport` distinctly.

## Open Questions Or Blockers

- None. All Phase 1 dependencies are `Done` from current repo evidence.

## Sources

- `runs/highlighting-text-in-html-across-010a399c…/failure.json` + `debug-log.jsonl` — the crash and its stack (`parseAndReturn` → `promptAgent`, no repair frame = dead catch).
- `src/opencode.ts`: `parseStructuredResponse` (~line 78), `parseAndReturn` (async, ~line 415), file branch (~432), inline branch (~470).
- `return`/`return await` semantics — verified empirically on this host during planning (`no-await: leaked to outer`).
- Plan: Phase 1 (resurrect repair + free pre-clean), scenarios #15/#16/#19/#20/#22/#23/#24.