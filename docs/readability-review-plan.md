# Readability review gate (Jev)

Pre-audit verification loop using TypeSafe Jev. Not an auditor. Native scores, not findings. Clarity still owns comprehension.

This file is the implementation contract.

## Flow

```
draftFullDraft
  → scoreReadability              // Jev only
       ├─ 0 hotspots           → runParallelAudits     // no drafter call
       └─ hotspots && try < max
            → reviseReadability  // drafter, readability review prompt
            → scoreReadability   // again
  → …quorum unchanged…
  → reviseDraft                   // findings only — no Jev hints
  → scoreReadability              // same gate
       └─ (same skip / loop)
  → runParallelAudits
```

**Pass** = zero hotspots. Jev always scores the current draft. Skip only the **drafter** call when there is nothing to fix.

On `maxTries` with leftovers: proceed to audit, keep the report, warn in live status.

Skip the whole gate (draft → audits) if `readability.enabled` is false or `TYPESAFE_API_KEY` is missing. If enabled and the API still fails after SDK retries, fail the node.

## Graph: a new node

**LangGraph:** two nodes, one visible pipeline step (same pattern as reader discovery).

| LangGraph node | Does | Calls an agent? |
|---|---|---|
| `scoreReadability` | Segment, Jev, write report, derive hotspots | No |
| `reviseReadability` | Drafter rewrite from hints | Yes, only if routed here |

**Edges**

- `draftFullDraft` → `scoreReadability`
- `reviseDraft` → `scoreReadability` (not straight to audits)
- `scoreReadability` → `runParallelAudits` if 0 hotspots **or** fuse
- `scoreReadability` → `reviseReadability` if hotspots and `try < maxTries`
- `reviseReadability` → `scoreReadability`

**UI `GRAPH_NODES`:** one research node, between Draft and Parallel audits:

```
id: readabilityGate
label: Readability review
miniLabel: Readability
liveNodeAliases: ["scoreReadability", "reviseReadability"]
filePatterns: readability-round-N-try-M.json, draft-round-N-readability-M.md
roundScoped: true
```

Not in `AUDITOR_ROLES`. No vote, rebuttal, or `findingId`.

Quorum `state.round` does **not** increment on Jev-revise.

Research status: `scoring_readability` / `revising_readability`. Reset `readabilityTry` to 0 at the start of each gate (after draft and after auditor revise).

## Hotspot

Code-only. A paragraph is a hotspot iff **all** of:

1. At least one Score **trips** (configurable threshold + confidence).
2. Matching justification Noul does **not** save it (configurable).
3. Remedy ≠ `keep`.

## Jev call

`@typesafe-ai/sdk`, one `systemOne` per paragraph, all questions in that call. Client once per run.

**State:** `{ unit, section, before, after, article_job, reader, audience, register }`

`audience` is a constant: the reader is fluent but not a native English speaker. `register` is technical research prose for that reader.

**Scores:** convolution, inversion, diction, formality, density (levels 0–2)

**Nouls:** `inversionEarned`, `densityIsOneMove`, `dictionIsDomainTerm`

**Choice:** `remedy` = unnest | split | uninvert | simplify_words | lower_register | keep

Skip `## Sources`, fences, tables, heading-only / empty blocks. Pool ~8 parallel paragraph calls.

## Config (thresholds included)

`quorum.config.json` + config UI form:

```json
"readability": {
  "enabled": true,
  "model": "jev-latest",
  "maxTries": 5,
  "scoreTrip": 1.3,
  "scoreConfidence": 0.5,
  "formalityTrip": 1.6,
  "noulVeto": 0.4
}
```

| Field | Meaning |
|---|---|
| `scoreTrip` | Score ≥ this trips (except formality) |
| `formalityTrip` | Higher bar; research prose may be stiff |
| `scoreConfidence` | Ignore Score below this confidence |
| `noulVeto` | Noul ≥ this **saves** the unit |
| `maxTries` | Score+revise loops per quorum round |

