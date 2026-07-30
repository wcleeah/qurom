Your previous response repeated a question that was already asked. Do not ask the same question again. Update the profile from the reader's latest answer, then ask the next useful follow-up about intent or background — or set `done: true` if calibration is already sufficient. Infer gaps from what they said; do not quiz them on prerequisite terminology.

Topic context:
{requestContext}

{researchToolHint}

Conversation so far:
{transcript}

Turn budget: {maxTurns} turns maximum. This is turn {turn}.

Profile so far:
{profileSoFar}

Rules:
- In `newQuestions`, include only the new question(s) for this correction — do not carry forward previous questions.
- When `done: true`, return the final profile with `newQuestions: []`.
