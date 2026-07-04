import { viewServerAdminEnabled } from "./server-options"
import type { AppNavbarOptions } from "./app-nav"

export type ConfigTab = "overview" | "roles" | "prompts" | "defaults"

export function configSubNav(active: ConfigTab) {
  const link = (href: string, label: string, tab: ConfigTab) =>
    `<a href="${href}"${tab === active ? ' class="active"' : ""}>${label}</a>`
  const defaultsLink = viewServerAdminEnabled()
    ? link("/config/defaults", "Defaults", "defaults")
    : ""
  return `${link("/config", "Active", "overview")}
  ${link("/config/roles", "Roles", "roles")}
  ${link("/config/prompts", "Prompts", "prompts")}
  ${defaultsLink}`
}

export function configNavbarOptions(title: string, active: ConfigTab): AppNavbarOptions {
  return {
    section: "config",
    title,
    subNavHtml: configSubNav(active),
  }
}

/** @deprecated Use configSubNav inside renderAppNavbar subNavHtml */
export function configNav(active: ConfigTab) {
  return `<div class="config-nav">${configSubNav(active)}</div>`
}
