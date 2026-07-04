# Phase 4 — Persistence + Inline-When-File Fixup

## Execution Snapshot

- **Phase:** 4
- **Source plan:** RecoveryRouter plan, Phase 4
- **Readiness status:** `Ready` once Phase 3 merges (Phase 3.5 not strictly required).
- **Primary deliverable:** When `wantFile && source==inline && parsed OK`, persist the parsed struct to `outputFile` before returning so downstream file-readers see it; log a `session.dual_output` event when both inline and file existed and disagreed.
- **Blocking dependencies:** Phase 3 (`promptAgent`'s final parse path + `StructuredRecoveryError` contract) — `Unknown` until Phase 3 merges.
- **Target measurements:** Inline-valid-with-`outputFile` persists in 100% of cases (no "valid struct but missing file" outcomes).
- **Next phase:** `06-tests.md` (Phase 5).

## Why This Phase Exists

Today, when an agent is **asked** to write to `outputFile` but returns a valid JSON **inline** instead, the code silently prefers+returns the parsed inline struct and leaves no file on disk. Downstream code that reads back artifacts (`latest-draft.md`, the TUI view, `persistAuditsArtifact`, multi-round auditors' `auditsFile`) can diverge from the in-memory struct — a silent consistency hazard (scenario #2, #9).

Phase 4 closes the loop: an inline-valid response with a desired `outputFile` is written to that file (**before** returning success), so any later file-read sees the same content that the caller already parsed.

## Start Criteria

- Phase 3 merged: the unified recovery loop reaches the parse-OK success return; `bun test` green.
- `writeRunJsonArtifact` exists and is the canonical "write JSON artifact to run dir" helper (Confirmed — used in `design-quorum.ts`).
- `promptAgent` returns `{ text, structured, model, provider }` (Confirmed current envelope).

## Dependencies And How To Check Them

| Dependency | Why it matters | How to verify | Status |
|---|---|---|---|
| Phase 3 deliverables | The persistence hook is wired into the parse-OK return path inside the Phase-3 loop | `grep -n "StructuredRecoveryError" src/opencode.ts` returns hits; loop present | `Unknown` (gated by Phase 3) |
| `writeRunJsonArtifact` helper | Phase 4 ought to reuse it for on-disk JSON writes (consistent with callers) | `grep -n "writeRunJsonArtifact\|writeRunTextArtifact" src/*.ts` | `Done` (Confirmed in `design-quorum.ts`) |
| Parse-OK success return path is reachable for inline+wantFile | The hook needs to live on that exact branch | Read the Phase-3 loop's success branch | `Unknown` (depends on Phase 3 shape) |
| `outputFile` derived dir is guaranteed to exist | Writing to a non-existent dir fails | `writeRunJsonArtifact` already mkdirs; or the caller pre-creates `runs/<rid>` (Confirmed pattern) | `Done` |

## Target Measurements And Gates

| Measurement | Threshold | Method | Gate | Status |
|---|---|---|---|---|
| Inline-valid persists-then-returns | 100% of inline+wantFile+parse-OK cases end with `outputFile` containing the parsed struct | Stubbed client returns valid inline JSON with `outputFile` set; assert `Bun.file(outputFile)` exists + parses to the same struct after `promptAgent` returns | Exit | `Unknown` |
| Persist failure does NOT silently succeed | A persist error surfaces as an `nooutput`/transport fault, not a silent OK | Stub `writeFile` to throw; assert `promptAgent` does not return a bare `{structured}` without the file; the run escalates (A reprompt: "write the file you were asked to") or fails cleanly | Exit | `Unknown` |
| Dual-output disambiguation logged | When both inline and file exist and differ, `session.dual_output` is in the debug log | Stub returns valid inline + writes a *different* valid file; assert `debug-log` contains `session.dual_output` and the persisted file is the inline struct (preferred per current "file-first" but with explicit override) — OR the file content is preferred and inline is logged. Decide the resolution in Implementation Details. | Exit | `Unknown` |

## Scope

- `src/opencode.ts`:
  - On the parse-OK branch when `input.outputFile` is set AND source was inline (i.e., `readOutputFile.ok === false` or no file was read), write the parsed struct to `outputFile` (via `writeRunJsonArtifact`-equivalent, or a direct `Bun.write` of `JSON.stringify(structured, null, 2)` if re-importing the helper is awkward — prefer the shared helper for dir-creation consistency).
  - If the persist throws, treat as `transport`/`nooutput` fault and re-prompt the same agent to write the file explicitly (A branch) rather than returning a phantom success.
  - Add an optional `session.dual_output` debug-log event when *both* inline and file existed and the parsed values differ (log `agent`, `sessionID`, `requestId`, `round` if available); decide resolution rule below.

## Out Of Scope

- Changing the "file-first vs inline-first" preference for the *parsing* path (Phase 3 owns that decision; Phase 4 only persists the chosen outcome).
- Persisting non-JSON outputs (markdown drafts already write their own files directly — they are text, not structured).
- Telemetry new top-level counters (Phase 6 owns the systemic-drift detector); Phase 4 only emits a single `session.dual_output` debug-log line.

## Implementation Details

### Where to wire the hook

After the Phase-3 loop's `return await parseAndReturn(...)` succeeds, intercept the success and inspect:

```
if (input.outputFile && source === "inline") {
  const parsed = result.structured   // the value parsed on this attempt
  try {
    await writeRunJsonArtifact(dirname(input.outputFile), basename(input.outputFile), parsed)
  } catch (persistErr) {
    // do NOT return a phantom success
    // re-enter the loop with kind="nooutput": "Write the file you were asked to: <outputFile>"
    // i.e., hand off to the A-branch reprompt
  }
}
```

Prefer reusing `writeRunJsonArtifact` so the dir-creation + JSON formatting matches every other caller. If importing it from a utilities module would create a cycle, define a local tiny writer (`Bun.write(outputFile, JSON.stringify(parsed, null, 2) + "\n")`), making sure `runs/<rid>` already exists (it does — caller pre-created).

### `session.dual_output` event

When `read.ok === true` AND a non-empty inline `response.text` exists AND `JSON.parse(coerceJson(inline)) !== fileContentParsed` (cheap deep-equality of the parsed values), emit:

```
debugLog.write("session.dual_output", { agent, sessionID, requestId, round, diverged: true })
```

### Resolution rule when inline and file both valid but differ

**Decision:** prefer the **file** content for the returned struct (matches today's behavior, no surprise), but persist **nothing** (the file is already canonical) and log `session.dual_output` for triage. This avoids overwriting the agent's own chosen artifact while still flagging the divergence. If a future requirement prefers inline-to-file (e.g., inline is newer), flip here — but flag in `Open Questions`.

## Execution Checklist

- [ ] In `promptAgent`'s parse-OK path, add: when `input.outputFile` set and source was inline, write `structured` to `outputFile` before returning.
- [ ] On persist failure, do not return phantom success — re-prompt same agent (A branch, `kind: "nooutput"`, "write the file `<outputFile>`") or, if no budget remains, throw `StructuredRecoveryError("transport" or "nooutput", …)` so Phase 3.5 can restart.
- [ ] Add `session.dual_output` debug-log emission when both inline + file valid but differ; resolution rule = prefer file.
- [ ] `bunx tsc --noEmit` clean; `bun test` green (formal persistence tests land in Phase 5).

## Files And Systems Likely Affected

- `src/opencode.ts` — persistence hook + dual-output log on the parse-OK path.
- Possibly import `writeRunJsonArtifact` from where it lives (audit the helper's module to avoid cycles).
- Run artifacts: `outputFile` now reliably exists for every structured success; no new filenames.

## Verification

- `bunx tsc --noEmit` clean; `bun test` green.
- Manual (formal Phase 5):
  - Stub returns valid inline JSON with `outputFile` set; after `promptAgent` returns, assert `Bun.file(outputFile)` exists and parses to the same struct.
  - Stub persist-throws; assert `promptAgent` does not return a bare `{ structured }` (instead escalates per A-branch or fails cleanly).
  - Stub valid inline + different valid file; assert `debug-log` contains `session.dual_output` and the returned struct parses the **file** content.
- End-to-end: rerun the `010a399c` topic; the audit files (`audit-*-round-0.json`) all exist on disk after the run (no missing-file artifacts), proving persistence closes the inline-when-file gap.

## Done Criteria

- Inline-valid + `outputFile` success always persists to disk before returning.
- Persist failure escalates (no silent phantom success).
- `session.dual_output` emitted on divergent inline-vs-file; file preferred.
- `bunx tsc --noEmit` + `bun test` clean.

## Handoff To Next Phase

- **Next phase:** `06-tests.md` (Phase 5) formalizes all the manual matrices from Phases 1–4 into a `tests/json-repair.test.ts` matrix.
- **Artifact this phase leaves to the next:** the full set of recoverable behaviors (D/A/B/C tiers, R-tier for auditors, persistence + dual-output logging) is code-complete, so Phase 5 can write end-to-end matrix tests against a stable surface.
- **What becomes unblocked:** Phase 6 telemetry/systemic-drift detectors can key off the now-standard `session.recovery.*` + `audit.restart_from_scratch` + `session.dual_output` events.

## Open Questions Or Blockers

- **Inferred (must confirm at execution):** which module owns `writeRunJsonArtifact`. If importing it into `src/opencode.ts` causes a cycle, fall back to a local `Bun.write` of `JSON.stringify + "\n"` (the `runs/<rid>` dir is guaranteed pre-created by the caller). Confirm before wiring.
- **Debatable:** when inline+file diverge, current decision = prefer file. If the team has a strong reason to prefer inline-as-truth, flip and document; otherwise stay file-canonical.
- None else.

## Sources

- `src/opencode.ts`: current parse-OK return paths (file-first preferred today); `readOutputFile`.
- `src/design-quorum.ts`: `writeRunJsonArtifact` usage pattern (the canonical "write JSON artifact to run dir" helper).
- Plan: Phase 4 (persistence + inline-when-file fixup), scenarios #2, #9.