import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const MARKED_UMD_URL = "/view-client/marked.umd.js"

export const MARKED_UMD_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../node_modules/marked/lib/marked.umd.js",
)

export const HTML_VIEWER_MARKDOWN_SCRIPT = /* html */ `
<script src="${MARKED_UMD_URL}"></script>
<script>
(function () {
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  }

  window.quorumRenderMarkdown = function quorumRenderMarkdown(src) {
    const text = String(src || "")
    if (!text) return ""
    if (typeof marked === "undefined") return escapeHtml(text)
    try {
      return marked.parse(text, { async: false })
    } catch {
      return "<pre><code>" + escapeHtml(text) + "</code></pre>"
    }
  }
})();
</script>`