Env: `TYPESAFE_API_KEY`. Defaults as above.

## Prompt: configurable readability review

First-class prompt asset:

```
researchDrafterReadabilityRevise
  file: research-drafter.readability-revise.md
  role: research-drafter
  label: Readability review
```

Shows under research-drafter on Config → Prompts. Placeholder `{readabilityHints}`. **No mention of auditors, quorum, findings, or votes.** Frame it as a readability review.

Default seed: apply local edits in the review notes, or leave a passage when the marked style is doing work; length-neutral; return a clean article; do not mention this review.

`{readabilityHints}` when the agent is called (never called with zero hotspots):

```markdown
## Readability review

Local processing notes. Ignore one when the marked style is doing work.

Remedy: unnest = flatten clauses, keep the paragraph; split = more than one move; uninvert = restore subject–verb order; simplify_words = same claim, plainer diction; lower_register = drop performative formality only.

- [s3-p2] Wire format — convolution 2.1 (conf 0.74); remedy: unnest
  That which the protocol conceals, the wire format makes inevitable:
```

**All** hotspots, no cap. One bullet per tripped criterion.

Auditor `research-drafter.revise.md` is unchanged (no hints). Draft prompt: no Jev rubric. Clarity audit: one fence (throughline/idea-density vs packed syntax of one idea).

## Artifacts

```
draft-round-0.md
readability-round-0-try-0.json          # always written after Jev (or skip)
readability-round-0-try-0.jev.json      # raw SDK responses when scored
draft-round-0-readability-1.md          # only if a revise happened
readability-round-0-try-1.json
```

Report: units (scores, gates, remedy) + `hotspots[]` + `passed` + `try` + optional `skipped`. Native schema, not findings.

## UI

Not an auditor card. Dedicated readability review.

1. **Pipeline** — node between Draft and Parallel audits; active while scoring or revising; complete when that round has a passing try (or fuse/skip).
2. **Node page** — each try: pass/needs-edit, hotspot count, model, try index.
3. **Report** (prettified, not raw JSON as the primary view):
   - Summary chips: passed / N hotspots / try M / skipped
   - Hotspots first: section, unit id, quote, tripped criteria with Score + confidence, remedy chip
   - All units as a heatmap (five score bars 0–2, dim if below trip)
   - Expand a unit for legend, Nouls, full probabilities
   - Multi-try: list tries, latest selected
   - Skip/error states (disabled, no key, API failure)
4. **Config** — Readability section on the quorum form (enable, max tries, four thresholds, model).
5. **Prompts** — “Readability review” under research-drafter.
6. **Live status** — `scoreReadability` / `reviseReadability` resolve to this node. Cursor call scope maps `draft-round-N-readability-M.md` to `reviseReadability`.

Do not reuse blocker/major/minor styling.

## Tests (mock SDK `fetch`)

- Segmentation skips sources/code/tables
- Hotspot math honors config thresholds, formality bar, Noul veto, `keep`
- 0 hotspots → **drafter not called** → audits
- Hotspots → revise → re-score
- `maxTries` → audits with leftovers, no extra agent call
- Disabled / no key → skip to audits
- Prompt asset loaded from store; `{readabilityHints}` substitution
- `AUDITOR_ROLES` / `unresolvedFindings` unchanged
- View: pipeline placement, report renderer (pass vs hotspots vs skip), config form fields

## Files

- `src/typesafe/client.ts`
- `src/readability/{criteria,segment,score,hints,schema}.ts`
- `src/graph.ts` — two nodes + edges
- `src/config.ts`, quorum form, defaults migrate
- `src/prompt-asset-defs.ts` + `defaults/prompts/research-drafter.readability-revise.md`
- View node registry, run-artifacts, renderer, styles, live-status/scope
- Tests under `tests/readability-*.test.ts` plus view/config/graph coverage
- `docs/architecture.md` — node in the research loop

No `readability-auditor` agent. Questions live in code; the only prompt is the drafter’s readability review.
