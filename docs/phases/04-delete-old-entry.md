# Phase 04 — Delete the old entry point

Source plan: `docs/tui-implementation-plan.md` §10 Step 4.

## Execution Snapshot

- Phase: 04 / 09
- Source plan: `docs/tui-implementation-plan.md`
- Readiness: **Blocked** on Phases 02 + 03 (orchestration must already live in `runQuorum` with the real bridge wired in).
- Primary deliverable: `src/index.ts` removed; no production code path relies on it.
- Blocking dependencies: Phase 02 (`runQuorum` exists and is callable), Phase 03 (real bridge wired into `runQuorum`).
- Target measurements: `bunx tsc --noEmit` exits 0; `grep -rn "src/index.ts" .` returns nothing in tracked files; `bun test` still passes.
- Next phase: 05 — TUI shell + `$EDITOR`.

## Why This Phase Exists

`src/index.ts` is the old CLI: arg parsing, JSON status, graph invoke, JSON summary, exit. Once `runQuorum` exists (Phase 02) with the real bridge (Phase 03), nothing in the system needs it. Leaving it in place would tempt new code to import the removed `createTelemetryEnrichment` symbol or to re-couple orchestration to argv parsing. Plan §1, §2, §7 all say "no plain mode"; deleting the file makes that real.

## Start Criteria

- Phase 02 done: `runQuorum` reproduces every behaviour `src/index.ts:99-176` performs (graph invoke, telemetry shutdown, output dir, request id, etc.).
- Phase 03 done: bridge factory inside `runQuorum` is the real `createOpencodeEventBridge`. (Otherwise deleting `src/index.ts` removes the only consumer of the bridge before its replacement is wired.)

## Dependencies And How To Check Them

| Dependency | Why | How to verify | Status |
|---|---|---|---|
| `runQuorum` callable | Replaces every responsibility of `src/index.ts` | `grep -n "export.*runQuorum" src/runner.ts` | Done after Phase 02 |
| Real bridge wired into `runQuorum` | Otherwise deleting `index.ts` breaks the only call site of the bridge | `grep -n "createOpencodeEventBridge" src/runner.ts` | Done after Phase 03 |
| No other importer of `src/index.ts` | Safe to delete | `grep -rn "from .*index['\"]\\|from .*src/index" src/` returns nothing meaningful | Verify during execution |
| `package.json` scripts already point at `src/tui/index.tsx` | No script will break (the file does not exist yet, but the `dev`/`start` scripts will only fail at run time, not at compile time) | `grep -E '"(dev|start)"' package.json` shows `src/tui/index.tsx` after Phase 01 | Done after Phase 01 |

## Target Measurements And Gates

Entry gate: Phases 02 + 03 green.

Exit gates:

- `git rm src/index.ts` produces exactly one removal in `git status`.
- `bunx tsc --noEmit` exit 0. (No remaining importers should reference the deleted file.)
- `bun test` exit 0.
- `grep -rn "src/index" . --include='*.json' --include='*.ts' --include='*.tsx' --include='*.md'` returns no production references (docs may still mention the historical file).

## Scope

- Delete `src/index.ts`.
- Verify no remaining importer in `src/` references it.
- (No other code change.)

## Out Of Scope

- Building the TUI shell (Phase 05) — `bun run dev` will fail until then; that is expected and documented in the handoff.
- Adding any compatibility shim or "minimal CLI". Plan §14 mentions a 20-line shim only as a back-pocket recovery option, not as a normal artifact. **Do not ship it in this phase.**
- Touching `src/runner.ts`, `src/opencode-event-bridge.ts`.

## Implementation Details

- `git rm src/index.ts`.
- Search for any stale import:
  ```
  grep -rn "src/index" src/
  grep -rn "from \"./index\"" src/
  ```
- If `src/runner.ts` imported anything that previously lived only in `src/index.ts` (e.g. local helpers), move them into `src/runner.ts` first or into a shared helper file. (Inferred — based on plan, `src/runner.ts` should be self-contained because it absorbed the orchestration logic from `src/index.ts:99-176`.)
- Confirm `package.json` `dev`/`start` already point at `src/tui/index.tsx` (set in Phase 01). The script will fail at runtime until Phase 05; that is acceptable.

## Execution Checklist

1. Confirm Phase 02 + 03 are merged / green: `bun test src/runner.test.ts src/opencode-event-bridge.test.ts`.
2. `grep -rn "src/index" src/` — if any source imports it, address before deleting.
3. `git rm src/index.ts`.
4. `bunx tsc --noEmit` — fix any dangling reference (likely none).
5. `bun test` — confirm green.
6. Sanity check: `bun run typecheck` exits 0.
7. (Skip) `bun run dev` — will fail until Phase 05; not part of this phase's verification.

## Files And Systems Likely Affected

- `src/index.ts` (deleted)
- Possibly `src/runner.ts` if a helper moves over (Inferred, only if needed).

## Verification

- `git status` shows exactly one deleted file (`src/index.ts`) plus, at most, the helper move noted above.
- `bunx tsc --noEmit` exit 0.
- `bun test` exit 0.
- `grep -rn "createTelemetryEnrichment\\|telemetry-enrichment" src/` empty (regression check from Phase 03 still holds).
- `grep -rn "src/index" src/` empty.

## Done Criteria

- `src/index.ts` no longer exists in the repo.
- TS typecheck and tests pass.
- No production code references the deleted file.
- The TUI entry script in `package.json` continues to point at `src/tui/index.tsx`.

## Handoff To Next Phase

- Next phase: **05 — TUI shell and `$EDITOR`** (`docs/phases/05-tui-shell-and-editor.md`).
- What it depends on from this phase: a clean tree where the only entry point left to write is `src/tui/index.tsx` and there is no temptation to add new logic into the deleted CLI.
- Becomes unblocked: Phase 05 can ship `src/tui/index.tsx` as the sole entry; Phases 06–09 can build their pieces on top.

## Open Questions Or Blockers

- If executor decided in Phase 03 (Open Question) to delete `src/index.ts` early, this phase becomes a no-op and only the verification checklist needs to run. Document that explicitly in the PR.

## Sources

- `docs/tui-implementation-plan.md` §10 Step 4, §1, §7, §14.
- `src/index.ts:9-179` — the file being deleted; orchestration already moved to `runQuorum` in Phase 02.
