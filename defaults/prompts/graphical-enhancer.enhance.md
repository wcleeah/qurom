Enhance the HTML for comprehension through **visible graphics** — diagrams, charts, ASCII-to-visual transforms, comparison layouts, workflows, annotated figures, and similar understanding aids. Do not add screen-reading chrome; that belongs to the reading-experience enhancer. Leave theme architecture and the head theme-bootstrap script alone.

## frontend-design

Follow the `frontend-design` skill included with this prompt (and load it via the skill tool if available) for figure quality, restraint, and avoiding decorative AI-layout clichés. Do not re-theme. `html-designer` already owns identity: palette, type, signature, and theme architecture. Add or upgrade comprehension graphics inside that identity.

The HTML content to enhance is provided in the `HTML document` context or attached as a file. If it is not from the attached file, write the full document to a local file first, by chunk, instead of one full write.

`html-designer` already owns the page shell, typography, theme, and a first visual pass. Do not re-theme the document. Add missing figures and upgrade weak ones.

Rules:
- Preserve authored textual content and meaning. Do not rewrite, paraphrase, reorder claims, change examples, or alter technical substance.
- You may change the representation layer: figure markup, styles, layout needed for those figures, scripts that *render* a graphic, and equivalent fallback presentation.
- If no graphic has clear comprehension value, leave the file unchanged and respond `OK`.
- Stay inside the designer's identity: reuse existing CSS variables and `data-theme`. Do not introduce a new palette, type family, or signature. Library-rendered output must respect `data-theme`.
- Script placement: keep any existing theme bootstrap `<script>` in `<head>`. Add new enhancement scripts at the end of `<body>`; put new styles in `<head>`.
- Use only CDN-hosted libraries. No npm, no local installs. Never add tracking, analytics, or third-party requests beyond the libraries you use.
- No decorative illustration. Every figure must carry information that the surrounding text already claims.

## Default: show the whole idea without a click

The retired interactive-enhancer failed by adding click-gated toys that hid the explanation: Play / Step / Reset labs, filter toolbars, quizzes, diagnosis clickers, “show all” / “practice” modes, and tab strips that keep sibling states off-screen. Those do not add value. Do not recreate them.

Prefer a static figure the reader can understand with JavaScript disabled:
- Public-domain or licensed photographs when the subject is visual (embed `<img>`; if the image is copyrighted, keep a link instead)
- Numeric tables → a shared-scale CSS/SVG chart (same axis for length, range, counts) when the numbers are the point
- Sequences and protocols → an always-visible swimlane or timeline of the **entire** sequence
- Bytes / encodings / terminal output → the bytes next to a painted result
- Dense code → annotated callouts or highlighted lines, not only syntax color
- ASCII / markdown tables → real tables or simple charts
- ASCII flows, sequences, and timelines → a visible SVG / Mermaid-style diagram of the **entire** sequence
- Comparisons → side-by-side or a static table, not a button group that reveals one variant at a time

If a process has N steps, draw all N steps. If a comparison has variants, show the variants together.

## Interaction is rare

Keep interaction only when a control changes a representation that **cannot** be shown as two or three adjacent static views (for example a continuous parameter). If you can show the states side by side, do that instead of a toggle.

Forbidden unless the exception above is genuinely true:
- Play / Step / Reset / Next / Previous walkthroughs
- Quizzes, flashcards, “practice the filter,” scoring
- Toolbars whose default state hides tips, labels, or rows
- Tabs, chips, or accordions that gate an explanation the reader needs
- Simulated consoles, shop-order clickers, or other toy UIs

Exception: live demos are allowed only when the document is itself about UI motion or input (for example CSS/JS animation). Even then, keep a static explanation visible without clicking Play.

A graphic may be *drawn* with a library (charts, diagrams). That is rendering, not a teaching widget. Prefer hand SVG or CSS over extra libraries when a simple figure is enough.

How to work:
- Study topic, structure, and audience. Look for places where a figure would materially improve understanding.
- Inspect complex explanations, diagrams, sequences, comparisons, workflows, dense code/tables, and plain-text ASCII artifacts.
- Transform those into clearer visual forms while preserving meaning.
- If opportunities are genuine, edit the document directly.

## Mandatory verification (Playwright + todos)

Before you finish, you MUST use the `todowrite` tool to create exactly these three todos, then verify each with Playwright (and bash if you need a local static server for `file://`/`http://` access):

1. **Scrolling works all the way** — open the page at a desktop viewport; scroll from top to bottom; confirm the document reaches the end and sticky chrome does not trap scroll.
2. **Mobile overflow checks** — resize to a narrow mobile viewport (~390×844); confirm no horizontal page overflow (`document.documentElement.scrollWidth` ≤ viewport width); wide tables/code must scroll inside their containers, not the page.
3. **UI looks fine** — no page/console errors from the document; primary reading chrome (nav/progress/theme controls if present) remains usable; nothing obviously clipped or stacked incorrectly at desktop and mobile sizes.

Mark each todo complete only after you have Playwright evidence for that check. If a check fails, fix the HTML and re-run that check. Do not claim success while any of the three todos is incomplete or failed.
