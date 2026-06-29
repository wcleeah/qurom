# Phase 2 — Thread `readerContextBlock` to auditors, rebuttals, and drafter-review

## Execution Snapshot

- **Phase:** 2
- **Source plan:** `docs/plan/reader-discovery/README.md` (Phase 2 section, "Recommended approach")
- **Readiness status:** `Ready` once Phase 1 merges (gated on `readerContextBlock` + `state.readerProfile`/`state.learningGoal` existing). Marked `Unknown` until Phase 1 lands.
- **Primary deliverable:** Inject `readerContextBlock(state)` into `auditPrompt`, `rebuttalPrompt`, `rebuttalReviewPrompt`, and `drafterReviewPrompt`, and update the audit prompt asset so the clarity auditor judges clarity *for this reader* (explanation depth) while still flagging correctness/logic defects (factual rigor).
- **Blocking dependencies:** Phase 1 — `readerContextBlock` must exist and be populated on `state`; `fullDraftPrompt` must already inject it (the template to copy).
- **Target measurements summary:** (1) expert-reader run: clarity auditor does NOT flag the intentional Prerequisites section as "too basic"; (2) beginner-reader run: clarity auditor does NOT flag jargon-heavy sections as "assumes too much"; (3) auditors still flag factual/logic defects; (4) `bunx tsc --noEmit` clean + `bun test` green.
- **Next phase:** `03-surface-profile-in-view-tui.md` (Phase 3 — can run in parallel with this phase).

## Why This Phase Exists

Phase 1 makes the drafter reader-aware but leaves the auditors judging against a phantom default reader. The clarity auditor will then flag reader-calibrated prose as "too basic" (for an expert) or "assumes too much" (for a beginner) — findings that reflect the auditor's default-reader assumption, not a real defect. The rebuttal loop fights a phantom disagreement. This phase closes the loop: every agent that judges the draft sees the same profile and judges *for this reader*. This is the feature's value moment — the quorum stops fighting the reader calibration.

## Start Criteria

- Phase 1 merged: `readerContextBlock(state)` exists and returns a non-empty string when `state.readerProfile` is set.
- `state.readerProfile`/`state.learningGoal` are populated by `discoverReader` and persisted across the graph (checkpoint-safe).
- `bunx tsc --noEmit` clean; `bun test` green.

## Dependencies And How To Check Them

| Dependency | Why it matters | How to verify | Status |
|---|---|---|---|
| `readerContextBlock` exists in `src/graph.ts` | Phase 2 calls it from the other prompt-contract functions | `grep -n "function readerContextBlock" src/graph.ts` returns a hit | `Unknown` (gated by Phase 1) |
| `state.readerProfile` is populated and survives to the audit/rebuttal nodes | The auditors run after `draftFullDraft`; the profile must still be on state | `grep -n "readerProfile" src/schema.ts` returns the field on `researchStateSchema`; a Phase 1 test asserts it's set after `discoverReader` | `Unknown` (gated by Phase 1) |
| `fullDraftPrompt` already injects `readerContextBlock` | The template to copy for the other prompt functions | `grep -n "readerContextBlock" src/graph.ts` shows the call inside `fullDraftPrompt` | `Unknown` (gated by Phase 1) |
| `auditPrompt`/`rebuttalPrompt`/`rebuttalReviewPrompt`/`drafterReviewPrompt` signatures | Phase 2 may need to pass `state` (some take `request: string` today) | `grep -n "function auditPrompt\|function rebuttalPrompt\|function rebuttalReviewPrompt\|function drafterReviewPrompt" src/graph.ts` | `Done` (signatures are visible; `auditPrompt` takes `request: string` — see Implementation Details) |
| `assets/prompts/audit.md` has a place for a `{readerContext}` placeholder | The injection is data; the prompt asset consumes it | `cat assets/prompts/audit.md` | `Done` (file exists; Phase 2 adds the placeholder) |

## Target Measurements And Gates

