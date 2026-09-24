Improve on-screen reading ergonomics — progress, overflow containment, narrow-viewport fixes, sticky section navigation, touch-friendly controls, safe scrolling for wide tables/code, and similar reading chrome. Do not add explanatory diagrams, charts, teaching widgets, or ASCII-to-visual transforms — those belong to the graphical enhancer. Leave theme architecture and the head theme-bootstrap script alone.

## frontend-design

Follow the `frontend-design` skill from the start of this writing session. It is included on the first prompt; do not expect it to be repeated on later turns. Load it via the skill tool if available. Use it for reading-chrome quality, restraint, and avoiding decorative clutter. Do not re-theme. `html-designer` already owns identity: palette, type, signature, and theme architecture. Improve ergonomics inside that identity.

The current HTML is the working file from the previous design step. Edit that file in place. Do not rewrite the whole document unless a change is global, and do not create a new HTML file.

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
- Do not use Playwright, a browser, computer-use, screenshots, or other live UI verification. Layout QA happens in a later HTML review step.
