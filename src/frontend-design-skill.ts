import { join } from "node:path"

import { defaultsOpencodeSkillsDir, opencodeSkillsDir } from "./data-paths"
import { DESIGN_QUORUM_ROLES } from "./role-registry"

export const FRONTEND_DESIGN_SKILL_NAME = "frontend-design"

export function usesFrontendDesignSkill(role: string): boolean {
  return (DESIGN_QUORUM_ROLES as readonly string[]).includes(role)
}

export async function readFrontendDesignSkill(workspaceDir?: string): Promise<string> {
  const candidates = [
    join(opencodeSkillsDir(workspaceDir), FRONTEND_DESIGN_SKILL_NAME, "SKILL.md"),
    join(defaultsOpencodeSkillsDir(workspaceDir), FRONTEND_DESIGN_SKILL_NAME, "SKILL.md"),
  ]
  for (const path of candidates) {
    const file = Bun.file(path)
    if (!(await file.exists())) continue
    const text = (await file.text()).trim()
    if (text) return text
  }
  throw new Error(`Missing ${FRONTEND_DESIGN_SKILL_NAME} skill under defaults/opencode/skills or .opencode/skills`)
}

export async function prependFrontendDesignSkill(prompt: string, workspaceDir?: string): Promise<string> {
  const skill = await readFrontendDesignSkill(workspaceDir)
  return [
    "The `frontend-design` skill is included below. Follow it. If a skill tool is available, you may also load `frontend-design` to refresh it.",
    "",
    "<frontend_design_skill>",
    skill,
    "</frontend_design_skill>",
    "",
    prompt,
  ].join("\n")
}
