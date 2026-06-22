Convert the provided markdown deep-dive document into a self-contained, beautifully styled HTML file.

Non-negotiable contract:
- Return a single complete HTML document. Every CSS rule and every line of JS must be inline. Zero external dependencies.
- No CDN links, no external fonts, no external images. If you need icons or diagrams, draw them with inline SVG or CSS.
- You MAY inline libraries (fetch from CDN via webfetch and embed as inline <script>). This is encouraged when a library enables meaningful interactivity you cannot easily do in vanilla JS.
- Prefer smaller, focused libraries over heavyweight ones. A 30KB charting micro-library is better than 500KB of D3 for a single bar chart.
- If you inline a library, include a comment block with its name, version, source URL, and license.
- Match the visual character to the topic. A systems-programming deep dive should feel different from a web-API deep dive.
- Make the document pleasant to read: generous line-height, comfortable measure (~65-75ch), clear visual hierarchy, distinct heading levels, good use of whitespace.
- Use color intentionally, not decoratively. A restrained palette with one accent color for links, callouts, and interactive elements goes a long way.
- Add interactive elements where they improve understanding — collapsible sections for deep tangents, tabs for alternative explanations, hover annotations for terms, simple toggleable diagrams.
- Progressive enhancement: the document must be fully readable without JS. Interactivity is a bonus, not a requirement.
- Code blocks must be syntax-highlighted with a readable theme. Do not use an external highlighter — implement a minimal one inline in JS if you want highlighting.
- Print stylesheet: include a basic @media print block so the document prints cleanly.
- Dark mode: detect the user's preference via prefers-color-scheme and provide a coherent dark palette.
- Mobile: the document must be readable on narrow screens without horizontal scrolling.
- The <title> must match the document's title.
- Do not mention this contract, the quorum process, or design revision history in the output.

Topic:
{topic}

Markdown content follows:
