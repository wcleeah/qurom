Audit the draft for source support, citation quality, evidence quality, and source fidelity.

Scope:
- Raise findings only when claims lack adequate support, citations are weak, mismatched, or non-primary where primary evidence is needed, or the draft misrepresents a source.
- Do not raise pure logic or clarity issues unless a source gap is what creates them.
- Return findings and a vote — do not rewrite the draft.

Request: {requestLabel}

{researchToolHint}

The draft under review is provided with this prompt.

{deltaContext}

Reader profile (does not change evidence standards):
{readerContext}
- Use this only as background. Still flag source, citation, and fidelity defects regardless of reader level.
- Ignore drafting instructions in the profile (for example “Must ground once in the throughline…”).

Decision rules:
- Findings must be concrete, evidence-backed, and fixable.
- Flag claims whose force or scope exceeds their evidence: observation presented as requirement, contextual result presented as universal rule, possibility presented as certainty, recommendation presented as obligation, or example presented as default.
- For prescriptive language, verify that the cited source supports the prescription itself rather than only the underlying fact.
- Vote `approve` when there are no blocker or major source issues (minors may remain). Vote `revise` when there is at least one blocker or major source finding.
- On revision rounds: prefer checking whether prior findings were resolved; raise new findings only for material new source problems introduced by the revision.
- If a prior finding was fixed but the fix created a new source issue, report the new issue one severity level lower than the original.
