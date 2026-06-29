# Phase 4 — Adaptive interview upgrades (optional)

## Execution Snapshot

- **Phase:** 4 (optional)
- **Source plan:** `docs/plan/reader-discovery/README.md` (Phase 4 section)
- **Readiness status:** `Unknown` — this phase is **conditional**. It is only worth executing if Phases 1–2 show the fixed-cap (Decision B, 6 turns) fully-adaptive (Decision A2) interview is too thin (concepts off-domain or missing) or too long (users abandon). Do not start without that evidence.
- **Primary deliverable:** Candidate upgrades to the interview loop: per-concept drill-down when a probe answer is ambiguous, a "reader asks a clarifying question back" branch, and/or a dynamic turn budget based on prerequisite breadth. The specific subset is chosen based on Phase 1–2 data.
- **Blocking dependencies:** Phases 1–2 merged and run in production enough to gather evidence; Phase 3 (surfacing) merged so the profile is visible for triage.
- **Target measurements summary:** chosen based on the Phase 1–2 gap; e.g. "off-domain concept rate < X%" or "interview completion rate > Y%".
- **Next phase:** none (final phase).

## Why This Phase Exists

Decisions A2 (fully adaptive, no primer) and B1 (generous fixed cap, no confidence floor) are deliberately simple v1 choices. They have two failure modes the plan flagged: the interviewer wanders / misses on-domain prerequisites (risk #1), or the interview is too long and users abandon (risk #2). If either shows up in Phase 1–2 data, this phase tightens the interview without rebuilding it. If neither shows up, this phase is skipped.

## Start Criteria

- Phases 1–3 merged.
- Evidence from Phase 1–2 runs showing a specific, measurable gap in the interview (off-domain concepts, thin profiles, abandonment). **If there is no evidence of a gap, do not start this phase.**
- A chosen target measurement (e.g. "off-domain concept rate < 20%", "interview completion rate > 80%").

## Dependencies And How To Check Them

| Dependency | Why it matters | How to verify | Status |
|---|---|---|---|
| Phases 1–2 merged | The interview loop exists to upgrade | `grep -n "discoverReader" src/graph.ts` returns the node; `bun test` green | `Unknown` (gated by Phases 1–2) |
| Phase 3 merged | Surfacing makes the profile triageable for gathering evidence | `grep -n "renderReaderProfileCard" src/view-server.ts` | `Unknown` (gated by Phase 3) |
| Evidence of a specific gap | This phase is conditional on a real problem | Inspect `reader-profile.json` across N runs; count off-domain concepts / thin profiles / abandonment | `Unknown` — must be gathered before starting |

## Target Measurements And Gates

| Measurement | Threshold | Method | Gate | Status |
|---|---|---|---|---|
| (chosen based on gap) | (defined by the gap) | (defined by the gap) | Exit | `Unknown` |
| Type-check clean | `bunx tsc --noEmit` exit 0 | Run the command | Exit | `Unknown` |
| Test suite green | `bun test` 0 fail | Run the command | Exit | `Unknown` |

Do not invent measurements until the gap is identified. A phase that "improves the interview" without a target is not executable.

## Scope

- Candidate upgrades (pick the subset that addresses the identified gap):
  - **Per-concept drill-down:** when a probe answer is ambiguous ("I've heard of it"), the interviewer asks a follow-up to disambiguate familiar vs. heard-of. Schema may need a `subturn` or the interviewer returns a targeted follow-up question referencing the specific concept.
  - **Reader-asks-back branch:** if the reader replies with a clarifying question ("what do you mean by computational graph?"), the interviewer answers it (using research tools) before continuing. The node loop treats this as a normal turn.
  - **Dynamic turn budget:** the interviewer returns a suggested `additionalTurns` value based on prerequisite breadth; the cap adjusts per topic instead of the fixed 6.

## Out Of Scope

- Rebuilding the interview loop or switching to a primer-based approach (Decision A1) — that was explicitly rejected in the plan.
- Reintroducing confidence — explicitly removed (point 4).
- Changing the quorum size or auditor count.

## Implementation Details

Defined per chosen upgrade. Because this phase is conditional, the details depend on the gap. General shape: the `readerInterviewTurnSchema` may gain optional fields (e.g. `followUpOn?: string`, `additionalTurns?: number`); the interviewer prompt asset gains instructions for the new behavior; the node loop interprets the new fields. The view-server chat card needs no change (it already renders the transcript + input).

## Execution Checklist

- [ ] Gather evidence: inspect N `reader-profile.json` files from Phase 1–2 runs; count off-domain concepts, thin profiles (few concepts), and abandonment (runs that Ctrl-C'd during the interview).
- [ ] If no gap, stop — mark this phase "Not executed, no evidence" and close the rollout.
- [ ] If a gap, define the target measurement and choose the upgrade subset.
- [ ] Implement the upgrade(s) in `src/graph.ts` (node loop), `assets/prompts/reader-interview.md` (instructions), `src/schema.ts` (any new schema fields).
- [ ] Update `tests/reader-discovery.test.ts` to cover the new behavior.
- [ ] `bunx tsc --noEmit` clean; `bun test` green.
- [ ] Manual: run the upgrade against the gap scenario; confirm the target measurement improves.

## Files And Systems Likely Affected

- `src/graph.ts` — `discoverReader` node loop.
- `assets/prompts/reader-interview.md` — interviewer instructions.
- `src/schema.ts` — `readerInterviewTurnSchema` (optional new fields).
- `tests/reader-discovery.test.ts` — new behavior coverage.

## Verification

- `bunx tsc --noEmit` → exit 0.
- `bun test` → 0 fail.
- Manual: the chosen target measurement improves against the Phase 1–2 baseline.

## Done Criteria

- The chosen upgrade(s) are implemented; the target measurement improves; `bunx tsc --noEmit` clean; `bun test` green.
- Or: the phase is explicitly marked "Not executed, no evidence" and the rollout is complete at Phases 1–3.

## Handoff To Next Phase

This is the **final phase**. After completion (or after deciding not to execute it), the reader-discovery rollout is complete. Final validation: the end-to-end repro from the plan's verification anchor (topic + document mode, calibrated drafts, kill-switch works, view-server card visible) passes.

## Open Questions Or Blockers

- **The gap must be identified first.** Without evidence of a specific failure mode, this phase is not executable. Do not start on speculation.
- **Per-concept drill-down may complicate the turn cap.** If a drill-down consumes a turn, the effective budget for breadth shrinks — decide whether drill-down turns count against `maxTurns` or are additive.

## Sources

- Source plan: `docs/plan/reader-discovery/README.md` — Phase 4 section, risk #1 (wandering), risk #2 (abandonment).
- Phase 1 brief `01-discover-reader-node-and-view-chat.md` — the interview loop to upgrade.
- Phase 2 brief `02-thread-profile-to-auditors-rebuttals.md` — the calibrated quorum.
- Phase 3 brief `03-surface-profile-in-view-tui.md` — the triage surface for gathering evidence.
