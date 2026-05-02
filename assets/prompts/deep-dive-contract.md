Write a source-backed deep dive for a gap-sensitive technical reader.

Non-negotiable contract:
- Follow one clear line of reasoning from the starting confusion to a finish line the reader can explain back in plain English.
- Match the abstraction level of the question. If the question asks for mechanism or implementation, do not answer with architecture or taxonomy first.
- Prefer exact words over broad labels. Naming a thing is not explaining it.
- Treat every introduced term as debt. If the draft uses a term to advance the argument, it must explain that term before relying on it.
- Make every important inferential link explicit. If sentence B depends on sentence A, say why.
- Prefer plain language over abstract wording. Define jargon on first use in the exact sense used here.
- Reuse one small running example when possible, but fully explain sibling mechanisms too when they are required to keep the explanation true.
- Prefer the smallest concrete artifact that closes the gap: an exact source excerpt, a simplified code sketch, an ASCII control-flow or state diagram, or an equation, invariant, or cost relation.
- When the question is about runtime behavior, control flow, or implementation mechanics, show the mechanism concretely before or while naming it.
- Tie non-obvious claims to evidence from primary sources when available.
- Distinguish confirmed claims from inferred or uncertain ones when needed.
- Shape the document around the topic, not around a fixed template. Use only the headings that help this specific explanation land.
- Keep sections purposeful: each section must either close a live gap, establish a prerequisite, or support a later claim that would otherwise be underexplained.

Source and certainty rules:
- Prefer sources in this order when possible: source code, official docs, specs or standards, then high-quality technical articles or maintainer comments.
- Match source specificity to claim specificity. If the draft uses exact implementation language, back it with exact implementation evidence.
- Do not dump links only at the end. Tie important claims to evidence in the body, then collect them again in `## Sources`.
- Explicitly label claims as `Confirmed`, `Inferred`, or `Speculative` when the certainty level matters.
- If something was not directly verified, say so.

Usefulness rules:
- Do not include a fact just because it is relevant. Include it only if it advances the argument, closes a gap, explains a failure mode, clarifies a term, or helps the reader predict real behavior.
- Do not add decorative snippets, diagrams, equations, or tables. Include them only when they do explanatory work that plain prose would do worse.
- If a sequence, handoff, queue movement, state transition, or causal chain matters, prefer a compact ASCII rendering over vague prose alone.
- If the draft makes a quantitative, complexity, timing, or resource claim, prefer showing the relation explicitly when that sharpens understanding.
- If one section must do most of the explanatory work, let it. Do not force balanced coverage.
- If a section is true but does not change the reader's understanding, cut it or move it out of the main line of reasoning.
- Do not explain the same mechanism twice in two different structural buckets unless the second pass adds genuinely new value.
- Put the deepest detail where the main answer actually needs it, not where a generic article template would normally put it.

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
- Do not end without a final `## Sources` section.
- Do not stop at a sentence that is merely broadly correct when a more exact sentence is needed.

Final quality check:
- The starting point, driving question, and finish line are explicit.
- Every major section advances the argument.
- Every important term is defined before the draft relies on it.
- Every complex section has a concrete example.
- Every mechanism-heavy section uses a concrete artifact when that would close the gap faster than prose alone.
- Every major non-obvious claim has a source.
- No important term is still acting as an unexplained placeholder.
- No major sentence would trigger an obvious "what exactly do you mean here?" follow-up from a gap-sensitive reader.
- No paragraph is true but non-load-bearing for the actual understanding goal.
- The structure fits this topic instead of mirroring a stock deep-dive outline.
- The draft does not spend more depth on side branches than on the main answer.
