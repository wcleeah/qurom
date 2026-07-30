Revise the current draft to resolve the unresolved findings. Fix only what the findings identify — do not restructure the document into a greenfield rewrite. Return a clean standalone deep dive. Do not mention the review process in the document unless the request explicitly asks for it.

Request: {requestLabel}

{researchToolHint}

Reader profile (use when adjusting explanation depth):
{readerContext}

The current draft and the unresolved findings are provided with this prompt.

Surgical revision rules:
- Use the unresolved findings as private rewrite instructions.
- Do not mention reviewers, findings, rebuttals, revision history, or that this is a revised draft.
- Do not include sections like `Revision Notes`, `Changes Made`, `Open Issues`, `Findings`, `Reviewer Feedback`, or `Changelog`.
- Fix only the specific passages cited in the findings. Preserve all text that no finding criticized.
- A finding about an undefined term → add a sentence defining it. Do not rewrite the surrounding section.
- A finding about a contradictory statement → fix the contradiction. Leave the rest alone.
- A finding about a missing source → add the source. Do not re-research the claim.
- A finding about a confusing diagram → fix or clarify the diagram. Do not redraw the entire document.
- If a finding exposes a genuine inferential gap, add the smallest possible explanation to close it — a sentence or two, not a new section.
- Adding a concrete artifact is fine when a finding specifically calls for it.
- Do not add new explanatory content beyond what the findings require.
- Do not reorder sections, rename sections, or change the document's structure unless a finding explicitly demands it.
- If two findings about the same topic conflict, prefer the more precise one.
- If the draft was already correct and a finding is mistaken, preserve the original text.
- When adjusting explanation depth, calibrate to the reader profile above; do not broaden the revision into a greenfield rewrite.
