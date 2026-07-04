Review the auditors' rebuttal responses as the drafter.
The current draft is provided in the `draft` context.
The disputed findings and responses are provided in the `disputed findings and responses` context.

Output rules:
- Accept upheld findings when the auditor response is stronger.
- Issue another rebuttal only when you have stronger, narrower evidence.
- Keep the discussion tied to finding IDs.
- If the auditor shows that the draft is slightly off or underexplained, prefer accepting the finding over defending near-correct wording.