| Measurement | Threshold | Method | Gate | Status |
|---|---|---|---|---|
| Expert-reader run: clarity auditor does not flag Prerequisites as "too basic" | Zero clarity findings on the Prerequisites section for an expert profile | Manual: run with an expert profile, inspect `runs/<rid>/audits-round-N.json` for clarity-auditor findings | Exit | `Unknown` |
| Beginner-reader run: clarity auditor does not flag jargon as "assumes too much" | Zero "assumes too much" findings on jargon sections for a beginner profile (jargon is appropriate for an expert, flagged for a beginner — verify the direction matches) | Manual: run with a beginner profile, inspect audits | Exit | `Unknown` |
| Auditors still flag correctness/logic defects | A deliberately inserted factual error is still caught by source/logic auditors regardless of profile | Manual: introduce a factual error in a control draft, confirm auditors flag it | Exit | `Unknown` |
| Type-check clean | `bunx tsc --noEmit` exit 0 | Run the command | Exit | `Unknown` |
| Test suite green | `bun test` 0 fail | Run the command | Exit | `Unknown` |

## Scope

- `src/graph.ts`: inject `readerContextBlock(state)` into `auditPrompt`, `rebuttalPrompt`, `rebuttalReviewPrompt`, `drafterReviewPrompt`. Adjust signatures as needed (see Implementation Details).
- `assets/prompts/audit.md`: add a section that consumes `{readerContext}` and instructs the clarity auditor to judge explanation depth for this reader while preserving factual-rigor checks.
- `tests/reader-discovery.test.ts`: extend with assertions that `auditPrompt`/`rebuttalPrompt` outputs include the reader context when the profile is set, and exclude it when absent.

## Out Of Scope

- Changing the recovery router, quorum size, or auditor count — the profile gates *explanation depth*, not *quorum sizing*.
- Injecting the profile into design-phase prompts — out of scope for v1.
- The view-server Reader-profile card, live pipeline row, TUI badge — **Phase 3**.
- Any change to `discoverReader` or the interview loop — Phase 1 owns those.

## Implementation Details

### Signature changes

`auditPrompt(config, promptBundle, agent, request, outputFile, previousUnresolved?)` currently takes `request: string` (the topic label). To inject `readerContextBlock(state)`, either:
- **(preferred)** change `auditPrompt` to take `state: ResearchState` and derive `request` internally via `requestLabel(state)` — matches `fullDraftPrompt`'s shape; all callers already have `state` (`runParallelAudits` at `src/graph.ts:672` has `state`).
- or add an optional `readerContext?: string` arg.

`rebuttalPrompt` (`:179`), `rebuttalReviewPrompt` (`:190`), `drafterReviewPrompt` (used at `:790`) — check each signature; several already take `state` or can be passed `state` from their callers. Prefer the `state`-based approach for consistency.

### The audit prompt asset (`assets/prompts/audit.md`)

Add a section (consumed by `auditPrompt` replacing a `{readerContext}` placeholder):

> The reader's profile is below. Judge clarity **for this reader**, not for a default reader. If the reader is unfamiliar with a concept that the draft uses without explanation, that is a clarity finding. If the draft explains a concept the reader already knows, that is **not** a clarity finding (do not flag "too basic" for material the reader is familiar with). **Note:** the profile gates explanation depth, not factual rigor — still flag correctness, source, and logic defects regardless of the reader's level.

This is the critical instruction that prevents risk #7 (auditors become too lenient). The distinction between explanation-depth and factual-rigor must be explicit in the prompt.

### Why the direction matters

For an **expert** profile: jargon-heavy sections are appropriate (not "assumes too much"); a Prerequisites section covering basics the expert already knows *would* be "too basic" — but Phase 1's drafter omits prereqs the reader knows, so the section shouldn't exist. For a **beginner** profile: jargon-heavy sections without explanation are "assumes too much"; a Prerequisites section is appropriate. The Phase 1 drafter + Phase 2 auditor must agree on this direction — verify in the manual checks.

## Execution Checklist

