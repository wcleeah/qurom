import { escapeHtml } from "./utils"

export type AppSection = "runs" | "library" | "config"

export type AppNavbarOptions = {
  section: AppSection
  back?: { href: string; label: string }
  title?: string
  /** Always-visible actions (e.g. HTML viewer Highlight / Ask). */
  primaryActionsHtml?: string
  /** Secondary actions — inline on desktop, overflow menu on mobile. */
  actionsHtml?: string
  subNavHtml?: string
}

const SECTION_ITEMS: Array<{ id: AppSection; href: string; label: string }> = [
  { id: "runs", href: "/", label: "Runs" },
  { id: "library", href: "/library", label: "Library" },
  { id: "config", href: "/config", label: "Config" },
]

function sectionLabel(section: AppSection): string {
  return SECTION_ITEMS.find((item) => item.id === section)?.label ?? "Runs"
}

function appNavPills(active: AppSection): string {
  const pill = (href: string, label: string, isActive: boolean) =>
    `<a class="app-navbar-pill${isActive ? " app-navbar-pill-active" : ""}" href="${href}">${label}</a>`
  return `<nav class="app-navbar-pills" aria-label="Site">${SECTION_ITEMS.map((item) =>
    pill(item.href, item.label, active === item.id),
  ).join("")}</nav>`
}

function appNavSectionMenu(active: AppSection): string {
  const items = SECTION_ITEMS.map((item) => {
    const isActive = item.id === active
    return `<a class="app-navbar-menu-item${isActive ? " app-navbar-menu-item-active" : ""}" href="${item.href}"${isActive ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`
  }).join("")
  return `<div class="app-navbar-section-menu" data-nav-menu>
  <button type="button" class="app-navbar-section-toggle" data-nav-menu-toggle aria-expanded="false" aria-haspopup="true" aria-label="Site sections">
    <span class="app-navbar-section-current">${escapeHtml(sectionLabel(active))}</span>
    <span class="app-navbar-section-chevron" aria-hidden="true">▾</span>
  </button>
  <div class="app-navbar-section-panel" data-nav-menu-panel role="menu" aria-label="Site sections">${items}</div>
</div>`
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

/** Client script: open/close section + overflow menus (Escape / outside click). */
export const NAV_DROPDOWNS_SCRIPT = /* html */ `
<script>
(function () {
  function closeMenu(menu) {
    if (!(menu instanceof HTMLElement)) return
    menu.removeAttribute("data-nav-menu-open")
    const toggle = menu.querySelector("[data-nav-menu-toggle]")
    if (toggle instanceof HTMLElement) toggle.setAttribute("aria-expanded", "false")
  }

  function closeAll(except) {
    for (const menu of document.querySelectorAll("[data-nav-menu][data-nav-menu-open]")) {
      if (menu !== except) closeMenu(menu)
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const toggle = target.closest("[data-nav-menu-toggle]")
    if (toggle instanceof HTMLElement) {
      const menu = toggle.closest("[data-nav-menu]")
      if (!(menu instanceof HTMLElement)) return
      const willOpen = !menu.hasAttribute("data-nav-menu-open")
      closeAll()
      if (willOpen) {
        menu.setAttribute("data-nav-menu-open", "")
        toggle.setAttribute("aria-expanded", "true")
      }
      return
    }
    if (!target.closest("[data-nav-menu]")) closeAll()
  })

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll()
  })
})();
</script>`

export function renderAppNavbar(options: AppNavbarOptions): string {
  const start: string[] = [appNavPills(options.section), appNavSectionMenu(options.section)]

  if (options.back) {
    start.push(`<a class="app-navbar-back" href="${options.back.href}">${escapeHtml(options.back.label)}</a>`)
  }

  if (options.title) {
    start.push(`<span class="app-navbar-title" title="${escapeHtml(options.title)}">${escapeHtml(options.title)}</span>`)
  }

  const primary = options.primaryActionsHtml ?? ""
  const secondary = options.actionsHtml ?? ""
  const actions = `<div class="app-navbar-actions">
  ${primary}
  <div class="app-navbar-overflow" data-nav-menu>
    <button type="button" class="app-navbar-overflow-toggle" data-nav-menu-toggle aria-expanded="false" aria-haspopup="true" aria-label="More actions">
      <span aria-hidden="true">⋯</span>
    </button>
    <div class="app-navbar-overflow-panel" data-nav-menu-panel>
      ${secondary}${appNavbarThemeToggle()}
    </div>
  </div>
</div>`

  const mainRow = `<header class="app-navbar">
  <div class="app-navbar-start">${start.join("")}</div>
  ${actions}
</header>`

  const subNav = options.subNavHtml
    ? `<div class="app-navbar-sub">${options.subNavHtml}</div>`
    : ""

  return `<div class="app-navbar-shell">${mainRow}${subNav}</div>`
}
