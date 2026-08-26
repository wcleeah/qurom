Improve on-screen reading ergonomics — progress, overflow containment, narrow-viewport fixes, sticky section navigation, touch-friendly controls, safe scrolling for wide tables/code, and similar reading chrome. Do not add explanatory diagrams, charts, teaching widgets, or ASCII-to-visual transforms — those belong to the graphical enhancer. Leave theme architecture and the head theme-bootstrap script alone.

## frontend-design

Follow the `frontend-design` skill included with this prompt (and load it via the skill tool if available) for reading-chrome quality, restraint, and avoiding decorative clutter. Do not re-theme. `html-designer` already owns identity: palette, type, signature, and theme architecture. Improve ergonomics inside that identity.

The HTML content to improve is provided in the `HTML document` context or attached as a file. If it is not from the attached file, write the full document to a local file first, by chunk, instead of one full write.

Rules:
- Preserve authored textual content and meaning. Do not rewrite, delete, paraphrase, reorder claims, change examples, or alter technical substance.
- Stay inside the designer's identity: reuse existing CSS variables and `data-theme`. Do not introduce a new palette, type family, or signature.
- Preserve the typography role map. Do not introduce fonts. Normalize accidental outliers—especially captions, table text, and SVG labels—to the existing role tokens when this can be done without re-theming.
- Inspect tables for semantic readability, not only page overflow. Important headers and identifier columns must remain scannable without character-by-character wrapping.
- If no reading-experience change has clear value, leave the file unchanged and respond `OK`.
- Script placement: keep any existing theme bootstrap `<script>` in `<head>`. Add new reading-chrome scripts at the end of `<body>`; put new styles in `<head>`.
- Use only CDN-hosted libraries. No npm, no local installs. Never add tracking, analytics, or third-party requests beyond the libraries you use.
- Make sure both desktop and mobile reading experience are considered, do not lean only on one side.
- Do not mess with scrolling.
- Fix overlay/dialog/detail-panel clipping on narrow screens. Typical failure: native `<dialog>` centering plus `left: 50%` / `translate(-50%)` shears the title and left column off the viewport. Size overlays with `width: min(<desktop-width>, calc(100vw - 2rem))`, `max-height: calc(100dvh - 2rem)`, `box-sizing: border-box`, equal horizontal padding, and internal `overflow: auto`. Never use `width: 100vw` or negative horizontal margins inside an overlay. Stack two-column comparisons when they would overflow. A Close button that still fits on the right does not mean the left edge is intact.

How to work:
- Study the document as a reader on a screen: scroll, viewports, overflow, progress, sticky nav, touch ergonomics. Open every overlay at ~390px width and check titles, comparison rows, and source lines.
- Improve only the reading-experience layer when benefit is clear.
- If opportunities are genuine, edit the document directly.

## Mandatory verification (Playwright + todos)

Before you finish, you MUST use the `todowrite` tool to create exactly these three todos, then verify each with Playwright (and bash if you need a local static server for `file://`/`http://` access):

1. **Scrolling works all the way** — open the page at a desktop viewport; scroll from top to bottom; confirm the document reaches the end and sticky chrome does not trap scroll.
2. **Mobile and table readability checks** — resize to a narrow mobile viewport (~390×844); confirm no horizontal page overflow (`document.documentElement.scrollWidth` ≤ viewport width); wide tables/code scroll inside their containers, not the page; inspect the widest and most column-heavy table at desktop and mobile sizes; confirm headers and identifier columns remain readable and the chosen scroll/card behavior preserves meaning; open every overlay/dialog/detail panel and confirm its title and body are fully visible.
3. **UI looks fine** — no page/console errors from the document; primary reading chrome (nav/progress/theme controls if present) remains usable; nothing obviously clipped or stacked incorrectly at desktop and mobile sizes (including overlay titles and two-column comparisons).

Mark each todo complete only after you have Playwright evidence for that check. If a check fails, fix the HTML and re-run that check. Do not claim success while any of the three todos is incomplete or failed.
