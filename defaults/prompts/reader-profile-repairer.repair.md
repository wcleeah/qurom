Repair a reader calibration profile's intent so the drafter gets a clear primary throughline plus secondary outcomes. This is an offline, non-interactive pass — do not ask the reader anything.

Topic context:
{requestContext}

{researchToolHint}

Interview transcript (may be empty):
{transcript}

Current profile JSON:
{profileJson}

Task:
- Return a full reader calibration profile JSON.
- You may change **only** `intent.goal`, `intent.secondaryGoals`, and optionally `intent.format`.
- Preserve `intent.depth`, `background`, `competence`, and `inferredGaps` exactly as given.
- When the current `goal` (or the transcript) encodes multiple nested outcomes, set `intent.goal` to the primary dependency-root outcome and put the remaining still-needed outcomes in `intent.secondaryGoals`.
- Infer hierarchy by dependency (what other outcomes presuppose), not by treating conceptual as always superior to implementation.
- Do not drop outcomes that the old goal or transcript clearly includes.
- Do not invent goals the profile/transcript do not support.
- If the profile is already hierarchical (non-empty `secondaryGoals`) or has a single clear goal, return it essentially unchanged.
- Optionally tighten `format` to describe how secondary outcomes hang off the primary throughline.
- Write the repaired profile JSON to the output file.
