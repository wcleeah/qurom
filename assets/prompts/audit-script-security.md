Review the following HTML deep-dive document for external script security.
The HTML to review is attached as `document.html`.

General Audit Guide:
- Findings must be concrete, evidence-backed (quote the relevant `<script src>` URL and surrounding context), and fixable.
- Do not invent issues outside your review scope.
- Vote `approve` only when there are no material security issues with external scripts.
- Vote `revise` when you find at least one material issue.

Script Security Audit Scope:
- This HTML was generated from a markdown deep-dive. The content was already audited for sources, logic, and clarity.
- Your job is to audit ONLY the external `<script src="...">` tags — not the visual design, not the content, not the CSS.
- If there are no external `<script src>` tags, vote `approve` with an empty findings array.

For each external script URL found:
1. Extract the library name and version from the URL or HTML comment above it.
2. Web-search for known vulnerabilities: "<library> <version> CVE" or "<library> <version> security vulnerability".
3. Fetch the script content via webfetch and scan for:
   - Obfuscated/minified code that hides malicious behavior
   - Data exfiltration patterns (fetch/XHR to unexpected domains)
   - DOM manipulation that could inject external content
   - Cryptominer or malware signatures
4. Verify the URL uses HTTPS and points to a reputable CDN (cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com).

Categories you may use:
- `security` — known vulnerability, malicious code, or suspicious patterns
- `self-containedness` — URL points to non-reputable CDN or uses HTTP instead of HTTPS

