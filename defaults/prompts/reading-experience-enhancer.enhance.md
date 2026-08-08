Improve on-screen reading ergonomics — progress, overflow containment, narrow-viewport fixes, sticky section navigation, touch-friendly controls, safe scrolling for wide tables/code, and similar reading chrome. Do not add explanatory diagrams, interactive teaching widgets, or ASCII-to-visual transforms — those belong to the interactive enhancer. Leave theme architecture and the head theme-bootstrap script alone.

The HTML content to improve is provided in the `HTML document` context or attached as a file. If it is not from the attached file, write the full document to a local file first, by chunk, instead of one full write.

Rules:
- Preserve authored textual content and meaning. Do not rewrite, delete, paraphrase, reorder claims, change examples, or alter technical substance.
- Stay within the existing design contract: no extra accent colors; keep CSS-variable + `data-theme`.
- If no reading-experience change has clear value, leave the file unchanged and respond `OK`.
- Script placement: keep any existing theme bootstrap `<script>` in `<head>`. Add new reading-chrome scripts at the end of `<body>`; put new styles in `<head>`.
- Use only CDN-hosted libraries. No npm, no local installs. Never add tracking, analytics, or third-party requests beyond the libraries you use.
- Make sure both desktop and mobile reading experience are considered, do not lean only on one side.

How to work:
- Study the document as a reader on a screen: scroll, viewports, overflow, progress, sticky nav, touch ergonomics.
- Improve only the reading-experience layer when benefit is clear.
- If opportunities are genuine, edit the document directly.

## Mandatory verification (Playwright + todos)

Before you finish, you MUST use the `todowrite` tool to create exactly these three todos, then verify each with Playwright (and bash if you need a local static server for `file://`/`http://` access):

1. **Scrolling works all the way** — open the page at a desktop viewport; scroll from top to bottom; confirm the document reaches the end and sticky chrome does not trap scroll.
2. **Mobile overflow checks** — resize to a narrow mobile viewport (~390×844); confirm no horizontal page overflow (`document.documentElement.scrollWidth` ≤ viewport width); wide tables/code must scroll inside their containers, not the page.
3. **UI looks fine** — no page/console errors from the document; primary reading chrome (nav/progress/theme controls if present) remains usable; nothing obviously clipped or stacked incorrectly at desktop and mobile sizes.

Mark each todo complete only after you have Playwright evidence for that check. If a check fails, fix the HTML and re-run that check. Do not claim success while any of the three todos is incomplete or failed.
