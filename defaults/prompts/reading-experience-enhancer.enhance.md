Improve on-screen reading ergonomics — progress, overflow containment, narrow-viewport fixes, sticky section navigation, touch-friendly controls, safe scrolling for wide tables/code, and similar reading chrome. Do not add explanatory diagrams, interactive teaching widgets, or ASCII-to-visual transforms — those belong to the interactive enhancer. Leave theme architecture and the head theme-bootstrap script alone.

The HTML document is provided with this prompt.

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

Optional: check the final HTML in a browser (install Playwright if needed).
