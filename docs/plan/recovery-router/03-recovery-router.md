# Phase 3 — The `RecoveryRouter` (D → A/B/C Classified Recovery)

## Execution Snapshot

- **Phase:** 3
- **Source plan:** RecoveryRouter plan, Phase 3
- **Readiness status:** `Ready` once Phases 1 & 2 are merged.
- **Primary deliverable:** A single in-session recovery loop in `promptAgent` that classifies each failure as `nooutput` / `truncated` / `syntax` / `schema` / `transport` and routes to the matching recovery action (A re-prompt same agent / B same-agent-with-zod-issues / C `json-fixer` on disk), with `coerceJson` as a free pre-clean, bounded budgets, and a typed `StructuredRecoveryError`.
- **Blocking dependencies:** Phase 1 (`coerceJson`, reachable catches), Phase 2 (categorized `readOutputFile` + `transport.*` seams) — `Unknown` until those merge.
- **Target measurements:** Per-fault budgets; `json-fixer` never invoked for a `schema` fault.
- **Next phase:** `04-outer-fresh-session-restart-auditors.md` (Phase 3.5).

## Why This Phase Exists

Phases 1 & 2 only *unblock* recovery; the existing catch bodies still route **every** failure to one dumb action — `json-fixer` for files, the same agent with a generic "fix your JSON" prompt for inline. That is wrong for two large classes:

