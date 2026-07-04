let adminEnabled = false

export function configureViewServer(options: { admin?: boolean }) {
  adminEnabled = Boolean(options.admin)
}

export function viewServerAdminEnabled() {
  return adminEnabled
}
