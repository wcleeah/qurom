import { escapeHtml } from "./utils"

export function renderFindingsMcpCheckPanel(runName: string): string {
  return `<div id="findings-mcp-check-section" class="section findings-mcp-check" data-findings-mcp-check data-run-name="${escapeHtml(runName)}">
  <h2>Findings MCP</h2>
  <p class="muted-note dim-text">Call this run’s findings MCP the same way Cursor would, and confirm it returns the current round’s unresolved findings.</p>
  <div class="run-actions-buttons">
    <button type="button" class="btn btn-secondary" data-findings-mcp-check-btn>Check findings MCP</button>
  </div>
  <div class="findings-mcp-result" data-findings-mcp-result></div>
</div>`
}

export const FINDINGS_MCP_CHECK_SCRIPT = /* html */ `
<script>
(function () {
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  }

  function text(value) {
    return value == null || value === "" ? "—" : String(value)
  }

  function findingRows(findings) {
    if (!Array.isArray(findings) || findings.length === 0) {
      return "<p class=\\"muted-note dim-text\\">No unresolved findings.</p>"
    }
    var rows = findings.map(function (finding, index) {
      var item = finding && typeof finding === "object" ? finding : {}
      var id = typeof item.findingId === "string" ? item.findingId : "#" + (index + 1)
      var agent = typeof item.agent === "string" ? item.agent : ""
      var severity = typeof item.severity === "string" ? item.severity : ""
      var issue = typeof item.issue === "string" ? item.issue : JSON.stringify(finding)
      return "<tr>" +
        "<td><code>" + escapeHtml(id) + "</code></td>" +
        "<td>" + escapeHtml(agent) + "</td>" +
        "<td>" + escapeHtml(severity) + "</td>" +
        "<td>" + escapeHtml(issue) + "</td>" +
      "</tr>"
    }).join("")
    return "<div class=\\"table-wrap\\"><table class=\\"summary-table\\">" +
      "<thead><tr><th>ID</th><th>Agent</th><th>Severity</th><th>Issue</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table></div>"
  }

  function protocolLabel(protocol) {
    protocol = protocol || {}
    return (protocol.initialize ? "initialize" : "initialize failed") +
      " · " + (protocol.toolsList ? "tools/list" : "tools/list failed") +
      " · " + (protocol.toolsCall ? "get_unresolved_findings" : "get_unresolved_findings failed")
  }

  function advertisedLabel(advertised) {
    if (!advertised || advertised.reachable == null) return "Not probed (loopback URL)"
    if (advertised.reachable) return "Reachable from this process"
    return "Unreachable" + (advertised.error ? " — " + advertised.error : "")
  }

  function renderResult(panel, data) {
    var result = panel.querySelector("[data-findings-mcp-result]")
    if (!(result instanceof HTMLElement)) return
    var ok = !!data.ok
    var round = data.round == null ? "none yet" : String(data.round)
    var grant = data.grantSource === "live-session" ? "Live writing session" : "Issued for this check"
    var match = data.findingsMatch ? "Matches on-disk round findings" : "Does not match on-disk round findings"
    var banner = ok ? "Findings MCP is working" : (data.error || "Findings MCP check failed")
    var origin = data.originNote
      ? "<p class=\\"muted-note findings-mcp-warning\\">" + escapeHtml(data.originNote) + "</p>"
      : ""
    result.classList.add("has-result")
    result.innerHTML =
      "<div class=\\"outcome-banner " + (ok ? "approved" : "failed") + "\\">" + escapeHtml(banner) + "</div>" +
      origin +
      "<div class=\\"table-wrap\\"><table class=\\"summary-table\\">" +
        "<tr><td>Endpoint</td><td><code>" + escapeHtml(text(data.endpoint)) + "</code></td></tr>" +
        "<tr><td>Grant</td><td>" + escapeHtml(grant) + "</td></tr>" +
        "<tr><td>Protocol</td><td>" + escapeHtml(protocolLabel(data.protocol)) + "</td></tr>" +
        "<tr><td>Advertised URL</td><td>" + escapeHtml(advertisedLabel(data.advertised)) + "</td></tr>" +
        "<tr><td>Round</td><td>" + escapeHtml(round) + "</td></tr>" +
        "<tr><td>Source file</td><td><code>" + escapeHtml(text(data.sourceFile)) + "</code></td></tr>" +
        "<tr><td>Payload</td><td>" + escapeHtml(match) + " · " + escapeHtml(String(data.findingCount ?? 0)) + " finding(s)</td></tr>" +
      "</table></div>" +
      "<h3 class=\\"findings-mcp-findings-heading\\">Unresolved findings from MCP</h3>" +
      findingRows(data.findings) +
      "<details class=\\"findings-mcp-raw\\"><summary>Raw MCP payload</summary><pre>" +
        escapeHtml(JSON.stringify(data.findings, null, 2)) +
      "</pre></details>"
  }

  document.addEventListener("click", async function (event) {
    var target = event.target
    if (!(target instanceof Element)) return
    var button = target.closest("[data-findings-mcp-check-btn]")
    if (!(button instanceof HTMLButtonElement)) return
    var panel = button.closest("[data-findings-mcp-check]")
    if (!(panel instanceof HTMLElement)) return
    var runName = panel.dataset.runName
    if (!runName) return
    var result = panel.querySelector("[data-findings-mcp-result]")
    button.disabled = true
    panel.setAttribute("data-findings-mcp-busy", "true")
    if (result instanceof HTMLElement) {
      result.classList.remove("has-result")
      result.innerHTML = "<p class=\\"muted-note dim-text\\">Calling get_unresolved_findings…</p>"
    }
    try {
      var resp = await fetch("/api/runs/" + encodeURIComponent(runName) + "/findings-mcp-check", {
        method: "POST",
        headers: { Accept: "application/json" },
      })
      var data = await resp.json()
      if (!resp.ok && !data) throw new Error("Check failed")
      renderResult(panel, data)
      if (!resp.ok && !data.ok) {
        /* still rendered */
      }
    } catch (err) {
      if (result instanceof HTMLElement) {
        result.classList.add("has-result")
        result.innerHTML = "<div class=\\"outcome-banner failed\\">" +
          escapeHtml(err instanceof Error ? err.message : "Check failed") +
          "</div>"
      }
    } finally {
      panel.removeAttribute("data-findings-mcp-busy")
      button.disabled = false
    }
  })
})()
</script>`
