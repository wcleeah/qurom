import { readdir } from "node:fs/promises"
import { join } from "node:path"

export const DESIGNER_ROLE = "html-designer"
export const GRAPHICAL_ENHANCER_ROLE = "graphical-enhancer"
export const READING_EXPERIENCE_ENHANCER_ROLE = "reading-experience-enhancer"
export const HTML_REVIEWER_ROLE = "html-reviewer"
export const LEGACY_INTERACTIVE_ENHANCER_ROLE = "interactive-enhancer"

/** Live HTML the three generative design roles edit. Role files are snapshots. */
export const DESIGN_WORKING_FILENAME = "design.html"

export function designWorkingPath(outputPath: string) {
  return join(outputPath, DESIGN_WORKING_FILENAME)
}

export async function snapshotWorkingDesign(outputPath: string, destFilename: string) {
  const source = designWorkingPath(outputPath)
  const file = Bun.file(source)
  if (!(await file.exists())) {
    throw new Error(`Working design ${DESIGN_WORKING_FILENAME} is missing`)
  }
  const text = await file.text()
  if (!text.trim()) {
    throw new Error(`Working design ${DESIGN_WORKING_FILENAME} is empty`)
  }
  await Bun.write(join(outputPath, destFilename), text)
  return text
}

/** Ordered design HTML pipeline roles (each writes its own artifact). */
export const DESIGN_HTML_PIPELINE_ROLES = [
  DESIGNER_ROLE,
  GRAPHICAL_ENHANCER_ROLE,
  READING_EXPERIENCE_ENHANCER_ROLE,
  HTML_REVIEWER_ROLE,
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

/** User-facing label for a design pipeline role (not a research round). */
export function designStageLabel(role: string): string {
  switch (role) {
    case DESIGNER_ROLE: return "HTML designer"
    case GRAPHICAL_ENHANCER_ROLE: return "Graphical enhancer"
    case LEGACY_INTERACTIVE_ENHANCER_ROLE: return "Graphical enhancer (legacy)"
    case READING_EXPERIENCE_ENHANCER_ROLE: return "Reading experience"
    case HTML_REVIEWER_ROLE: return "HTML review"
    default: return role.replace(/-/g, " ")
  }
}

export function designHtmlPanelTitle(filename: string): string {
  const role = designHtmlRoleFromFilename(filename)
  if (role) return designStageLabel(role)
  const round = filename.match(LEGACY_DESIGN_HTML_ROUND_RE)?.[1]
  if (round) return `Legacy HTML · round ${round}`
  return filename
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

export async function restoreWorkingDesignFromPreviousSnapshot(
  outputPath: string,
  role: DesignHtmlPipelineRole,
): Promise<string | undefined> {
  let files: string[] = []
  try {
    files = await readdir(outputPath)
  } catch {
    return undefined
  }
  const name = previousDesignHtmlArtifact(role, files)
  if (!name) return undefined
  const text = await Bun.file(join(outputPath, name)).text()
  if (!text.trim()) return undefined
  await Bun.write(designWorkingPath(outputPath), text)
  return name
}
