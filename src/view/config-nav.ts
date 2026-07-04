import { viewServerAdminEnabled } from "./server-options"

export type ConfigTab = "overview" | "roles" | "prompts" | "defaults"

export function configNav(active: ConfigTab) {
  const link = (href: string, label: string, tab: ConfigTab) =>
    `<a href="${href}"${tab === active ? ' class="active"' : ""}>${label}</a>`
  const defaultsLink = viewServerAdminEnabled()
    ? link("/config/defaults", "Defaults", "defaults")
    : ""
  return `<div class="config-nav">
  ${link("/config", "Active", "overview")}
  ${link("/config/roles", "Roles", "roles")}
  ${link("/config/prompts", "Prompts", "prompts")}
  ${defaultsLink}
</div>`
}

export function configBackLink() {
  return `<a class="back-link" href="/">← Back to runs</a>`
}
