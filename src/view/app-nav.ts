import { escapeHtml } from "./utils"

export type AppSection = "runs" | "library" | "config"

export type AppNavbarOptions = {
  section: AppSection
  back?: { href: string; label: string }
  title?: string
  actionsHtml?: string
  subNavHtml?: string
}

function appNavPills(active: AppSection): string {
  const pill = (href: string, label: string, isActive: boolean) =>
    `<a class="app-navbar-pill${isActive ? " app-navbar-pill-active" : ""}" href="${href}">${label}</a>`
  return `<nav class="app-navbar-pills" aria-label="Site">${pill("/", "Runs", active === "runs")}${pill("/library", "Library", active === "library")}${pill("/config", "Config", active === "config")}</nav>`
}

export function appNavbarAction(href: string, label: string, className = "", extraAttrs = ""): string {
  const cls = className ? `app-navbar-action ${className}` : "app-navbar-action"
  return `<a class="${cls}" href="${href}"${extraAttrs ? ` ${extraAttrs}` : ""}>${escapeHtml(label)}</a>`
}

export function appNavbarButton(label: string, attrs = ""): string {
  return `<button type="button" class="app-navbar-action"${attrs ? ` ${attrs}` : ""}>${escapeHtml(label)}</button>`
}

export function appNavbarThemeToggle(className = "app-navbar-theme-toggle"): string {
  return `<button type="button" class="theme-toggle ${className}" data-theme-toggle aria-label="Toggle color theme"></button>`
}

export function renderAppNavbar(options: AppNavbarOptions): string {
  const start: string[] = [appNavPills(options.section)]

  if (options.back) {
    start.push(`<a class="app-navbar-back" href="${options.back.href}">${escapeHtml(options.back.label)}</a>`)
  }

  if (options.title) {
    start.push(`<span class="app-navbar-title" title="${escapeHtml(options.title)}">${escapeHtml(options.title)}</span>`)
  }

  const actions = options.actionsHtml ?? ""
  const mainRow = `<header class="app-navbar">
  <div class="app-navbar-start">${start.join("")}</div>
  <div class="app-navbar-actions">${actions}${appNavbarThemeToggle()}</div>
</header>`

  const subNav = options.subNavHtml
    ? `<div class="app-navbar-sub">${options.subNavHtml}</div>`
    : ""

  return `<div class="app-navbar-shell">${mainRow}${subNav}</div>`
}
