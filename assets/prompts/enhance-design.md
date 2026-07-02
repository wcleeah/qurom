The HTML content to enhance is provided in the `HTML document` context.

Study the document: its topic, structure, audience, and behavior across screen sizes. Look for places where interaction, visual representation, technical readability, accessibility, navigation, or mobile reading could materially improve the reader experience.

Inspect candidate areas such as complex explanations, diagrams, sequences, comparisons, workflows, dense code or tables, long navigation, repeated structures, and small-screen ergonomics. For each promising candidate, research an appropriate lightweight browser/CDN library or native web-platform approach one by one, then implement it if the benefit is clear.

Preserve authored textual content and meaning. Do not rewrite, delete, paraphrase, reorder claims, change examples, or alter technical substance. Only change the representation layer: markup wrappers, styles, layout, scripts, controls, visual rendering, responsive behavior, accessibility metadata, and equivalent fallback presentation.

Prefer focused, high-value enhancements over many small widgets. Do not add features solely because they are available or fashionable. If, after reviewing comprehension, navigation, accessibility, responsive reading, and representation opportunities, no enhancement has clear reader value, leave the file unchanged and respond `OK`.

If you see genuine opportunities to make it better, go ahead. Trust your design instincts. Edit the file directly.
- Stay within the existing design contract: do not introduce additional accent colors, and do not replace the CSS-variable + `data-theme` theme architecture. Any library-rendered output (charts, diagrams) must respect `data-theme` — pass theme-aware colors from JS rather than relying on library defaults, which assume light mode.

