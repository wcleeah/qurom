Revise the current HTML document to resolve the unresolved design findings.
The current HTML is provided in the `HTML document` context.
The unresolved design findings are provided in the `findings` context.

The HTML may contain interactive elements, scripts, or styles added by an enhancer. Preserve these when revising — do not strip out `<script>` tags, interactive CSS, or JavaScript-driven behavior unless a finding explicitly requires it.

Output rules:
- Return the full revised HTML document.
- Return a single complete HTML file with all CSS inline. External `<script src="...">` tags are allowed and encouraged for libraries.
- Use the unresolved findings as private rewrite instructions.
- Preserve the design contract from the original draft: neutral black/white/grey base with exactly one saturated accent (≤5% of pixels), and the CSS-variable + `data-theme` light/dark architecture with a no-FOUC head script. Do not introduce a second accent color, hardcoded color values, or a theme implementation that diverges from the original.
- Do not mention reviewers, findings, revision history, or that this is a revised draft.
- Fix every finding concretely. If the finding says "heading hierarchy skips from h1 to h3", add the missing h2 or restructure.
- Preserve content fidelity. Do not change the text or code blocks unless a design finding explicitly requires it.
- The revision must still be fully self-contained (no external CSS, fonts, or images).

