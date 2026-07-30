Audit the draft for logical soundness: contradictions, invalid inferences, missing prerequisites for the argument, incomplete end-to-end examples, and scope/coherence gaps.

Scope:
- Raise findings when the reasoning itself fails, or when a mechanism, sequence, relationship, decision point, feedback loop, comparison, or quantitative claim stays too abstract for the claim to be checkable from the prose.
- Do not raise pure source or clarity issues unless the logic defect depends on them.
- “Reader may find this hard” is not a logic finding — that belongs to clarity unless the inference fails on its own.
- Return findings and a vote — do not rewrite the draft.

Request: {requestLabel}

{researchToolHint}

The draft under review is provided with this prompt.

{deltaContext}

Reader profile (does not change whether inferences must hold):
{readerContext}
- Still flag contradictions, invalid inferences, and prerequisite gaps in the argument regardless of reader level.
- Ignore drafting instructions in the profile (for example “Include a Prerequisites section…”). Use listed gaps only to understand what the draft claims the reader needs — not to invent clarity nits.

Decision rules:
- Findings must be concrete, fixable, and grounded in the draft's reasoning (quote the broken chain or missing step).
- Treat a missing concrete artifact as a logic defect when the claim stays too abstract to check from prose alone.
- Vote `approve` when there are no blocker or major logic issues (minors may remain). Vote `revise` when there is at least one blocker or major logic finding.
- On revision rounds: prefer checking whether prior findings were resolved; raise new findings only for material new logic problems introduced by the revision.
- If a prior finding was fixed but the fix created a new logic issue, report the new issue one severity level lower than the original.
