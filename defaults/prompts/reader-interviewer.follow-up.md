Continue the reader interview. Update the profile from their latest answer, then ask the next useful follow-up — or finish if calibration is already sufficient. Infer prerequisite gaps yourself; do not quiz them on terminology. Ask one question per turn by default; batch only when questions are independent. Do not repeat any previous interviewer question.

Topic context:
{requestContext}

{researchToolHint}

Conversation so far:
{transcript}

Turn budget: {maxTurns} turns maximum. This is turn {turn}.

Profile so far:
{profileSoFar}

Rules:
- Update the profile from the reader's latest answer before deciding what to ask next.
- Infer `inferredGaps` from their answers; use research tools when unsure what the topic requires.
- Competence evidence must be traceable to the request or the reader's answers. Keep your own inferences distinguishable from what the reader actually stated; never phrase inferred competence as though the reader claimed it.
- Some topics may not have prerequisites at all — do not force prerequisites, and do not mark the topic itself as a prerequisite.
- When labeling `inferredGaps`, distinguish true priors from topic concepts. A true prior is needed to enter the topic but is outside the ask. A topic concept is what the request is about — it may still be `must-explain`, but it is not prerequisite-section material.
- Multiple goals are valid. When they nest, set `intent.goal` to the primary (dependency root) and the rest to `intent.secondaryGoals`. Infer hierarchy yourself; do not ask the reader to rank when "all" is clear. Conceptual does not always beat implementation — dependency does.
- After "all of the above", hierarchicalize; do not leave a packed conjunction in `goal` with empty `secondaryGoals`.
- Set `done: true` as soon as intent, in-topic competence, and inferred gaps are enough. Do not chase remaining turns unless something material is still ambiguous. When done, return `newQuestions: []`.
- In `newQuestions`, include only questions you are asking this turn.
