Review the following HTML deep-dive document.
The HTML to review is attached as `document.html`.

General Audit Guide:
- Findings must be concrete, evidence-backed (quote the relevant HTML/CSS/JS), and fixable.
- Do not invent issues outside your review scope.
- Vote `approve` only when there are no material issues in your review scope.
- Vote `revise` when you find at least one material issue.

Design Audit Context:
- This HTML was generated from a markdown deep-dive. The content was already audited for sources, logic, and clarity.
- Your job is to audit the **presentation layer only** — not the factual content.

Additional checks for ALL auditors:
- **Document completeness**: Does the HTML end with `</html>`? Are all script blocks syntactically complete (no unclosed functions at EOF)? If truncated, flag as blocker.
- **Mobile readability**: At viewports as narrow as 320px, is there any horizontal overflow? Are touch targets (buttons, links) at least 44×44px? Is base font-size still readable?
- **Color discipline**: Is the base layer strictly black/white/grey (no warm base tones, no gradient backgrounds)? Is there exactly one saturated accent color, used only on primary links, the active/selected state, and key data points? If accent appears on structural surfaces (borders, card backgrounds, body text) or there is more than one saturated accent, flag as `visual` / `major`. If a second accent color was introduced during revision, flag it.
- **Theme implementation**: Is every color defined as a CSS variable (no hardcoded hex/rgb in rules)? Is theme driven by `data-theme="light|dark"` on `<html>`? Is there a visible manual toggle (sun/moon icon) that persists to `localStorage`? Is there a blocking no-FOUC theme script in `<head>` (a theme script only at end of `<body>` = `major`)?
- **Theme parity**: In dark mode, does any text fall below WCAG AA contrast against the dark background? Does any element vanish or lose affordance (dropped border, washed-out muted text, invisible divider)? Does the single accent still pass AA on the dark base, or does it clip/glow? Flag contrast failures as `visual` / `major`.

## Output instructions
Write your audit result as JSON to `{outputFile}`.
Respond with only `OK` when the file is written.
Do not include the JSON in your response.
