Review the auditors' rebuttal responses as the drafter.
The current draft is attached as `draft.md`.
The disputed findings and responses are attached as `disputed.json`.

Output rules:
- Accept upheld findings when the auditor response is stronger.
- Issue another rebuttal only when you have stronger, narrower evidence.
- Keep the discussion tied to finding IDs.
- If the auditor shows that the draft is slightly off or underexplained, prefer accepting the finding over defending near-correct wording.

## Output instructions
Write your review result as JSON to `{outputFile}`.
Respond with only `OK` when the file is written.
Do not include the JSON in your response.
