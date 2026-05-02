Write the first full deep dive draft directly from the request and gathered evidence.

Output rules:
- Return markdown only.
- Produce one coherent argument, not a stitched set of section mini-essays.
- Choose the structure that best fits the topic. Do not mirror a stock deep-dive template unless the topic genuinely wants it.
- The only required top-level heading is `## Sources`.
- Resolve live questions when they arise; do not defer them just because a later section could cover them.
- If the draft uses a term or mechanism to support a claim, explain that term or mechanism before relying on it.
- Keep the final prose focused on closure, not on symmetrical section coverage.
- Put the most depth on the main causal chain first. Do not spend more effort on side branches, taxonomy, or cleanup sections than on the answer itself.
- Avoid duplicating the same explanation under separate headings like mechanism, evidence, and misconceptions unless each pass adds new information.
- Use the smallest load-bearing concrete artifact when prose alone would stay too abstract: an exact source excerpt, a simplified code sketch, an ASCII flow or state diagram, or an equation, invariant, or cost relation.
- When quoting real code, keep only the lines that matter, then explain what each important line does in this argument.
- When source code is too noisy, pair a small real excerpt with a simplified sketch instead of paraphrasing the whole mechanism abstractly.
- If the behavior depends on order, queues, wakeups, handoffs, or state transitions, prefer a compact ASCII rendering.
- If the claim is quantitative or comparative, prefer an explicit relation over prose-only adjectives.

Structure guidance:
- A good draft may be a code walkthrough, a running example, a misconception ladder, a compare-and-reconcile explanation, or a few sharply chosen sections.
- Use headings only when they help the reader track the argument.
- If the opening answer can carry the piece for a while, stay in that flow instead of inserting headings too early.
- If a heading exists, it should mark a real change in question, not a required template slot.

Concrete artifact guidance:
- A concrete artifact can be a source excerpt, simplified code sketch, ASCII diagram, equation, invariant, or compact table.
- Do not leave the artifact uninterpreted. Walk the reader through the important lines, states, or terms.
- Do not force every section to have the same artifact type. Pick the one that makes the mechanism easiest to reason about.

While drafting, keep asking:
- What exact question would this reader ask next?
- Which sentence here is slightly off even if broadly correct?
- Where does this paragraph rely on a term or claim that has not been fully cashed out yet?
- Where would one small code block, ASCII diagram, or equation eliminate two paragraphs of abstract explanation?
- Which part deserves the most depth to reach the finish line, and which tempting side path should stay short or be cut?
