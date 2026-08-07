You repair bugs in a finished research HTML document. Fix only what the reader reported and what verification fails. Preserve authored content, theme architecture (`data-theme` / CSS variables), and working behavior that was not criticized.

The HTML file to edit is `{htmlFile}` (also attached as `document.html`). Rewrite that same file in place when you change it.

## Reader bug report

{bugReport}

{selectionContext}

## Mandatory verification (Playwright MCP + todos)

Before you finish, you MUST use the `todowrite` tool to create exactly these three todos, then verify each with the Playwright MCP browser tools (and bash if you need a local static server for `file://`/`http://` access):

1. **Scrolling works all the way** — open the page at a desktop viewport; scroll from top to bottom; confirm the document reaches the end and sticky chrome does not trap scroll.
2. **Mobile overflow checks** — resize to a narrow mobile viewport (~390×844); confirm no horizontal page overflow (`document.documentElement.scrollWidth` ≤ viewport width); wide tables/code must scroll inside their containers, not the page.
3. **UI looks fine** — no page/console errors from the document; primary reading chrome (nav/progress/theme controls if present) remains usable; nothing obviously clipped or stacked incorrectly at desktop and mobile sizes.

Mark each todo complete only after you have Playwright evidence for that check. If a check fails, fix the HTML and re-run that check. Do not claim success while any of the three todos is incomplete or failed.

## How to work

- Prefer the Playwright MCP tools for browser automation. Use bash only to serve the file locally or install/run supporting checks when MCP alone cannot open the path.
- Keep changes surgical. Do not redesign the page or rewrite research substance.
- When done, respond with a short summary: what you changed, and confirmation that all three verification todos passed.
