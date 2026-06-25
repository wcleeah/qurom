# Phase 6 — Telemetry & Systemic-Drift Guard

## Execution Snapshot

- **Phase:** 6
- **Source plan:** RecoveryRouter plan, Phase 6 (+ Phase 3.5 telemetry extension)
- **Readiness status:** `Ready` once Phases 3 + 3.5 merge (the events this phase consumes are emitted by those phases); persistence + tests not strictly blocking.
- **Primary deliverable:** A standardized set of recovery/restart debug-log events emitted across the recovery ladder; an in-process systemic-drift detector that escalates repeated same-agent restart failures across distinct requests, rather than silently looping; a Kill-switch flag (`auditRestart.maxRestarts = 0`) for runtime disable.
- **Blocking dependencies:** Phase 3 (emits `session.recovery.classify`), Phase 3.5 (emits `audit.restart_from_scratch`) — `Unknown` until merged.
- **Target measurements:** Same-agent-restart-across-two-distinct-`requestId`s triggers a `recovery.systemic_drift` event (and a louder failure) within one process session.
- **Next phase:** none (final phase).

## Why This Phase Exists

The user wants "stop it from keep happening." Two telemetry-driven guarantees:

1. **Visibility:** every recovery tier emits a standardized event so post-hoc triage can tell *which* tier caught a fault — without re-reading raw stacks. Without these events, a run that recovered via `audit.restart_from_scratch` looks identical to a clean run, masking prompt/schema drift.
2. **Systemic-drift detector (scenario #29):** if the **same agent** keeps failing-then-restarting across **two distinct runs** in one process, that's the strongest signal of prompt/schema/config drift (not context poisoning). The detector escalates a louder `recovery.systemic_drift` error rather than silently looping forever; this is the "keep happening forever" guard.

## Start Criteria

- Phase 3 merged: `promptAgent` emits `session.recovery.classify` (fault, attempt, budget-left), `session.recovery.reprompt` (kind), `session.repair.json_fixer` per attempt. These event names are not yet emitted (Phase 6 standardizes names — Phases 3 & 3.5 should emit whatever phases produced; Phase 6 finalizes + standardizes).
- Phase 3.5 merged: `audit.restart_from_scratch` event is emitted on every restart attempt with `{ agent, round, attempt, fault, priorAttempts, requestId }`.
- `src/debug-log.ts` supports arbitrary `type` strings (Confirmed: `write(type: string, data?)`).
- `src/telemetry.ts` supports an in-process counter mechanism (or one must be added here — see Implementation Details).

## Dependencies And How To Check Them

| Dependency | Why it matters | How to verify | Status |
|---|---|---|---|
| Phase 3 emit points present | Phase 6 standardizes/renames them; needs the call sites to exist | `grep -n "debugLog?.write(\"session" src/opencode.ts` lists recovery-emission sites; if empty, add in Phase 6 (per plan, Phase 6 owns finalizing names) | `Unknown` |
| Phase 3.5 `audit.restart_from_scratch` emission | Detector keys off this event | `grep -n "audit.restart_from_scratch" src/*.ts` | `Unknown` |
| `DebugLog.write(type, data?)` flexible | Event names are arbitrary strings | `grep -n "write(type" src/debug-log.ts` | `Done` |
| Telemetry has an in-process `Map`-style counter facility OR we add one | Detector needs a `Map<agentName, Set<requestId>>` | `grep -n "counter\|Map<" src/telemetry.ts` (likely negative — add here) | `Unknown` |
| `print(LOGFUSE_*)` env gating | Keep telemetry opt-in at runtime | `grep -n "LANGFUSE_PUBLIC_KEY" src/config.ts` | `Done` |
| `quorum.config.json` `auditRestart.maxRestarts` | Phase 3.5 added it; Phase 6 documents the kill-switch value (`0`) | `grep -n "auditRestart" src/config.ts` | `Unknown` (gated by Phase 3.5) |

## Target Measurements And Gates

| Measurement | Threshold | Method | Gate | Status |
|---|---|---|---|---|
| Same-agent → 2 distinct `requestId`s of restart in one process | Triggers `recovery.systemic_drift` warning and a louder failure behavior within ≤2nd restart | Unit test (Phase 5 extends here): simulate restart events for `agent=A` across `req1` then `req2`; assert `recovery.systemic_drift` event emitted on the second `requestId` | Exit | `Unknown` |
| No new events on non-recovery runs | A clean run (no recovery tiers fired) emits zero `session.recovery.*` / `audit.restart_from_scratch` events | Integration test: successful happy-path run; assert absent recovery events | Exit | `Unknown` |
| Kill-switch | `auditRestart.maxRestarts = 0` disables the R-tier at runtime (no `audit.restart_from_scratch` events; downstream `promptAgent` throws `StructuredRecoveryError` directly) | Config-driven test | Exit | `Unknown` |

## Scope

- `src/opencode.ts`: finalize and emit `session.recovery.classify`, `session.recovery.reprompt`, `session.repair.json_fixer` (rename/source Phase 3's interim events to these names).
- `src/audit-restart.ts` (or wherever Phase 3.5 lives): emit `audit.restart_from_scratch` with the agreed fields (Phase 3.5 already mandated; Phase 6 standardizes the field set).
- `src/telemetry.ts` OR new `src/recovery-drift.ts`: an in-process `Map<agentName, Set<requestId>>` reset per process; on `audit.restart_from_scratch`, record `requestId`; if the agent already has a **different** `requestId` recorded, emit `recovery.systemic_drift` and let the failure propagate louder (do not silently restart again).
- Docs: a short note in `README.md` or `docs/` documenting the recovery event vocabulary + the `auditRestart.maxRestarts = 0` kill-switch.

## Out Of Scope

- Persistent cross-process drift tracking (only in-process for v1; persisting to a `runs/recovery-drift.sqlite` is a follow-up, not in this plan).
- Alerting/notification (email/slack) on systemic drift — out of scope; the loud failure is the signal.
- Per-agent dashboards (Phase 6 emits events; aggregating them into dashboards is downstream tooling).

## Implementation Details

### Standardized event names (finalized by Phase 6)

| Event | Emitted by | Fields |
|---|---|---|
| `session.recovery.classify` | Phase 3 router | `{ fault, attempt, budgetSameAgentLeft, budgetJsonFixerLeft, requestId?, agent }` |
| `session.recovery.reprompt` | Phase 3 (A/B branches) | `{ kind: "nooutput"\|"truncated"\|"schema", agent, requestId? }` |
| `session.repair.json_fixer` | Phase 3 (C branch) | `{ agent, attempt, requestId? }` |
| `audit.restart_from_scratch` | Phase 3.5 | `{ agent, round, attempt, fault, priorAttempts, requestId }` (mandated by 3.5) |
| `session.dual_output` | Phase 4 | `{ agent, sessionID, requestId?, round?, diverged }` (mandated by 4) |
| `recovery.systemic_drift` | NEW Phase 6 | `{ agent, requestIds: [<r1>, <r2>], secondRunFault, recommendedAction: "audit prompt/schema for ${agent}" }` |

Phase 6 owns renaming any interim event names Phase 3/3.5/4 introduced to the canonical names above (a `grep`+`replace` pass).

### `RecoveryDriftDetector`

```
class RecoveryDriftDetector {
  private readonly seen = new Map<string, Set<string>>()   // agentName → Set<requestId>
  recordRestart(agent: string, requestId: string): { drift: boolean; previousRequestIds: string[] } {
    let set = this.seen.get(agent) ?? new Set()
    if (set.has(requestId)) return { drift: false, previousRequestIds: [...set] }   // same run restart — fine
    if (set.size > 0) {
      // restart on a *different* requestId for the same agent → drift
      set.add(requestId)
      return { drift: true, previousRequestIds: [...set] }
    }
    set.add(requestId)
    this.seen.set(agent, set)
    return { drift: false, previousRequestIds: [...set] }
  }
}
```

One detector instance per process (process-level module singleton). Wire it into the `audit.restart_from_scratch` emission site: after logging the restart, call `detector.recordRestart(agent, requestId)`; on `drift === true`, emit `recovery.systemic_drift` with the fields above and **convert** the next restart's `StructuredRecoveryError` into a louder `SystemicDriftError` (subclass; or just rethrow with the drift context) — i.e., stop restarting and surface the drift immediately.

### Kill-switch

`auditRestart.maxRestarts = 0` already disables R-tier in Phase 3.5. Phase 6 documents this and adds a small test confirming `audit.restart_from_scratch` is never emitted under the kill-switch.

### Where the detector lives

Prefer a small `src/recovery-drift.ts` with the detector class + a process singleton `export const recoveryDriftDetector = new RecoveryDriftDetector()`. Keeps the dependency graph clean (no `telemetry.ts` rewrite for a process-local counter). `audit-restart.ts` imports the singleton.

## Execution Checklist

- [ ] Finalize event names: rename any interim Phase 3/3.5/4 emissions to the canonical set above (grep+replace).
- [ ] Add `src/recovery-drift.ts` with `RecoveryDriftDetector` + process singleton.
- [ ] Wire the singleton into the `audit.restart_from_scratch` emission site (after logging, `detector.recordRestart(agent, requestId)`).
- [ ] On `drift === true`, emit `recovery.systemic_drift` and surface a `SystemicDriftError` instead of silently restarting again.
- [ ] Add a doc note (in `README.md` recovery section or `docs/`) for the recovery event vocabulary + the `maxRestarts = 0` kill-switch.
- [ ] Add Phase 6 unit tests to `tests/json-repair.test.ts` (or a new `tests/recovery-drift.test.ts`): simulate two distinct `requestId`s of restart for the same agent → assert `recovery.systemic_drift` emitted on the 2nd; happy-path run → assert no recovery events.
- [ ] `bunx tsc --noEmit` clean; `bun test` green.
- [ ] End-to-end report (if opencode running): rerun the `010a399c` topic; expect no `failure.json` and (for this run only) no `recovery.systemic_drift` event — just clean recovery/free-tier. Optionally induce a deliberately broken audit prompt in a control run to force drift, then assert `recovery.systemic_drift` fires.

## Files And Systems Likely Affected

- New: `src/recovery-drift.ts` (detector + singleton).
- `src/opencode.ts` — event-name finalization pass.
- `src/audit-restart.ts` — wire singleton + `recovery.systemic_drift` escalation.
- Docs: short note on recovery events + kill-switch.
- Tests: `tests/recovery-drift.test.ts` (or section in `tests/json-repair.test.ts`).

## Verification

- `bunx tsc --noEmit` clean; `bun test` green.
- New drift test: simulate per-checklist; `recovery.systemic_drift` fires exactly once on the 2nd distinct `requestId`.
- No-recovery test: happy-path run; assert zero recovery events.
- Kill-switch test: with `maxRestarts = 0`, no `audit.restart_from_scratch` events; `promptAgent` throws `StructuredRecoveryError` directly.
- Naming audit: `grep -rn "session.recovery\.\|audit.restart_from_scratch\|recovery.systemic_drift\|session.repair.\|session.dual_output" src/` returns only the canonical event-name set (no stragglers/interim names).
- Triage replication: replay a deliberately-broken-audit-prompt run twice; second run fails loud with `recovery.systemic_drift` rather than producing the same silent `failure.json` as the first run.

## Done Criteria

- All recovery/restart events use the canonical names; the `grep` audit above is a clean change.
- `RecoveryDriftDetector` wired into restarts; `recovery.systemic_drift` emitted on restarts of the same agent across distinct run IDs.
- On drift, failure propagates loud (`SystemicDriftError` or equivalent) — no silent infinite-restart.
- `auditRestart.maxRestarts = 0` documented kill-switch; test confirms R-tier disabled.
- `bun test` green including new drift + kill-switch tests.

## Handoff To Next Phase

This is the **final phase**. After completion:

- No further phases defined. Rollout is the merged ladder D → A/B/C → R → run-failure; telemetry makes every tier visible; the drift detector prevents the silent "keep happening forever" failure mode.
- Final validation: the end-to-end repro run (`010a399c` topic) succeeds with no `failure.json` and the documented recovery-event vocabulary attests *which* tier caught it (expected: D tier, zero LLM extra calls). Mention to user that they can grep `runs/<rid>/debug-log.jsonl` for `session.recovery.*` / `audit.restart_from_scratch` / `recovery.systemic_drift` to triage any future regression immediately.

## Open Questions Or Blockers

- **Inferred:** `RecoveryDriftDetector` resets per process. If the user runs quorum as one long-lived process serving many research requests, this matches the "drift across runs in one process" intent. If quorum is invoked fresh per request, the detector never accumulates across requests — degrade to "drift detection off in this deployment model"; persisting to `runs/recovery-drift.sqlite` becomes a follow-up. Confirm quorum's process model before deciding persistence is needed.
- **Debatable:** Should `recovery.systemic_drift` fail the *current* run or only the *next*? Current decision: escalates the *current* run to a loud failure (rather than silently restarting a 3rd time). Reasonable alternative: emit the drift event + allow the current run to finish via restart, but mark it for review. Default to loud-fail for v1 (matches "stop the keep-happening feeling"); revisit if it's too aggressive.
- Assumption: final event names are stable enough to commit; downstream tooling is internal-only (no external consumers of the debug-log format).

## Sources

- `src/debug-log.ts`: `write(type: string, data?)` supports arbitrary names (Confirmed).
- `src/telemetry.ts`: existing observation infra (no in-process counter; detector lives in new `recovery-drift.ts`).
- `src/config.ts` + `quorum.config.json`: `auditRestart.maxRestarts` (Phase 3.5).
- Plan: Phase 6 (Telemetry & systemic-drift guard), Phase 3.5 telemetry extension, scenario #29 (systemic schema/prompt drift).