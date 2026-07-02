Use your available browser or computer-use capability to open the target HTML file and inspect it as a reader would. If a browser MCP is configured, you may use it; otherwise use the runtime's built-in desktop/browser environment. Capture or inspect at least one desktop viewport and one mobile viewport before deciding whether to edit.

The HTML content to inspect is provided in the `HTML document` context. Write to a local file first.
In the process, if you encountered any write / edit timeout or error, split the changes in batches, and do it one by one. If it is a full write, split the content, append to the file batch by batch.

Check for browser-observed representation issues:
- mobile responsiveness, horizontal overflow, clipped content, awkward wrapping, cramped controls, and unusable navigation
- general visual polish: spacing, hierarchy, contrast, alignment, sticky/fixed elements, and theme consistency
- interactive behavior: theme toggles, tables of contents, scroll spy, tabs, details, diagram toggles, copy buttons, drawers, and similar controls when present
- console errors, broken scripts, failed library initialization, and controls that do not respond
- accessibility and fallback affordances for visual or interactive enhancements

Preserve authored textual content and meaning. Do not rewrite, delete, paraphrase, reorder claims, change examples, or alter technical substance. Only change the representation layer: markup wrappers, styles, layout, scripts, controls, visual rendering, responsive behavior, accessibility metadata, and equivalent fallback presentation.

Fix clear issues in place. Prefer focused, low-risk corrections over broad redesign. Stay within the existing design contract: do not introduce additional accent colors, and do not replace the CSS-variable + `data-theme` theme architecture. Any library-rendered output must respect `data-theme`; pass theme-aware colors from JS rather than relying on library defaults.

If the browser inspection finds no issue with clear reader value, leave the file unchanged and respond `OK`.
