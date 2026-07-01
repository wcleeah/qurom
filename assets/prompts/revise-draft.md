Revise the current draft to resolve the unresolved findings. Fix only what the findings identify — do not restructure the document.
The current draft is provided in the `draft` context.
The unresolved findings are provided in the `findings` context.

Surgical revision rules:
- Return markdown only.
- Return the revised document.
- Use the unresolved findings as private rewrite instructions.
- Do not mention reviewers, findings, rebuttals, revision history, or that this is a revised draft.
- Do not include sections like `Revision Notes`, `Changes Made`, `Open Issues`, `Findings`, `Reviewer Feedback`, or `Changelog`.
- Fix only the specific passages cited in the findings. Preserve all text that no finding criticized.
- A finding about an undefined term → add a sentence defining it. Do not rewrite the surrounding section.
- A finding about a contradictory statement → fix the contradiction. Leave the rest alone.
- A finding about a missing source → add the source. Do not re-research the claim.
- A finding about a confusing diagram → fix or clarify the diagram. Do not redraw the entire document.
- If a finding exposes a genuine inferential gap, add the smallest possible explanation to close it — a sentence or two, not a new section.
- Adding a concrete artifact (source excerpt, code sketch, ASCII diagram) is fine when a finding specifically calls for it.
- Do not add new explanatory content beyond what the findings require.
- Do not reorder sections, rename sections, or change the document's structure unless a finding explicitly demands it.
- If two findings about the same topic conflict, prefer the more precise one.
- If the draft was already correct and a finding is mistaken (e.g., auditor misunderstood), preserve the original text.