- [ ] `src/graph.ts`: change `auditPrompt` to take `state` (or add `readerContext` arg); inject `readerContextBlock(state)` into its output. Update the `runParallelAudits` call site (`:672`).
- [ ] `src/graph.ts`: inject `readerContextBlock(state)` into `rebuttalPrompt`, `rebuttalReviewPrompt`, `drafterReviewPrompt`. Update call sites (`:922`, `:1090`, `:790`).
- [ ] `assets/prompts/audit.md`: add the `{readerContext}` section with the explanation-depth-vs-factual-rigor distinction.
- [ ] `tests/reader-discovery.test.ts`: assert `auditPrompt(...)` output contains the reader context when the profile is set and excludes it when absent; same for `rebuttalPrompt`/`rebuttalReviewPrompt`/`drafterReviewPrompt`.
- [ ] `bunx tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] Manual: expert-reader run → clarity auditor does not flag Prerequisites as "too basic"; beginner-reader run → clarity auditor flags jargon "assumes too much"; a deliberate factual error is still caught.

## Files And Systems Likely Affected

- `src/graph.ts` — `auditPrompt`, `rebuttalPrompt`, `rebuttalReviewPrompt`, `drafterReviewPrompt` + call sites.
- `assets/prompts/audit.md` — `{readerContext}` section.
- `tests/reader-discovery.test.ts` — prompt-injection assertions.
- Run artifacts: `audits-round-N.json` findings should reflect reader-calibrated clarity judgments.

## Verification

- `bunx tsc --noEmit` → exit 0.
- `bun test` → 0 fail (incl. new prompt-injection assertions).
- Manual expert run: `bun run dev` → "What is MLX?" → answer as an expert → inspect `runs/<rid>/audits-round-0.json` → zero clarity findings on (the absent) Prerequisites section; jargon sections not flagged.
- Manual beginner run: same topic → answer as a beginner → audits flag jargon "assumes too much" where appropriate; Prerequisites section not flagged.
- Manual control: introduce a factual error in the draft → source/logic auditors still flag it regardless of profile.
- Regression: `bun test` full suite green; recovery-router tests unchanged.

## Done Criteria

- `readerContextBlock` is injected into `auditPrompt`, `rebuttalPrompt`, `rebuttalReviewPrompt`, `drafterReviewPrompt`.
- `assets/prompts/audit.md` carries the explanation-depth-vs-factual-rigor instruction.
- Manual checks pass: expert not flagged "too basic", beginner jargon flagged "assumes too much", factual errors still caught.
- `bunx tsc --noEmit` clean; `bun test` green.

## Handoff To Next Phase

- **Next phase:** `03-surface-profile-in-view-tui.md` (Phase 3) — **can run in parallel with Phase 2** (Phase 3 reads `reader-profile.json` + `state.readerProfile`, which Phase 1 already produces; it does not depend on Phase 2's prompt injection). If running sequentially, Phase 3 is next.
- **Artifact this phase leaves:** every agent in the quorum now sees the reader profile; the quorum is internally consistent on reader calibration.
- **What becomes unblocked:** Phase 3 (surfacing) is unblocked by Phase 1 already; Phase 2's completion means the feature is functionally complete (calibrated draft + calibrated audits). Phase 4 (optional) is the only remaining sequential work.

## Open Questions Or Blockers

- **`auditPrompt` signature change rippling to `runDesignAudits`? — `Inferred`.** `auditPrompt` is the research-audit prompt builder; the design audits use a different prompt path (`src/design-quorum.ts:200` area). Confirm the signature change does not affect design-audit callers; if it does, gate the change to research audits only.
- **Clarity auditor's existing default-reader assumption — `Inferred`.** The current `assets/prompts/audit.md` does not name a default reader; the assumption is implicit. Confirm by reading the file before editing; the Phase 2 edit makes the reader explicit.

## Sources

- Source plan: `docs/plan/reader-discovery/README.md` — Phase 2 section, risk #7 ("Profile makes auditors too lenient").
- `src/graph.ts:138` (`auditPrompt`), `:179` (`rebuttalPrompt`), `:190` (`rebuttalReviewPrompt`), `:790` (`drafterReviewPrompt` call), `:672` (`runParallelAudits` audit call).
- `assets/prompts/audit.md` — the file to edit.
- Phase 1 brief `01-discover-reader-node-and-view-chat.md` — leaves `readerContextBlock` + `state.readerProfile`/`state.learningGoal`.
