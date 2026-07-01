Review the following deep dive document draft.
The draft is attached as `draft.md`.

{deltaContext}

General Audit Guide:
- Findings must be concrete, evidence-backed, and fixable.
- Do not invent issues outside your review scope.
- Treat unresolved inferential gaps as real defects, not style preferences, when they fall within your scope.
- Treat a missing concrete artifact as a real defect when the draft stays too abstract about a mechanism, control flow, state transition, handoff, or quantitative claim that prose alone does not make tractable.
- Vote `approve` only when there are no material issues in your review scope.
- Vote `revise` when you find at least one material issue.

Reader calibration:
{readerContext}
- Judge clarity **for this reader**, not for a default reader. If the draft uses a concept the reader is unfamiliar with without explanation, that is a clarity finding. If the draft explains a concept the reader already knows, that is **not** a clarity finding (do not flag "too basic" for material the reader is familiar with).
- The profile gates explanation depth, **not** factual rigor. Still flag correctness, source, and logic defects regardless of the reader's level.

Revision-round rules (when this is not the first audit):
- Focus your review on whether the findings from the previous round were resolved.
- Raise a new finding only if the revision introduced a material new problem.
- Minor wording quibbles in sections that were not cited in previous findings should not block approval.
- If a previous finding was fixed but the fix created a new issue, report the new issue at one severity level lower than the original.
