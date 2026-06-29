# Phase 3 — Surface the profile in the view-server and TUI

## Execution Snapshot

- **Phase:** 3
- **Source plan:** `docs/plan/reader-discovery/README.md` (Phase 3 section, "Where the chat lives", UI sketch)
- **Readiness status:** `Ready` once Phase 1 merges (gated on `reader-profile.json` existing + `state.readerProfile`/`state.learningGoal` being populated). Marked `Unknown` until Phase 1 lands. **Can run in parallel with Phase 2** — Phase 3 reads the profile artifact/state that Phase 1 produces; it does not depend on Phase 2's prompt injection.
- **Primary deliverable:** A Reader-profile card on the view-server run page (per-concept table + learning goal), a `discoverReader` row in the live pipeline, a `summarizeNodeState` case for `discoverReader`, and a one-line TUI badge. These repurpose the exact slots the depth-tier system vacated (commit `2224a41`).
- **Blocking dependencies:** Phase 1 — `reader-profile.json` + `state.readerProfile`/`state.learningGoal` must exist.
- **Target measurements summary:** (1) view-server run page shows the Reader-profile card; (2) live pipeline shows the `discoverReader` step; (3) TUI shows the badge; (4) `bunx tsc --noEmit` clean + `bun test` green.
- **Next phase:** `04-adaptive-interview-upgrades.md` (Phase 4 — optional).

## Why This Phase Exists

Phase 1 writes `reader-profile.json` and sets state, but nothing surfaces it to the user beyond the interview chat card. Post-hoc triage (and simple curiosity about why a draft came out the way it did) requires the profile to be visible on the run page, in the live pipeline, and as a TUI badge. This phase reuses the surfacing slots the depth-tier system occupied before commit `2224a41` removed it — the same shapes, different artifact.

## Start Criteria

- Phase 1 merged: `reader-profile.json` is written; `state.readerProfile`/`state.learningGoal`/`state.interviewTranscript` are on `ResearchState`.
- `bunx tsc --noEmit` clean; `bun test` green.

## Dependencies And How To Check Them

| Dependency | Why it matters | How to verify | Status |
|---|---|---|---|
| `reader-profile.json` written by `discoverReader` | The view-server card reads this file | Run a Phase 1 topic-mode run; `ls runs/<rid>/reader-profile.json` | `Unknown` (gated by Phase 1) |
| `state.readerProfile`/`state.learningGoal` on `ResearchState` | `summarizeNodeState` reads them from the node-end state | `grep -n "readerProfile\|learningGoal" src/schema.ts` | `Unknown` (gated by Phase 1) |
| The depth-tier surfacing slots were removed (slots are vacant) | Phase 3 repurposes them | `git show 2224a41 -- src/view-server.ts src/live-status.ts src/tui/components/Dashboard.tsx` shows the removed `depth-tier.json` read block, `summarizeNodeState` `classifyComplexity` case, and `depth:` badge | `Done` (Confirmed — the removal is in `2224a41`) |
| View-server card dispatcher exists | The Reader-profile card hooks the same dispatcher as `renderRequestCard` | `src/view-server.ts:535` (`if (filename === "request.json") return renderRequestCard(data)`) | `Done` |
| `summarizeNodeState` exists and dispatches by node name | The `discoverReader` case slots in here | `src/live-status.ts:285` (`function summarizeNodeState`) | `Done` |

## Target Measurements And Gates

| Measurement | Threshold | Method | Gate | Status |
|---|---|---|---|---|
| Reader-profile card visible | The run page renders the card with the per-concept table + learning goal when `reader-profile.json` exists | Manual: open the view URL after a Phase 1 run; confirm the card | Exit | `Unknown` |
| Live pipeline shows `discoverReader` | The pipeline row appears and shows progress during the interview | Manual: open the view URL during a run; confirm the row | Exit | `Unknown` |
| TUI badge shows | The running screen shows a `reader: {N concepts} · {goal snippet}` line | Manual: during a run, confirm the badge | Exit | `Unknown` |
| Type-check clean | `bunx tsc --noEmit` exit 0 | Run the command | Exit | `Unknown` |
| Test suite green | `bun test` 0 fail | Run the command | Exit | `Unknown` |

## Scope

- `src/view-server.ts`: new `renderReaderProfileCard` (mirror `renderRequestCard` at `:308`), dispatched on `filename === "reader-profile.json"` in the card dispatcher (`:535`). Repurpose the removed `depth-tier.json` read block slot to read `reader-profile.json` for a header label. Add a `discoverReader` row to the live pipeline (repurpose the removed `classifyComplexity` row slot).
- `src/live-status.ts`: repurpose the removed `summarizeNodeState` `classifyComplexity` case — `if (node === "discoverReader") return { concepts: s.readerProfile?.length, goal: s.learningGoal }`.
- `src/tui/components/Dashboard.tsx`: repurpose the removed `depth:` badge slot — a one-line `reader: {N concepts} · {goal snippet}` badge.

## Out Of Scope

