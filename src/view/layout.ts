import { renderAppNavbar, type AppNavbarOptions } from "./app-nav"
import { CSS } from "./styles"
import { escapeHtml } from "./utils"
import type { RunStatus } from "./types"

const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`

const THEME_TOGGLE_SCRIPT = `(function(){
  var root=document.documentElement;
  var buttons=document.querySelectorAll("[data-theme-toggle]");
  if(!buttons.length)return;
  function current(){
    var t=root.getAttribute("data-theme");
    if(t)return t;
    return window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";
  }
  function render(btn){btn.textContent=current()==="dark"?"Light":"Dark";}
  buttons.forEach(function(btn){render(btn);});
  buttons.forEach(function(btn){
    btn.addEventListener("click",function(){
      var next=current()==="dark"?"light":"dark";
      root.setAttribute("data-theme",next);
      try{localStorage.setItem("theme",next);}catch(e){}
      buttons.forEach(render);
    });
  });
})();`

export type LayoutOptions = {
  extraHead?: string
  navbar?: AppNavbarOptions
}

function resolveLayoutOptions(options?: LayoutOptions | string): LayoutOptions {
  if (typeof options === "string") return { extraHead: options }
  return options ?? {}
}

export function layout(title: string, body: string, options?: LayoutOptions | string): string {
  const { extraHead = "", navbar = { section: "runs" } } = resolveLayoutOptions(options)
  const navbarHtml = renderAppNavbar(navbar)
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
${THEME_BOOT_SCRIPT}
</script>
${extraHead}
</head>
<body class="app-body">
${navbarHtml}
<main class="app-main">
${body}
</main>
<script>
${THEME_TOGGLE_SCRIPT}
</script>
</body>
</html>`
}

export function layoutHtmlViewer(title: string, body: string): string {
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
${THEME_BOOT_SCRIPT}
</script>
</head>
<body class="html-viewer-body">
${body}
<script>
${THEME_TOGGLE_SCRIPT}
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

export function phaseBadge(phase: string, status: RunStatus): string {
  const cls =
    status === "approved" ? "badge-approved" :
    status === "failed" ? "badge-failed" :
    "badge-running"
  return `<span class="badge ${cls}">${escapeHtml(phase)}: ${escapeHtml(status)}</span>`
}

/** User-facing design phase label — design has no quorum approval step. */
export function designStatusLabel(status: RunStatus): string {
  if (status === "approved") return "complete"
  return status
}

export function designPhaseBadge(status: RunStatus): string {
  const cls =
    status === "approved" ? "badge-approved" :
    status === "failed" ? "badge-failed" :
    "badge-running"
  return `<span class="badge ${cls}">Design: ${escapeHtml(designStatusLabel(status))}</span>`
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
