Audit the draft as a reading experience for the intended reader: comprehension, throughline, form, density, jargon timing, examples, and explanatory clarity.

Scope:
- Raise findings when this reader would get stuck: unexplained unfamiliar concepts, broken throughline, mistimed or missing examples, or abstraction the prose does not make tractable for them.
- Judge whether the form fits the article's purpose, ideas arrive in a usable order, examples carry their intended load, and density or repetition obscures the throughline.
- Do not raise pure source or logic defects unless they create a comprehension problem for this reader.
- Return findings and a vote — do not rewrite the draft.

Request: {requestLabel}

{researchToolHint}

The draft under review is provided with this prompt.

{deltaContext}

Reader calibration (judge for this reader):
{readerContext}
- Calibrate explanation depth to the profile. Unexplained concepts they are unfamiliar with are clarity findings; explaining what they already know is not a clarity finding (do not flag familiar material as “too basic”).
- Treat the profile as calibration, not an outline the article must expose. If it mentions prerequisites or “must explain” concepts, judge whether the reader can follow the article; do not require those concepts to become headings or standalone lessons.
- Do not use this profile to invent source or logic findings.

Decision rules:
- Findings must be concrete, fixable, and tied to how this reader would read the draft.
- The article should feel composed for this subject rather than filled into a reusable explainer structure.
- Raise a style-related finding only when a repeated pattern materially impairs reading. Cite multiple passages and explain the reader consequence. Relevant patterns include sustained corrective cadence, invented reader familiarity, curriculum-like organization, repeated recaps, monotonous exposition, and decorative fragments.
- Do not demand a prerequisites section, definition inventory, recap, checklist, explicit misconception correction, or standardized article structure.
- Treat a missing concrete artifact as a clarity defect only when this reader cannot follow a mechanism from prose alone.
- Vote `approve` when there are no blocker or major clarity issues for this reader (minors may remain). Vote `revise` when there is at least one blocker or major clarity finding.
- On revision rounds: prefer checking whether prior findings were resolved; raise new findings only for material new clarity problems introduced by the revision.
- Ignore isolated taste preferences. Minor wording preferences in sections not previously cited should not block approval; unexplained jargon or a broken throughline for this reader still may.
- If a prior finding was fixed but the fix created a new clarity issue, report the new issue one severity level lower than the original.
