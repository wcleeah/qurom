import { CSS } from "./styles"
import { escapeHtml } from "./utils"
import type { RunStatus } from "./types"

export function layout(title: string, body: string, extraHead = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap">
<style>${CSS}</style>
<script>
(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();
</script>
${extraHead}
</head>
<body>
<button type="button" class="theme-toggle" data-theme-toggle aria-label="Toggle color theme"></button>
${body}
<script>
(function(){
  var root=document.documentElement;
  var btn=document.querySelector("[data-theme-toggle]");
  function current(){
    var t=root.getAttribute("data-theme");
    if(t)return t;
    return window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";
  }
  function render(){btn.textContent=current()==="dark"?"Light":"Dark";}
  render();
  btn.addEventListener("click",function(){
    var next=current()==="dark"?"light":"dark";
    root.setAttribute("data-theme",next);
    try{localStorage.setItem("theme",next);}catch(e){}
    render();
  });
})();
</script>
</body>
</html>`
}

export function badge(status: RunStatus): string {
  const cls =
    status === "approved" ? "badge-approved" :
    status === "failed" ? "badge-failed" :
    "badge-running"
  return `<span class="badge ${cls}">${status}</span>`
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(ms)
}
