export const DESIGNER_ROLE = "html-designer"
export const GRAPHICAL_ENHANCER_ROLE = "graphical-enhancer"
export const READING_EXPERIENCE_ENHANCER_ROLE = "reading-experience-enhancer"
export const LEGACY_INTERACTIVE_ENHANCER_ROLE = "interactive-enhancer"

/** Ordered design HTML pipeline roles (each writes its own artifact). */
export const DESIGN_HTML_PIPELINE_ROLES = [
  DESIGNER_ROLE,
  GRAPHICAL_ENHANCER_ROLE,
  READING_EXPERIENCE_ENHANCER_ROLE,
] as const

export type DesignHtmlPipelineRole = (typeof DESIGN_HTML_PIPELINE_ROLES)[number]

export const LEGACY_DESIGN_HTML_ROUND_RE = /^design-html-round-(\d+)\.html$/
export const DESIGN_HTML_ROLE_RE = /^design-html-(.+)\.html$/

export function designHtmlArtifactName(role: string): string {
  return `design-html-${role}.html`
}

/** Canonical artifact first, then retired aliases for the same pipeline slot. */
export function designHtmlArtifactNames(role: string): string[] {
  const canonical = designHtmlArtifactName(role)
  if (role === GRAPHICAL_ENHANCER_ROLE) {
    return [canonical, designHtmlArtifactName(LEGACY_INTERACTIVE_ENHANCER_ROLE)]
  }
  return [canonical]
}

export function presentDesignHtmlArtifact(role: string, files: string[]): string | undefined {
  return designHtmlArtifactNames(role).find((name) => files.includes(name))
}

export function designHtmlRoleFromFilename(filename: string): string | undefined {
  if (LEGACY_DESIGN_HTML_ROUND_RE.test(filename)) return undefined
  const match = filename.match(DESIGN_HTML_ROLE_RE)
  return match?.[1]
}

export function isDesignHtmlArtifact(filename: string): boolean {
  return LEGACY_DESIGN_HTML_ROUND_RE.test(filename) || designHtmlRoleFromFilename(filename) !== undefined
}

export function designHtmlArtifacts(files: string[]): string[] {
  const roleFiles: string[] = []
  for (const role of DESIGN_HTML_PIPELINE_ROLES) {
    for (const name of designHtmlArtifactNames(role)) {
      if (files.includes(name) && !roleFiles.includes(name)) roleFiles.push(name)
    }
  }
  const extras = files
    .filter((f) => isDesignHtmlArtifact(f) && !roleFiles.includes(f))
    .sort()
  return [...roleFiles, ...extras]
}

/** Prefer the latest pipeline role file, then any other design HTML, then legacy rounds. */
export function latestDesignHtmlArtifact(files: string[]): string | undefined {
  for (let i = DESIGN_HTML_PIPELINE_ROLES.length - 1; i >= 0; i--) {
    const found = presentDesignHtmlArtifact(DESIGN_HTML_PIPELINE_ROLES[i]!, files)
    if (found) return found
  }
  const legacy = files
    .filter((f) => LEGACY_DESIGN_HTML_ROUND_RE.test(f))
    .sort((a, b) => {
      const ra = Number.parseInt(a.match(LEGACY_DESIGN_HTML_ROUND_RE)?.[1] ?? "0", 10)
      const rb = Number.parseInt(b.match(LEGACY_DESIGN_HTML_ROUND_RE)?.[1] ?? "0", 10)
      return rb - ra
    })
  return legacy[0] ?? designHtmlArtifacts(files)[0]
}

export function previousDesignHtmlArtifact(
  role: DesignHtmlPipelineRole,
  files: string[],
): string | undefined {
  const index = DESIGN_HTML_PIPELINE_ROLES.indexOf(role)
  if (index <= 0) return undefined
  for (let i = index - 1; i >= 0; i--) {
    const found = presentDesignHtmlArtifact(DESIGN_HTML_PIPELINE_ROLES[i]!, files)
    if (found) return found
  }
  return latestDesignHtmlArtifact(files.filter((f) => LEGACY_DESIGN_HTML_ROUND_RE.test(f)))
}
