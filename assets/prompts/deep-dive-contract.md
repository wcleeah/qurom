Write a source-backed deep dive for a gap-sensitive technical reader.

Non-negotiable contract:
- Shape the document around the topic.
- Unless specify, treat the reader has no knowledge at the topic at all, explain everything from the ground up. 
- Keep the document coherent, keep the reasoning explicit, if there are multiple sections, make sure each section can be tied back to its parent. If the reasoning is implicit or hard to reason about, tell the reader the reasoning explicitly.
- Be generous on the document length, do not cut reasoning or explanation to shorten the document.
- If the document uses a term, api, concept, it must come with an explanation.
- Match the abstraction level of the question. If the question asks for mechanism or implementation, do not answer with architecture or taxonomy first.
- Prefer exact words over broad labels.
- Make every important inferential link explicit. If sentence B depends on sentence A, say why.
- Prefer plain language over abstract wording. Define jargon on first use in the exact sense used here.
- Provide example if a concept is better explained with it.
- Make use of artifacts: a source excerpt, a simplified code sketch, an ASCII control-flow or state diagram, or an equation, invariant, or cost relation, to demonstrate the actual behaviour/argument if possible.
- When the question is about runtime behavior, control flow, or implementation mechanics, show the mechanism concretely before or while naming it.
- Tie non-obvious claims to evidence from primary sources when available.
- Resolve live questions when they arise; do not defer them just because a later section could cover them.

Source and certainty rules:
- Prefer sources in this order when possible: source code, official docs, specs or standards, then high-quality technical articles or maintainer comments.
- Match source specificity to claim specificity. If the draft uses exact implementation language, back it with exact implementation evidence.
- Do not dump links only at the end. Tie important claims to evidence in the body, then collect them again in `## Sources`.
- If something was not directly verified, say so.

Concrete artifact guidance:
- Put the deepest detail where the main answer actually needs it, not where a generic article template would normally put it.
- If the draft makes a quantitative, complexity, timing, or resource claim, prefer showing the relation explicitly when that sharpens understanding.
- When quoting real code, keep only the lines that matter, then explain what each important line does in this argument. Add substantial amount of comment each line to explain the reasoning.
- When source code is too noisy, pair a small real excerpt with a simplified sketch instead of paraphrasing the whole mechanism abstractly.
- Provide excessive comment in source code block. Explain every api usage, reasoning for each line.
- If the behavior depends on order, queues, wakeups, handoffs, or state transitions, prefer a compact ASCII rendering.
- Do not leave the artifact uninterpreted. Walk the reader through the important lines, states, or terms.
- Do not force every section to have the same artifact type. Pick the one that makes the mechanism easiest to reason about.

Closure bar:
- Do not leave a careful reader asking: what exactly is `A` here?
- Do not leave a careful reader asking: how does `B` follow from `A`?
- Do not leave a careful reader asking: is this the real mechanism, or just the label for the mechanism?
- Do not postpone a live gap just because a later section could explain it.
- Do not use phrases like layer, mechanism, path, structure, handoff, or the runtime does X unless the draft cashes them out concretely.

Required structure:
- Use whatever heading structure best fits the topic and question.
- The only required top-level heading is `## Sources`.
- If headings hurt the flow, use fewer of them.

Quality bar:
- Do not dump disconnected facts.
- Do not use filler like elegant, robust, seamless, or powerful without specifics.
- Do not stop at a sentence that is merely broadly correct when a more exact sentence is needed.

While drafting, keep asking:
- What exact question would this reader ask next?
- Which sentence here is slightly off even if broadly correct?
- Where does this paragraph rely on a term or claim that has not been fully cashed out yet?
- Where would one small code block, ASCII diagram, or equation eliminate two paragraphs of abstract explanation?
- Which part deserves the most depth to reach the finish line, and which tempting side path should stay short or be cut?

Final quality check:
- Every major section advances the argument.
- Every important term is defined before the draft relies on it.
- Every complex section has a concrete example.
- Every mechanism-heavy section uses a concrete artifact when that would close the gap faster than prose alone.
- Every major non-obvious claim has a source.
- No important term is still acting as an unexplained placeholder.
- No major sentence would trigger an obvious "what exactly do you mean here?" follow-up from a gap-sensitive reader.
- No paragraph is true but non-load-bearing for the actual understanding goal.
- The structure fits this topic.
- The draft does not spend more depth on side branches than on the main answer.
