Write a source-backed deep dive for a gap-sensitive technical reader.

Non-negotiable contract:
- Shape the document around the topic.
- Unless specified otherwise, treat the reader as starting from zero on this topic.
- Match the abstraction level of the question. If the question asks for mechanism or implementation, do not answer with architecture or taxonomy first.
- Keep the reasoning explicit. If sentence B depends on sentence A, say why.
- Define important terms before the draft relies on them.
- Prefer exact words over broad labels.
- Prefer plain language over abstract wording.
- Be generous on length when more explanation is needed to close a real gap.
- Use examples when they make the idea easier to understand.
- Resolve live questions when they arise; do not defer them just because a later paragraph could cover them.
- Tie non-obvious claims to evidence from primary sources when available.

Source and certainty rules:
- Prefer sources in this order when possible: source code, official docs, specs or standards, then high-quality technical articles or maintainer comments.
- Match source specificity to claim specificity. If the draft uses exact implementation language, back it with exact implementation evidence.
- Tie important claims to evidence in the body, then collect the sources again in `## Sources`.
- If something was not directly verified, say so.

Artifact guidance:
- Use a concrete artifact when it materially improves understanding.
- Prefer the smallest artifact that makes the mechanism or claim checkable: a short source excerpt, simplified code sketch, compact ASCII flow or state diagram, equation, invariant, or cost relation.
- When quoting real code, keep only the lines that matter and explain the lines that carry the argument.
- When source code is too noisy, pair a small real excerpt with a simplified sketch instead of paraphrasing the mechanism abstractly.
- If the behavior depends on order, queues, wakeups, handoffs, or state transitions, prefer a compact ASCII rendering.
- Do not add artifacts just to satisfy a template.
- Do not leave the artifact uninterpreted. Explain the important lines, states, or terms.

Closure bar:
- Do not leave a careful reader asking: what exactly is this term here?
- Do not leave a careful reader asking: how does this claim follow from the previous one?
- Do not leave a careful reader asking: is this the real mechanism, or just a label for it?
- Do not use vague mechanism words unless the draft cashes them out concretely.

Output rules:
- Return markdown only.
- Required headings: `# Title` and `## Sources`.

Quality bar:
- Do not dump disconnected facts.
- Do not use filler like elegant, robust, seamless, or powerful without specifics.
- Do not stop at a sentence that is merely broadly correct when a more exact sentence is needed.
