# Phase 3.5 — Outer Fresh-Session Restart for Auditors

## Execution Snapshot

- **Phase:** 3.5
- **Source plan:** RecoveryRouter plan, Phase 3.5 (plan patch)
- **Readiness status:** `Ready` once Phase 3 merges.
- **Primary deliverable:** When `promptAgent`'s in-session recovery exhausts its budget and throws `StructuredRecoveryError`, the auditor caller catches it, tears down the session, creates a **brand-new OpenCode session**, and re-runs the identical audit prompt for that one agent — bounded — then only fails the run if the restart also fails.
- **Blocking dependencies:** Phase 3 (`StructuredRecoveryError` export, typed fault classifier) — `Unknown` until Phase 3 merges.
- **Target measurements:** `maxRestarts` configurable via `quorum.config.json` (`auditRestart.maxRestarts`, default 1); exactly 1 restart per auditor per round unless overridden.
- **Next phase:** `05-persistence-inline-file-fixup.md` (Phase 4).

## Why This Phase Exists

The in-session tier (Phase 3) re-prompts the **same agent inside the same `activeSessionID`** — the model sees its own prior bad turn in context. If the failure is caused by **context poisoning** (the agent keeps producing the same malformed shape because its history anchors it), in-session retries can loop-and-fail identically. A **fresh session** gives the audit a clean context window with only the audit prompt + draft — strictly the inputs a stateless audit needs.

This is an **outer** tier because sessions are created by the **caller**, not `promptAgent` — `promptAgent` only knows the agent *by name*. Only the caller knows it's running an audit (stateless) vs. a stateful drafter/rebuttal turn.

This tier also implements the explicit user requirement: *"if retry same agent fails, create a new session start the audit from scratch for that agent."*

## Start Criteria

- Phase 3 merged: `StructuredRecoveryError` exists and is exported from `src/opencode.ts`; Phase 3's manual matrix green; `bun test` green.
- `createSession(config, title)` is importable from `./opencode` (Confirmed) and used at `graph.ts:761` and `design-quorum.ts`.
- The auditor caller loops are intact and identifiable: `runParallelAudits` (`src/graph.ts:760–790`) and `runDesignAudits` (`src/design-quorum.ts:178`).
- `quorum.config.json` + `src/config.ts` `quorumConfigSchema` are readable (Confirmed current shapes).

## Dependencies And How To Check Them

| Dependency | Why it matters | How to verify | Status |
|---|---|---|---|
| Phase 3 `StructuredRecoveryError` exported | Wrapper matches on `instanceof StructuredRecoveryError`; without it, all failures propagate (no restart) | `grep -n "export class StructuredRecoveryError" src/opencode.ts` returns a hit | `Unknown` (gated by Phase 3 merge) |
| `createSession` importable | Restart opens a fresh session | `grep -n "export async function createSession" src/opencode.ts` | `Done` |
| Auditor callers identified | Phase 3.5 wraps exactly these two | `grep -n "runParallelAudits\|runDesignAudits" src/graph.ts src/design-quorum.ts` | `Done` |
| `config.json` has no `auditRestart` field yet | Confirms additive config change | `grep -n "auditRestart" quorum.config.json src/config.ts` returns nothing | `Done` |
| Non-auditor callers (drafter, rebuttal, summarizer, designer) must NOT be wrapped | Phase 3.5 is auditor-scoped by the user's wording + statelessness | Enumerate: `grep -n "promptAgent(" src/graph.ts src/design-quorum.ts src/summarizer.ts` | `Done` |

## Target Measurements And Gates

| Measurement | Threshold | Method | Gate | Status |
|---|---|---|---|---|
| Restart budget | `auditRestart.maxRestarts` (default 1) | Config field read at runtime; assert default applies when field absent | Exit | `Unknown` |
| Restart only on `StructuredRecoveryError` | Non-recovery errors propagate without restart | Stub `promptAgent` to throw a plain `Error("bug")`; assert `createSession` called exactly once (no restart) | Exit | `Unknown` |
| Restart produces exactly 1 extra `createSession` | At `maxRestarts:1`, a failing audit yields 2 `createSession` calls total then a `StructuredRecoveryError` final throw | Stub `promptAgent` to always throw `StructuredRecoveryError`; count `createSession` invocations | Exit | `Unknown` |
| Same `outputFile` reused on restart | No `.restart-N` clutter; downstream readers see the canonical path | Assert the wrapper passes the same `outputFile` on both attempts (capture in stub) | Exit | `Unknown` |

## Scope

