Convert the provided markdown deep-dive document into a self-contained, beautifully styled HTML file.
The markdown content is provided in the `markdown document` context.

Topic: {topic}

Non-negotiable contract:
- Aesthetic: Neutral minimal. Base palette is black, white, and a cool grey ramp only:
  --grey-50 #fafafa, --grey-100 #f4f4f5, --grey-200 #e4e4e7, --grey-400 #a1a1aa, --grey-600 #52525b, --grey-900 #18181b.
  Background: --grey-50. Body text: --grey-900. All structural surfaces (borders, dividers, card backgrounds, muted text) draw from this ramp. No warm base tones (no cream, beige, warm grey). No background gradients. No backdrop-filter blur. Shadows: none, or a single 0 0 0 1px border ring — not soft layered shadows. Typography: sans-serif system fonts for body text.
- Accent: exactly one saturated, high-luminance color for contrast (e.g. electric blue #2563eb, cyan #06b6d4, or magenta #d946ef). It is the only non-neutral color in the base layer. Use it sparingly — primary links, the active/selected state, and key data points. Budget rule: accent should cover roughly ≤5% of visible pixels; if it appears on more than links + one active state + key data markers, you are over budget. The no-warm-base rule applies to structural surfaces only; the single accent may be warm or cool. Functional content highlights (phase colors, warnings, syntax tokens) are separate from the accent and use color for meaning.
- Return a single complete HTML document. Every CSS rule must be inline. Zero external CSS dependencies.
- No CDN links for fonts or images. If you need icons or diagrams, draw them with inline SVG or CSS.
- You MAY use external `<script src="...">` tags to load JavaScript libraries from trusted CDNs (cdnjs, jsdelivr, unpkg). This is preferred over vendoring libraries inline — external scripts won't be truncated and will be security-audited separately.
- Prefer smaller, focused libraries over heavyweight ones. A 30KB charting micro-library is better than 500KB of D3 for a single bar chart.
- If you use external scripts, include an HTML comment block above each `<script src>` tag with the library name, version, source URL, and license.
- Write any custom JS (your own logic, not a library) inline in a `<script>` block. Keep custom JS minimal — offload as much as possible to the external library.
- Make the document pleasant to read: generous line-height, comfortable measure (~65-75ch), clear visual hierarchy, distinct heading levels, good use of whitespace.
- Use color intentionally, not decoratively. The base is black, white, grey. One saturated accent. Content-layer highlights (warnings, phases, syntax) use color for meaning — that stays. Do not let warmth leak into backgrounds, borders, or structural surfaces.
- Add interactive elements where they improve understanding — collapsible sections for deep tangents, tabs for alternative explanations, hover annotations for terms, simple toggleable diagrams.
- Progressive enhancement: the document must be fully readable without JS. Interactivity is a bonus, not a requirement.
- Code blocks must be syntax-highlighted with a readable theme. Use a minimal inline highlighter or a tiny external library.
- Print stylesheet: include a basic @media print block so the document prints cleanly.
- Theme: support both light and dark. Implementation contract:
  - Every color flows through a CSS variable (`var(--…)`). No hardcoded hex/rgb values in any rule. Define every semantic token for both themes: --bg, --fg, --muted, --border, --card-bg, --code-bg, --accent, and severity/status colors.
  - Light: --bg #fafafa, --fg #18181b, --border #e4e4e7, --card-bg #ffffff. Dark: --bg #0f1117, --fg #e4e4e7, --border #272a30, --card-bg #181a1f.
  - The single accent must pass WCAG AA against both bases. Define --accent for light and a separate --accent (often one step lighter/dimmer) for dark so it does not clip or glow on near-black.
  - Drive theme via a `data-theme="light|dark"` attribute on `<html>`. Honor `prefers-color-scheme` as the default, and provide a visible manual toggle (sun/moon icon, top-right) that sets `data-theme` and persists the choice to `localStorage`.
  - No flash of wrong theme: a blocking inline `<script>` in `<head>` sets `data-theme` from `localStorage` (falling back to `prefers-color-scheme`) before first paint. Do not place the theme script at the end of `<body>`.
  - Parity: light and dark must have equal information density and contrast. No element may vanish or lose affordance in either mode (no dropped borders, no washed-out muted text).
- Mobile: the document must be readable on narrow screens without horizontal scrolling.
- The <title> must match the document's title.
- Do not mention this contract, the quorum process, or design revision history in the output.

