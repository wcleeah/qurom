/** Client script: toggle live default-vs-textarea diffs on /config/prompts. */
export const promptDiffScript = `<script>
(function(){
  function normalize(text){
    return String(text || "").replace(/\\r\\n/g, "\\n").replace(/\\r/g, "\\n").trim();
  }
  function splitLines(text){
    return String(text || "").replace(/\\r\\n/g, "\\n").replace(/\\r/g, "\\n").split("\\n");
  }
  function escapeHtml(text){
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  // Myers-lite LCS line diff → unified hunks
  function diffLines(before, after){
    var a = splitLines(before);
    var b = splitLines(after);
    var n = a.length, m = b.length;
    var dp = new Array(n + 1);
    for (var i = 0; i <= n; i++) {
      dp[i] = new Array(m + 1);
      dp[i][0] = i;
    }
    for (var j = 0; j <= m; j++) dp[0][j] = j;
    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
        else dp[i][j] = Math.min(dp[i - 1][j], dp[i][j - 1]) + 1;
      }
    }
    var ops = [];
    i = n; j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
        ops.push({ type: "equal", text: a[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] <= dp[i - 1][j])) {
        ops.push({ type: "add", text: b[j - 1] });
        j--;
      } else {
        ops.push({ type: "del", text: a[i - 1] });
        i--;
      }
    }
    ops.reverse();
    return ops;
  }
  function renderDiff(panel, before, after){
    if (normalize(before) === normalize(after)) {
      panel.innerHTML = '<p class="tiny-text muted-text">No differences.</p>';
      return;
    }
    var ops = diffLines(before, after);
    var html = ops.map(function(op){
      if (op.type === "equal") {
        return '<div class="prompt-diff-line equal"><span class="prompt-diff-prefix"> </span>' + escapeHtml(op.text) + '</div>';
      }
      if (op.type === "add") {
        return '<div class="prompt-diff-line add"><span class="prompt-diff-prefix">+</span>' + escapeHtml(op.text) + '</div>';
      }
      return '<div class="prompt-diff-line del"><span class="prompt-diff-prefix">-</span>' + escapeHtml(op.text) + '</div>';
    }).join("");
    panel.innerHTML =
      '<div class="prompt-diff-legend tiny-text muted-text"><span class="del">− default</span> <span class="add">+ active (textarea)</span></div>' +
      '<pre class="prompt-diff-body">' + html + '</pre>';
  }
  function syncChip(card){
    var chip = card.querySelector("[data-prompt-diff-toggle]");
    var active = card.querySelector("[data-prompt-active]");
    var def = card.querySelector("[data-prompt-default]");
    if (!chip || !active || !def) return;
    var diverted = normalize(active.value) !== normalize(def.value);
    chip.classList.toggle("diverted", diverted);
    chip.classList.toggle("matches", !diverted);
    chip.textContent = diverted ? "Modified from default" : "Matches default";
    chip.title = diverted
      ? "Active prompt differs from shipped default — click to show diff"
      : "Active prompt matches shipped default — click to show diff";
  }
  function initCard(card){
    var chip = card.querySelector("[data-prompt-diff-toggle]");
    var panel = card.querySelector("[data-prompt-diff-panel]");
    var active = card.querySelector("[data-prompt-active]");
    var def = card.querySelector("[data-prompt-default]");
    if (!chip || !panel || !active || !def) return;
    syncChip(card);
    active.addEventListener("input", function(){
      syncChip(card);
      if (chip.getAttribute("aria-expanded") === "true") {
        renderDiff(panel, def.value, active.value);
      }
    });
    chip.addEventListener("click", function(){
      var open = chip.getAttribute("aria-expanded") === "true";
      if (open) {
        chip.setAttribute("aria-expanded", "false");
        panel.hidden = true;
        return;
      }
      renderDiff(panel, def.value, active.value);
      chip.setAttribute("aria-expanded", "true");
      panel.hidden = false;
    });
  }
  function init(){
    document.querySelectorAll("[data-prompt-card]").forEach(initCard);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
</script>`