- `src/audit-restart.ts` (new) OR `src/graph.ts` (inline helper): `auditWithRestart(input, { maxRestarts })`.
- `src/graph.ts`: replace the per-agent `promptAgent` call in `runParallelAudits` with `auditWithRestart`.
- `src/design-quorum.ts`: same replacement in `runDesignAudits`.
- `src/config.ts` + `quorum.config.json`: add `auditRestart: { maxRestarts: number }` (default `{ maxRestarts: 1 }`).
- **No** wrapping of drafter / summarizer / designer / rebuttal callers.

## Out Of Scope

- Extending restart beyond auditors (drafter/rebuttal Carry state). Explicitly deferred — out of scope by design.
- Increasing in-session budgets (Phase 3 owns the A/B/C budgets; Phase 3.5 does not edit them).
- Restarting `json-fixer` itself if it fails (Phase 3's C branch already bounded; further escalation out of scope).
- Systemic-drift emission scoped to this tier (Phase 6's detector consumes this tier's `audit.restart_from_scratch` event; the detector itself — `recovery.systemic_drift` — implements in Phase 6).

## Implementation Details

### `auditWithRestart`

```
export async function auditWithRestart<I, T>(
  input: { config, agent, prompt, schema, outputFile, sessionID: string, inputFiles?, telemetry?, observer? },
  opts: { maxRestarts: number },
  makeSession: (attempt: number) => Promise<{ sessionID: string; title: string }>,   // injected or built from caller
): ReturnType<typeof promptAgent> {
  for (let attempt = 0; attempt <= opts.maxRestarts; attempt++) {
    const session = attempt === 0
      ? { id: input.sessionID }
      : await createSession(input.config, `${input.titleBase}:restart:${attempt}`)
    input.telemetry?.trackSessionObservation?.(session.id, input.telemetry.parentObservation)
    if (input.observer) observeSession(input.observer, { sessionID: session.id, role: input.role, requestId: input.requestId })
    try {
      return await promptAgent({ ...input, sessionID: session.id })
    } catch (e) {
      if (!(e instanceof StructuredRecoveryError) || attempt === opts.maxRestarts) throw e
      input.telemetry?.debugLog?.write("audit.restart_from_scratch", { agent: input.agent, round: input.round, attempt: attempt + 1, fault: e.fault, priorAttempts: e.attempts, requestId: input.requestId })
    }
  }
  // unreachable
}
```

The wrapper reuses the **same** `outputFile` (the prior invalid file is overwritten — it's invalid anyway; avoids `.restart-N` clutter downstream readers would need to ignore) and the **identical** original audit prompt.

### Caller edits

`runParallelAudits` loop body becomes:

```
const session = await createSession(config, `audit:${state.requestId}:${agent}:round:${state.round}`)
observeSession(observer, { sessionID: session.id, role: `auditor:${agent}`, requestId: state.requestId })
const outputFile = `${state.outputPath}/audit-${agent}-round-${state.round}.json`
const response = await auditWithRestart(
  { config, agent, prompt: auditPrompt(...), schema: auditResultSchema, outputFile, sessionID: session.id,
    inputFiles: [{path: draftFile, mime:"text/plain", filename:"draft.md"}],
    telemetry: graphAgentTelemetry({...}), observer, role: `auditor:${agent}`, requestId: state.requestId,
    round: state.round, titleBase: `audit:${state.requestId}:${agent}:round:${state.round}`,
    parentObservation: ... },
  { maxRestarts: config.quorumConfig.auditRestart.maxRestarts }
)
```

The wrapper makes its own fresh sessions on restart from `titleBase` (the original session is reused for attempt 0; restart attempts get `:restart:N` suffix in the title).

`runDesignAudits` mirrors this (same `outputFile`, same audit prompt, fresh session on restart).

### Config knob

`src/config.ts`:
```
auditRestart: z.object({ maxRestarts: z.number().int().nonnegative().default(1) }).default({ maxRestarts: 1 })
```
`quorum.config.json` is left unchanged (defaults apply); add the key only if tuning. Once Phase 6's systemic-drift detector is in, set `maxRestarts: 0` as the runtime kill-switch.

## Execution Checklist

- [ ] Add `StructuredRecoveryError` import to `graph.ts` (and `design-quorum.ts`) — already exported from Phase 3.
- [ ] Implement `auditWithRestart` (new `src/audit-restart.ts` or inline in `graph.ts` — prefer new file for reuse across `graph.ts` + `design-quorum.ts`).
- [ ] Wrap `runParallelAudits`'s per-agent `promptAgent` call with `auditWithRestart`; preserve identical `outputFile`, prompt, `inputFiles`, telemetry wiring.
- [ ] Wrap `runDesignAudits`'s per-agent `promptAgent` call the same way.
- [ ] Add `auditRestart: { maxRestarts: default 1 }` to `quorumConfigSchema` in `src/config.ts`.
- [ ] Leave `quorum.config.json` unchanged (default applies) OR add a commented example.
- [ ] Confirm drafter / summarizer / designer / rebuttal callers are NOT touched.
- [ ] Emit `audit.restart_from_scratch` debug-log on every restart attempt with `{ agent, round, attempt, fault, priorAttempts, requestId }`.
- [ ] `bunx tsc --noEmit` clean; `bun test` green (formal restart tests land in Phase 5).

## Files And Systems Likely Affected

- New: `src/audit-restart.ts` (helper).
- `src/graph.ts` — `runParallelAudits` body rewrapped.
- `src/design-quorum.ts` — `runDesignAudits` body rewrapped.
- `src/config.ts` — `auditRestart` schema field + default.
- `quorum.config.json` — untouched (default applies) unless tuning is desired.
- Run artifacts: no new filenames; restart reuses the canonical `audit-<agent>-round-<n>.json` (overwriting the prior invalid file).

## Verification

- `bunx tsc --noEmit` clean; `bun test` green; specifically `runner.test.ts` / `runner.integration.test.ts` must still produce **one `AuditResultRecord` per auditor per round** (no doubling from restart — restart happens only on failure).
- Manual matrix (formal Phase 5 tests):
  - `StructuredRecoveryError(schema)` thrown once → valid on attempt 2 → asserts 2 distinct `createSession` calls + reused `outputFile` + returned struct.
  - Plain `Error("bug")` thrown → asserts exactly 1 `createSession` call; error propagated unchanged (no masking of programmer errors).
  - Always-throw `StructuredRecoveryError` with `maxRestarts:1` → exactly 2 `createSession`; final throw is the `StructuredRecoveryError` with `fault` preserved.
  - Design-audit mirror: same as above against `runDesignAudits`.
- End-to-end (if opencode running): inject a stubbed always-bad auditor in an integration test → run recovered via `audit.restart_from_scratch` rather than `failure.json`. The real `010a399c` run should now succeed at the D tier with **zero** restarts (proving the cheap tier resolved it before this tier was needed) — verify debug-log shows no `audit.restart_from_scratch`.
- Triage fidelity: with a genuinely broken audit prompt (test fixture), exhaust → restart once → final `failure.json`'s `error` field contains `StructuredRecoveryError`'s `${fault}_unresolved` (e.g., `semantic_unresolved`), **not** a raw `JSON Parse error`.

## Done Criteria

- `auditWithRestart` exists; both auditor callers use it; design + research auditors covered.
- `auditRestart.maxRestarts` config field exists with default 1.
- Non-auditor callers are provably untouched (grep diff shows no `auditWithRestart` outside the two auditor callers).
- Manual matrix + `bun test` pass; parser-doubled-output regression absent.
- `audit.restart_from_scratch` debug-log emitted on every restart attempt.

## Handoff To Next Phase

- **Next phase:** `05-persistence-inline-file-fixup.md` (Phase 4).
- **Artifact this phase leaves to the next:** categorized, recoverable-then-final `StructuredRecoveryError` propagating cleanly through callers — Phase 4's persistence must NOT break this contract (an inline-valid audit must persist + return, not throw).
- **What becomes unblocked:** Phase 6's systemic-drift detector can key off `audit.restart_from_scratch` events (Phase 6).

## Open Questions Or Blockers

- **Inferred:** `titleBase` for the fresh-session title is derivable from the original session title slug (`audit:${requestId}:${agent}:round:${round}` + `:restart:N`). Confirm the exact title format fits opencode session-filtering UIs if it matters — otherwise cosmetic.
- **Confirmed:** only `StructuredRecoveryError` triggers restart; any `assertStatus`/`ZodError`/network `Error` from setup propagates untouched (the rejection of restart for programmer errors is the regression-guard intent).
- Assumption: a single restart per auditor per round is the right default budget for "keep happening" runs. If real runs show restarts also reproducing the same fault (a sign of prompt/schema drift rather than context poisoning), Phase 6's systemic-drift detector escalates rather than raising this knob.

## Sources

- `src/graph.ts:760–790` — `runParallelAudits` per-agent `createSession` + `promptAgent` pattern (the wrap target).
- `src/design-quorum.ts:178` — `runDesignAudits` identical shape (opt-in wrap).
- `src/opencode.ts` `createSession` — new session = clean context window.
- `promptAgent` signal-of-throw — only knows agent *by name*, no `role`; validates placing the restart at the caller.
- Plan: Phase 3.5 (plan patch), scenarios #29 (systemic drift, detected later in Phase 6).