- The interview *chat* card — that is Phase 1 (the interactive `awaitingReaderReply` card). Phase 3's card is the *static profile* card shown after the interview completes.
- Any change to the profile schema or the interview loop — Phase 1 owns those.
- Threading the profile to auditors — Phase 2.

## Implementation Details

### `renderReaderProfileCard` (`src/view-server.ts`)

Mirror `renderRequestCard` (`:308`): read `reader-profile.json` (already parsed by the card dispatcher's file-load path), render a `<table class="summary-table">` with rows for the learning goal + one row per concept (`concept`, `level`, optional `evidence`). Card title: `📋 Reader profile`. Dispatch: add `if (filename === "reader-profile.json") return renderReaderProfileCard(data)` to the dispatcher at `:535`.

### Header label (repurpose the removed depth-tier block)

The removed `depth-tier.json` read block (in `renderRun`, pre-`2224a41`) computed a header label. Repurpose it to read `reader-profile.json`: `reader: {N concepts} · {goal snippet}`. This is a small read + string format, same shape as the removed code.

### Live pipeline row (`renderLivePipeline`)

Add a `nodeRow(...)` for `discoverReader` at the position `classifyComplexity` occupied (between `prepareOutputPath` and `draftFullDraft`). The row's "done" check is `hasFile(/^reader-profile\.json$/)`; the active check is `isActive("discoverReader")`. The label can show the concept count from `liveStatus` if available.

### `summarizeNodeState` case (`src/live-status.ts`)

At `:285`, add: `if (node === "discoverReader") return { concepts: s.readerProfile?.length, goal: s.learningGoal }`. This populates the node-history summary shown on the run page.

### TUI badge (`src/tui/components/Dashboard.tsx`)

Repurpose the removed `depth:` badge slot: a one-line `<text fg={theme.textMuted}>reader: {N concepts} · {goal snippet}</text>`, shown when `graphState.readerProfile` is present. Keep it short — the full profile is in the view dashboard.

## Execution Checklist

- [ ] `src/view-server.ts`: add `renderReaderProfileCard`; dispatch it on `reader-profile.json` in the card dispatcher (`:535`); repurpose the removed depth-tier header-label block to read `reader-profile.json`; add the `discoverReader` row to `renderLivePipeline`.
- [ ] `src/live-status.ts`: add the `discoverReader` case to `summarizeNodeState`.
- [ ] `src/tui/components/Dashboard.tsx`: add the `reader:` badge (repurpose the removed `depth:` slot).
- [ ] `bunx tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] Manual: after a Phase 1 run, open the view URL → Reader-profile card visible; during a run → `discoverReader` pipeline row visible; TUI → badge visible.

## Files And Systems Likely Affected

- `src/view-server.ts` — `renderReaderProfileCard`, card dispatcher, `renderLivePipeline`, header-label block.
- `src/live-status.ts` — `summarizeNodeState`.
- `src/tui/components/Dashboard.tsx` — badge.
- No run-artifact changes (reads existing `reader-profile.json`).

## Verification

- `bunx tsc --noEmit` → exit 0.
- `bun test` → 0 fail.
- Manual: complete a Phase 1 run → open `http://localhost:3000/runs/<rid>` → Reader-profile card shows the per-concept table + learning goal; the pipeline shows `discoverReader`; node history shows the `discoverReader` summary.
- Manual: during a run → the TUI shows the `reader:` badge.
- Regression: old runs without `reader-profile.json` render fine (the card is absent, same as today — no backfill needed).

## Done Criteria

- Reader-profile card renders on the run page when `reader-profile.json` exists.
- `discoverReader` appears in the live pipeline and node history.
- TUI badge shows during/after the run.
- `bunx tsc --noEmit` clean; `bun test` green.

## Handoff To Next Phase

- **Next phase:** `04-adaptive-interview-upgrades.md` (Phase 4 — optional).
- **Artifact this phase leaves:** the profile is fully visible across the view-server and TUI; triage can see what the reader knew and what the drafter included.
- **What becomes unblocked:** Phase 4 (optional adaptive upgrades) — only if Phase 1–2 data shows the fixed-cap interview is too thin or too long. Otherwise the feature is complete after Phases 1–3.

## Open Questions Or Blockers

- None beyond Phase 1 landing. The surfacing slots are confirmed vacant (`2224a41`); the card/dispatcher/`summarizeNodeState`/badge patterns are confirmed present.

## Sources

- Source plan: `docs/plan/reader-discovery/README.md` — Phase 3 section, "Where the chat lives" (the chat card is Phase 1; the profile card is Phase 3), UI sketch.
- `src/view-server.ts:308` (`renderRequestCard` — card pattern), `:535` (card dispatcher), `:1582+` (`renderLivePipeline` — pipeline rows).
- `src/live-status.ts:285` (`summarizeNodeState`).
- `src/tui/components/Dashboard.tsx` — the removed `depth:` badge slot.
- `git show 2224a41` — the removed depth-tier surfacing code (the exact slots to repurpose).
- Phase 1 brief `01-discover-reader-node-and-view-chat.md` — produces `reader-profile.json` + `state.readerProfile`.
