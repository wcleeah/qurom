Convert the markdown deep dive into a single self-contained HTML document. Own structure, theme shell, typography, print stylesheet, syntax highlighting, and static visual presentation. Leave teaching widgets, click-gated labs, and reading chrome for later stages.

Topic: {topic}

The markdown document is provided with this prompt.

Ownership (this stage):
- Prefer static or lightly styled representations: hierarchy, tables, simple inline SVG, and non-copyrighted images when they help.
- Do not add Play / Step / Reset labs, quizzes, filter toolbars, or other teaching widgets. The graphical enhancer may add or upgrade figures later.
- Mobile baseline: content must remain readable on narrow screens (e.g. wide code/tables may scroll horizontally). Deeper ergonomics belong later.

Contract:
- Aesthetic: Neutral minimal. Base palette is black, white, and a cool grey ramp only:
  --grey-50 #fafafa, --grey-100 #f4f4f5, --grey-200 #e4e4e7, --grey-400 #a1a1aa, --grey-600 #52525b, --grey-900 #18181b.
  Background: --grey-50. Body text: --grey-900. All structural surfaces draw from this ramp. No warm base tones. No background gradients. No backdrop-filter blur. Shadows: none, or a single 0 0 0 1px border ring. Typography: sans-serif system fonts for body text.
- Accent: exactly one saturated, high-luminance color for contrast (e.g. electric blue #2563eb, cyan #06b6d4, or magenta #d946ef). Use sparingly — primary links, active/selected state, key data points (roughly ≤5% of visible pixels). Functional content highlights (phase colors, warnings, syntax) are separate from the accent.
- Contrast: the single accent must remain readable against both light and dark bases (WCAG AA for normal text/links). This is a color-contrast requirement for the accent token, not a request for full accessibility tooling, ARIA audits, or screen-reader support.
- Return a single complete HTML document. Every CSS rule must be inline. Zero external CSS. No CDN links for fonts or images; draw icons/diagrams with inline SVG or CSS.
- You MAY use external `<script src="...">` from trusted CDNs (cdnjs, jsdelivr, unpkg). Prefer smaller focused libraries. Comment each external script with name, version, URL, and license.
- Make the document pleasant to read: generous line-height, comfortable measure (~65-75ch), clear hierarchy, good whitespace.
- Code blocks must be syntax-highlighted with a readable theme.
- Print stylesheet: include a basic @media print block.
- Theme: support both light and dark. Implementation contract:
  - Every color flows through a CSS variable. Define semantic tokens for both themes: --bg, --fg, --muted, --border, --card-bg, --code-bg, --accent, and severity/status colors.
  - Light: --bg #fafafa, --fg #18181b, --border #e4e4e7, --card-bg #ffffff. Dark: --bg #0f1117, --fg #e4e4e7, --border #272a30, --card-bg #181a1f.
  - Define --accent for light and a separate --accent (often one step lighter/dimmer) for dark so it does not clip on near-black.
  - Drive theme via `data-theme="light|dark"` on `<html>`. Honor `prefers-color-scheme` as default; provide a visible manual toggle (sun/moon, top-right) that persists to `localStorage`.
  - No flash of wrong theme: a blocking inline `<script>` in `<head>` sets `data-theme` from `localStorage` (falling back to `prefers-color-scheme`) before first paint. Do not place the theme bootstrap script at the end of `<body>`. Other custom scripts may live at end of body.
  - Parity: light and dark must have equal information density and contrast.
  - Do not change Text Selection (::selection)'s color.
- Feel free to add image from the internet if you see fit, make sure no copyright is violated tho. If the image you would like to use is copyrighted, attach the original site link instead.
- If no image is available, try to use svg to illustrate.
- The `<title>` must match the document's title.
- Do not mention this contract, the quorum process, or design revision history in the output.

## Mandatory verification (Playwright + todos)

Before you finish, you MUST use the `todowrite` tool to create exactly these three todos, then verify each with Playwright (and bash if you need a local static server for `file://`/`http://` access):

1. **Scrolling works all the way** — open the page at a desktop viewport; scroll from top to bottom; confirm the document reaches the end and sticky chrome does not trap scroll.
2. **Mobile overflow checks** — resize to a narrow mobile viewport (~390×844); confirm no horizontal page overflow (`document.documentElement.scrollWidth` ≤ viewport width); wide tables/code must scroll inside their containers, not the page.
3. **UI looks fine** — no page/console errors from the document; primary reading chrome (nav/progress/theme controls if present) remains usable; nothing obviously clipped or stacked incorrectly at desktop and mobile sizes.

Mark each todo complete only after you have Playwright evidence for that check. If a check fails, fix the HTML and re-run that check. Do not claim success while any of the three todos is incomplete or failed.