- **Schema / semantic mismatches** (scenarios #4, 10–14: enum drift, `superRefine` approve-with-findings, wrong nested type, renamed keys) — `json-fixer` only fixes **syntax** and will never resolve semantic errors. The original agent, given the **specific zod issue path**, is the correct fixer.
- **No-output / truncated / transport** (Phase 2's categories) — bytes don't exist or are cut off; you can't "fix JSON" that isn't there. The same agent must be re-prompted to write / continue.

Phase 3 installs a router that picks the right action per failure class and exports the typed error that Phase 3.5's fresh-session restart matches on.

## Start Criteria

- Phase 1 merged: `coerceJson` used inside `parseStructuredResponse`; both `return await parseAndReturn(...)` edits present; `bun test` green.
- Phase 2 merged: `readOutputFile` returns the discriminated union; `Continue` retry bounded + non-swallowing; outer transport retry in place; `transport.*`-prefixed throws present; `bun test` green.
- `json-fixer` agent is configured (`.opencode/agents/json-fixer.md`) with `edit: "runs/**/*.json": allow` (Confirmed) — Phase 3's C branch relies on it.
- The run-output dir (`state.outputPath` / `outputPath`) is pre-created by callers via `writeRunJsonArtifact` (Confirmed from `design-quorum.ts`, `graph.ts`); the only subdir Phase 3 may create is `.repair/`.

## Dependencies And How To Check Them

| Dependency | Why it matters | How to verify | Status |
|---|---|---|---|
| Phase 1 deliverables | Router reuses `coerceJson` as D-tier; reachable catches required | See `01-…md` Done Criteria | `Unknown` (gated by merge) |
| Phase 2 deliverables | Classifier consumes `readOutputFile.reason` + `transport.*` strings; transport retry wraps sendPrompt | See `02-…md` Done Criteria | `Unknown` (gated by merge) |
| `json-fixer` agent permissions | C branch writes under `runs/<rid>/.repair/*.json`; agent must be allowed to edit | `cat .opencode/agents/json-fixer.md` shows `edit: "runs/**/*.json": allow` | `Done` |
| zod schemas expose `issue.path` + `issue.message` | B branch feeds `zodError.issues` to the original agent | `zod` v3 docs + `tests/schema.test.ts` already uses `result.error.issues` | `Done` (zod 3.24 in `package.json`) |
| `superRefine` rules, not `.strict()` | Confirms "schema failure" = semantic, not "extra keys stripped" | `grep -n "superRefine\|\.strict" src/schema.ts` — many `superRefine`, no `.strict` | `Done` |
| A parent run dir path is accessible inside `promptAgent` | Needed to construct `runs/<rid>/.repair/…` paths | `promptAgent` has `input.outputFile` from which `<rid>`/dir can be derived (`path.dirname(outputFile)` gives the runs/<rid> dir for audits) | `Done` (Derived: `outputFile` like `runs/<rid>/audit-<agent>-round-<n>.json`) |

## Target Measurements And Gates

| Measurement | Threshold | Method | Gate | Status |
|---|---|---|---|---|
| `schema` fault does NOT invoke `json-fixer` | zero C-branch calls | Stubbed client; force enum drift; assert `json-fixer` agent is never passed to `prompt` and same-agent is re-prompted once with zod issues in the prompt | Exit | `Unknown` |
| `json-fixer` budget | ≤ 2 attempts per fault | Counter on C-branch invocations in stubbed test | Exit | `Unknown` |
| Same-agent (A/B) budget | ≤ 2 attempts per fault | Counter on same-agent re-prompts in stubbed test | Exit | `Unknown` |
| Free-tier (D) resolves fence/prefix with 0 LLM calls after the initial | `client.session.prompt` called exactly once total for a fenced-only failure | Stubbed client returning fenced JSON; assert prompt count == 1 and parse succeeds | Exit | `Unknown` |

## Scope

- `src/opencode.ts`:
  - Add `class StructuredRecoveryError extends Error { fault, attempts }` and throw it on budget-exhaustion (replaces Phase 2's `transport.*` string-prefixed throws — fold them into the typed class).
  - Add `classifyFault(err): Fault` (using zod's `ZodError` vs `SyntaxError` vs Phase-2 `transport` signals vs `ReadResult.reason`).
  - Add `repairWithJsonFixer({ badText, outputFile, schema, … })` — writes to `runs/<rid>/.repair/<agent>-<round>-<attempt>.json`, runs `json-fixer`, reads back, returns parsed struct; mkdirs `.repair/`; bounded 2×.
  - Add `repromptSameAgent({ kind, schema, error, source })` — builds prompts per `kind`:
    - `nooutput`: "You were asked to write to `<outputFile>`. You wrote nothing. Write the file now."
    - `truncated`: "Your previous output was cut off mid-JSON. Continue exactly from the last character; do not repeat earlier content."
    - `schema`: `buildStructuredRepairPrompt` augmented with `<zod_issues>{path, message}[]</zod_issues>` + "the JSON parsed but does not match the schema — correct the values, keep the structure."
    - inline-when-file-wanted (#2): also instruct "write to the file, do not reply inline."
  - Replace the two existing catch bodies with a single bounded loop over D → classify → A/B/C → loop, ending in `StructuredRecoveryError` on budget exhaustion.

## Out Of Scope

- Fresh-session restart (Phase 3.5) — Phase 3 only throws `StructuredRecoveryError`; the caller-layer restart is added in 04.
- Persisting inline→file when parsed OK (Phase 4).
- Systemic-drift detector (Phase 6).
- Renaming `promptAgent`'s public type. `StructuredRecoveryError` is **additive** (new exported class); `promptAgent` still returns the same envelope on success.

## Implementation Details

### `StructuredRecoveryError`

```
export type Fault = "nooutput" | "truncated" | "syntax" | "schema" | "transport"
export class StructuredRecoveryError extends Error {
  readonly fault: Fault
  readonly attempts: number
  readonly lastError: unknown
  constructor(fault, attempts, lastError, msg?) { super(msg ?? `${fault}_unresolved (attempts=${attempts})`); this.fault = fault; this.attempts = attempts; this.lastError = lastError; this.name = "StructuredRecoveryError" }
}
```

Migrate Phase 2's `transport.*` string throws to `throw new StructuredRecoveryError("transport", …)` here so all categorized failures share one type. The Phase-3.5 wrapper matches on `instanceof StructuredRecoveryError`.

### `classifyFault`

```
function classifyFault(err: unknown): Fault {
  if (err instanceof StructuredRecoveryError) return err.fault          // already categorized upstream (transport)
  if (err instanceof z.ZodError) return "schema"
  if (err instanceof SyntaxError) {
    // distinguish truncated: coerceJson found no balanced close
    // (we can't easily inspect.rawValue here, so use err.message heuristics:
    //  "Unexpected end of JSON" / "Expected property name or '}'" at end → "truncated")
    return looksTruncated(err.message) ? "truncated" : "syntax"
  }
  // Phase-2 ReadResult.reason → fault mapping
  return "nooutput"
}
```

`looksTruncated` is a small message heuristic; Phase 3's Open Question below resolves whether the SDK exposes `finishReason` to make this exact.

### The loop (replaces both existing catch bodies)

```
const budget = { sameAgent: 2, jsonFixer: 2 }   // per-fault; reset when a different fault occurs (progress)
let raw: string = fileFirst ? (read.ok ? read.text : inlineText /* remember read.reason */) : inlineText
let attempt = 0
for (;;) {
  attempt++
  try {
    return await parseAndReturn(input.schema, raw, sourceLabel)   // D runs inside via coerceJson
  } catch (e) {
    const fault = classifyFault(e)
    if (fault === "transport") throw new StructuredRecoveryError("transport", attempt, e)
    if (fault === "nooutput" || fault === "truncated") {
      if (budget.sameAgent <= 0) throw new StructuredRecoveryError(fault, attempt, e)
      budget.sameAgent--
      raw = (await repromptSameAgent({ kind: fault, sourceLabel, ... })).text
      continue
    }
    if (fault === "schema") {
      if (budget.sameAgent <= 0) throw new StructuredRecoveryError("schema", attempt, e)
      budget.sameAgent--
      raw = (await repromptSameAgent({ kind: "schema", error: e, schema: jsonSchema, ... })).text
      continue
    }
    if (fault === "syntax") {
      if (budget.jsonFixer <= 0) throw new StructuredRecoveryError("syntax", attempt, e)
      budget.jsonFixer--
      raw = (await repairWithJsonFixer({ badText: raw, outputFile: repairFilePath(input), schema: input.schema, ... })).text
      // raw is re-read from disk inside repairWithJsonFixer; D re-runs next iteration
      continue
    }
    throw new StructuredRecoveryError("nooutput", attempt, e)  // unreachable
  }
}
```

`repairFilePath(input)` derives `runs/<rid>/.repair/<agent>-<round>-<attempt>.json` from `path.dirname(input.outputFile)` so auditors' repair files land next to their primary output.

`repromptSameAgent` calls `sendPrompt` in the **current** `activeSessionID` (in-session recovery; the fresh-session tier is Phase 3.5, deliberately a caller-layer concern).

### Removal of the old agent-swap hack

The current file-branch catch mutates `input.agent = "json-fixer"` mid-flight. Delete that; `repairWithJsonFixer` builds its own `json-fixer` session internally (or reuses `sendPrompt` with the `json-fixer` agent) without touching `input.agent`. The inline branch no longer asks the same agent to fix generic JSON — it now routes `schema` to B (zod issues) and `syntax` to C.

## Execution Checklist

- [ ] Add `StructuredRecoveryError` (exported) + `Fault` type to `src/opencode.ts`.
- [ ] Add `classifyFault(err): Fault`.
- [ ] Add `repairWithJsonFixer({ badText, outputFile, schema, ... })` — mkdirs `.repair/`, calls `json-fixer`, reads file back, returns `{ text }` (let the loop re-parse).
- [ ] Add `repromptSameAgent({ kind, schema?, error?, source })` — builds per-kind prompts and calls `sendPrompt` in the current session.
- [ ] Replace both existing catch bodies with the unified loop above.
- [ ] Migrate Phase 2's `transport.*` string-prefixed throws to `throw new StructuredRecoveryError("transport", …)`.
- [ ] Remove the old `input.agent = "json-fixer"` mutation hack.
- [ ] Augment `buildStructuredRepairPrompt` to embed `<zod_issues>` when `kind === "schema"`.
- [ ] `bunx tsc --noEmit` clean; `bun test` green (formal router matrix lands in Phase 5).

## Files And Systems Likely Affected

- `src/opencode.ts` — bulk of Phase 3's edits.
- `tests/opencode-event-bridge.test.ts` — likely needs a stub update if the existing stub returns `{ error: undefined, data: undefined }` (now throws); align to the SDK contract (`error` XOR `data`).
- No caller files in this phase (Phase 3.5 wraps the auditor caller).

## Verification

- `bunx tsc --noEmit` clean.
- `bun test` green.
- Manual matrix scratch (formal Phase 5 tests):
  - nooutput → A reprompt → valid.
  - truncated → A continue → valid.
  - fence-only → D, **one** `client.session.prompt` call, no repair.
  - unescaped quotes → C `json-fixer` → valid.
  - enum drift → **B** same-agent-with-zod-issues, **assert `json-fixer` never called**.
  - approve-with-findings (`superRefine`) → B (uses `auditResultSchema` end-to-end).
  - exhausted budget → final throw is `StructuredRecoveryError` with `fault` preserved.
- Regression: non-structured path (`schema: undefined`) still returns `{ text }` unchanged (no router involvement).
- End-to-end live (if opencode running): rerun the `010a399c` topic; expect no `failure.json` and either no recovery log entry (D resolved) or a single `session.recovery.classify` event (depending on which tier caught it).

## Done Criteria

- `StructuredRecoveryError` exists and is exported; Phase 2's `transport.*`-prefixed throws are replaced by it.
- Both old catch bodies are gone; the unified loop is the single recovery path.
- `repairWithJsonFixer` uses `json-fixer`; the in-place `input.agent` mutation is removed.
- Manual matrix above all passes; `bun test` green.
- The `schema`-fault → B-not-C invariant holds in the manual matrix.

## Handoff To Next Phase

- **Next phase:** `04-outer-fresh-session-restart-auditors.md` (Phase 3.5).
- **Artifact this phase leaves to the next:** the exported `StructuredRecoveryError` type — the Phase 3.5 wrapper matches on `instanceof StructuredRecoveryError` to decide whether to create a fresh session.
- **What becomes unblocked:** caller-layer "fresh session, restart the audit from scratch" escalation (the R tier) becomes implementable.

## Open Questions Or Blockers

- **Unknown (Phase 3 must confirm against `@opencode-ai/sdk/v2` types):** does the SDK expose a generation-level `finishReason`/stop-cause? If yes, `classifyFault` should detect `truncated` directly (the model hit max-output-tokens) instead of inferring from the malformed payload. If no, fall back to the message heuristic.
- **Inferred:** `path.dirname(input.outputFile)` reliably yields `runs/<rid>` for audit calls. Verify against `graph.ts:763` (`${state.outputPath}/audit-${agent}-round-${state.round}.json`) and `design-quorum.ts:178` (`design-audit-…`) — both produce a single nested child of `runs/<rid>`; `dirname` gives `runs/<rid>`. Confirmed shape.
- Assumption: `json-fixer` reusing one session across its bounded attempts is acceptable (its prompt is stateless). If its model statefully anchors on prior bad output, Phase 3.5's logic would apply to it too — out of scope here; elevate as a follow-up if observed.

## Sources

- `src/opencode.ts`: existing file/inline catch branches (~426, ~470), `buildStructuredRepairPrompt`, `buildFileRepairPrompt`, `parseAndReturn`.
- `src/schema.ts`: `superRefine` rules (`auditResultSchema`), enums; no `.strict()`.
- `.opencode/agents/json-fixer.md`: `edit: "runs/**/*.json": allow`, syntax-only mandate.
- `tests/schema.test.ts`: asserts the semantic rules the B branch must preserve.
- Plan: Phase 3 (RecoveryRouter), scenarios #4, #6, #10–14, #17–18, #20–21, #25.