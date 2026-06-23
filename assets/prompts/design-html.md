Convert the provided markdown deep-dive document into a self-contained, beautifully styled HTML file.
The markdown content is attached as `content.md`.

Topic: {topic}

Non-negotiable contract:
- Aesthetic: Cool-toned minimal. Background: white or near-white (#fafafa). Body text: dark charcoal (#1a1a1a). Accent: one muted cool tone — slate, steel blue, or cool grey (#4a5568). No warm base tones (no cream, beige, warm grey). No background gradients. No backdrop-filter blur. Shadows: none, or a single 0 0 0 1px border ring — not soft layered shadows. Typography: sans-serif system fonts for body text. Functional highlights (phase colors, warnings, syntax tokens) are fine — the base layer stays cool and restrained; content layers can use color for meaning.
- Return a single complete HTML document. Every CSS rule must be inline. Zero external CSS dependencies.
- No CDN links for fonts or images. If you need icons or diagrams, draw them with inline SVG or CSS.
- You MAY use external `<script src="...">` tags to load JavaScript libraries from trusted CDNs (cdnjs, jsdelivr, unpkg). This is preferred over vendoring libraries inline — external scripts won't be truncated and will be security-audited separately.
- Prefer smaller, focused libraries over heavyweight ones. A 30KB charting micro-library is better than 500KB of D3 for a single bar chart.
- If you use external scripts, include an HTML comment block above each `<script src>` tag with the library name, version, source URL, and license.
- Write any custom JS (your own logic, not a library) inline in a `<script>` block. Keep custom JS minimal — offload as much as possible to the external library.
- Make the document pleasant to read: generous line-height, comfortable measure (~65-75ch), clear visual hierarchy, distinct heading levels, good use of whitespace.
- Use color intentionally, not decoratively. Color: the base is black, white, grey. One cool accent. Content-layer highlights (warnings, phases, syntax) use color for meaning — that stays. Do not let warmth leak into backgrounds, borders, or structural surfaces.
- Add interactive elements where they improve understanding — collapsible sections for deep tangents, tabs for alternative explanations, hover annotations for terms, simple toggleable diagrams.
- Progressive enhancement: the document must be fully readable without JS. Interactivity is a bonus, not a requirement.
- Code blocks must be syntax-highlighted with a readable theme. Use a minimal inline highlighter or a tiny external library.
- Print stylesheet: include a basic @media print block so the document prints cleanly.
- Dark mode: detect the user's preference via prefers-color-scheme and provide a coherent dark palette.
- Mobile: the document must be readable on narrow screens without horizontal scrolling.
- The <title> must match the document's title.
- Do not mention this contract, the quorum process, or design revision history in the output.

## Output instructions
Write your HTML document to `{outputFile}`.
Respond with only `OK` when the file is written.
Do not include the HTML in your response.
