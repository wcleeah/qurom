export const DESIGNER_ROLE = "html-designer"
export const INTERACTIVE_ENHANCER_ROLE = "interactive-enhancer"
export const READING_EXPERIENCE_ENHANCER_ROLE = "reading-experience-enhancer"

/** Ordered design HTML pipeline roles (each writes its own artifact). */
export const DESIGN_HTML_PIPELINE_ROLES = [
  DESIGNER_ROLE,
  INTERACTIVE_ENHANCER_ROLE,
  READING_EXPERIENCE_ENHANCER_ROLE,
] as const

export type DesignHtmlPipelineRole = (typeof DESIGN_HTML_PIPELINE_ROLES)[number]

export const LEGACY_DESIGN_HTML_ROUND_RE = /^design-html-round-(\d+)\.html$/
export const DESIGN_HTML_ROLE_RE = /^design-html-(.+)\.html$/

export function designHtmlArtifactName(role: string): string {
  return `design-html-${role}.html`
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
  const roleFiles = DESIGN_HTML_PIPELINE_ROLES
    .map((role) => designHtmlArtifactName(role))
    .filter((name) => files.includes(name))
  const extras = files
    .filter((f) => isDesignHtmlArtifact(f) && !roleFiles.includes(f))
    .sort()
  return [...roleFiles, ...extras]
}

/** Prefer the latest pipeline role file, then any other design HTML, then legacy rounds. */
export function latestDesignHtmlArtifact(files: string[]): string | undefined {
  for (let i = DESIGN_HTML_PIPELINE_ROLES.length - 1; i >= 0; i--) {
    const name = designHtmlArtifactName(DESIGN_HTML_PIPELINE_ROLES[i]!)
    if (files.includes(name)) return name
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
    const name = designHtmlArtifactName(DESIGN_HTML_PIPELINE_ROLES[i]!)
    if (files.includes(name)) return name
  }
  return latestDesignHtmlArtifact(files.filter((f) => LEGACY_DESIGN_HTML_ROUND_RE.test(f)))
}
