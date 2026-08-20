Convert the markdown deep dive into a single self-contained HTML document. Own structure, theme shell, typography, print stylesheet, syntax highlighting, and static visual presentation. Leave teaching widgets, click-gated labs, and reading chrome for later stages.

Topic: {topic}

The markdown document is provided with this prompt.

## frontend-design

Follow the `frontend-design` skill included with this prompt (and load it via the skill tool if available). Use its two-pass process: design plan (palette, type, layout, signature), critique generic defaults, then implement.

Taste is yours and should be specific to this subject. Do not default to a generic grey SaaS shell, system-ui-only type, or a single stock accent on a cool-grey ramp unless that is truly the best expression of this document.

Ownership (this stage):
- Prefer static or lightly styled representations: hierarchy, tables, simple inline SVG, and non-copyrighted images when they help.
- Do not add Play / Step / Reset labs, quizzes, filter toolbars, or other teaching widgets. The graphical enhancer may add or upgrade figures later.
- Mobile baseline: content must remain readable on narrow screens (e.g. wide code/tables may scroll horizontally). Deeper ergonomics belong later.
- The article's prose is authored content. Preserve it. Do not create a parallel editorial voice through decorative slogans, rewritten headings, repeated summaries, or callouts that paraphrase nearby text. Functional interface labels are allowed.

Contract:
- Return a single complete HTML document. Page CSS must live in `<style>` (no separate `.css` files). No tracking, analytics, or third-party requests beyond the libraries and fonts you use.
- Fonts: you MAY load distinctive typefaces from trusted CDNs (Google Fonts, Bunny Fonts, jsDelivr, cdnjs, unpkg) via `<link>` or `@font-face`. Comment each font source with name, weights, URL, and license.
- You MAY use external `<script src="...">` from trusted CDNs (cdnjs, jsdelivr, unpkg). Prefer smaller focused libraries. Comment each external script with name, version, URL, and license.
- Make the document pleasant to read: generous line-height, comfortable measure (~65-75ch), clear hierarchy, good whitespace.
- Code blocks must be syntax-highlighted with a readable theme that matches the identity.
- Print stylesheet: include a basic @media print block.
- Theme: support both light and dark. Implementation contract:
  - Every color flows through a CSS variable. Define semantic tokens for both themes: --bg, --fg, --muted, --border, --card-bg, --code-bg, --accent, and severity/status colors.
  - Derive both themes from the design plan. Dark must be a true dark counterpart of the same identity, not an inverted afterthought.
  - Drive theme via `data-theme="light|dark"` on `<html>`. Honor `prefers-color-scheme` as default; provide a visible manual toggle (sun/moon, top-right) that persists to `localStorage`.
  - No flash of wrong theme: a blocking inline `<script>` in `<head>` sets `data-theme` from `localStorage` (falling back to `prefers-color-scheme`) before first paint. Do not place the theme bootstrap script at the end of `<body>`. Other custom scripts may live at end of body.
  - Parity: light and dark must have equal information density and contrast.
  - Do not change Text Selection (::selection)'s color.
- Contrast: text, links, and the accent token must remain readable against both light and dark bases (WCAG AA for normal text/links). This is a color-contrast requirement, not a request for full accessibility tooling, ARIA audits, or screen-reader support.
- Feel free to add image from the internet if you see fit, make sure no copyright is violated tho. If the image you would like to use is copyrighted, attach the original site link instead.
- If no image is available, try to use svg to illustrate.
- The `<title>` must match the document's title.
- Do not mention this contract, the quorum process, the frontend-design skill, or design revision history in the output.

## Mandatory verification (Playwright + todos)

Before you finish, you MUST use the `todowrite` tool to create exactly these three todos, then verify each with Playwright (and bash if you need a local static server for `file://`/`http://` access):

1. **Scrolling works all the way** — open the page at a desktop viewport; scroll from top to bottom; confirm the document reaches the end and sticky chrome does not trap scroll.
2. **Mobile overflow checks** — resize to a narrow mobile viewport (~390×844); confirm no horizontal page overflow (`document.documentElement.scrollWidth` ≤ viewport width); wide tables/code must scroll inside their containers, not the page.
3. **UI looks fine** — no page/console errors from the document; primary reading chrome (nav/progress/theme controls if present) remains usable; nothing obviously clipped or stacked incorrectly at desktop and mobile sizes.

Mark each todo complete only after you have Playwright evidence for that check. If a check fails, fix the HTML and re-run that check. Do not claim success while any of the three todos is incomplete or failed.
