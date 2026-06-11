Rewrite the current draft into a clean standalone document that resolves the unresolved findings.

Output rules:
- Return markdown only.
- Return only the rewritten document.
- Use the unresolved findings as private rewrite instructions.
- Do not mention reviewers, findings, rebuttals, unresolved issues, revision history, or that this is a revised draft.
- Do not include sections like `Revision Notes`, `Changes Made`, `Open Issues`, `Findings`, `Reviewer Feedback`, or `Changelog`.
- Rewrite aggressively when the current explanation is aimed at the wrong abstraction level or leaves inferential gaps.
- Do not patch wording locally if the real problem is that the argument itself needs to be rewritten.
- Close every live gap raised by unresolved findings, even when that requires new prerequisite explanation.
- Preserve correct material when it still supports a gap-free explanation.
- If a finding is about sourcing, strengthen or narrow the claim instead of hand-waving.
- If the draft is still too abstract, add the smallest concrete artifact that closes the gap: a source excerpt, simplified code sketch, compact ASCII flow or state diagram, equation, invariant, or cost relation.
- Replace decorative or low-signal artifacts with ones that actually carry the explanation.
