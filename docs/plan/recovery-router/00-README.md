# Recovery Router — Phase Execution Briefs

Execution packaging of the implementation plan: **RecoveryRouter for structured outputs in `promptAgent`**.

## Phase-to-file mapping

| File | Phase | Title |
|---|---|---|
| `01-resurrect-repair-and-coercejson.md` | Phase 1 | Resurrect repair branches + add free `coerceJson` pre-clean |
| `02-no-output-transport-path.md` | Phase 2 | Fix the no-output / transport path |
| `03-recovery-router.md` | Phase 3 | The `RecoveryRouter` (D→A/B/C classified recovery) |
| `04-outer-fresh-session-restart-auditors.md` | Phase 3.5 | Outer fresh-session restart for auditors |
| `05-persistence-inline-file-fixup.md` | Phase 4 | Persistence + inline-when-file fixup |
| `06-tests.md` | Phase 5 | Tests |
| `07-telemetry-systemic-drift-guard.md` | Phase 6 | Telemetry & systemic-drift guard |

## Rollout ladder (the throughline)

```
D (free coerce) → A/B/C (in-session, same session) → R (fresh session restart, auditors only) → run failure
```

Phase order = dependency order. Phase 1 is independently mergeable and alone fixes the reported `010a399c` run crash; Phases 2–4 compose on top; Phase 3.5 depends on a typed error exported in Phase 3.

## Verification anchor

The failing run to reproduce end-to-end once all phases land:

```
bun run src/index.ts "highlighting text in html, across tags and anchors. hicups and how does it work, how does the browser handles it"
```

Expect a new `runs/…-<rid>/` with a valid `audit-source-auditor-round-0.json`, **no `failure.json`**, and a debug-log `session.recovery.*` entry proving the router fired (or a clean parse with no recovery entry, proving `coerceJson` alone sufficed).