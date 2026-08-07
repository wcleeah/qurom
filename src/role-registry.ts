import type { RuntimeConfig } from "./config"
import type { AgentRole } from "./providers/types"
import {
  DESIGNER_ROLE,
  INTERACTIVE_ENHANCER_ROLE,
  READING_EXPERIENCE_ENHANCER_ROLE,
} from "./design-artifacts"

export const DRAFTER_ROLE = "research-drafter"
export const SUMMARIZER_ROLE = "markdown-summarizer"
export const TAGGER_ROLE = "research-tagger"
export { DESIGNER_ROLE, INTERACTIVE_ENHANCER_ROLE, READING_EXPERIENCE_ENHANCER_ROLE }

export const AUDITOR_ROLES = [
  "source-auditor",
  "logic-auditor",
  "clarity-auditor",
] as const

export const HTML_REPAIR_ROLE = "html-repair"

export const UTILITY_ROLES = [
  "reader-interviewer",
  "json-fixer",
  "html-reading-companion",
  HTML_REPAIR_ROLE,
  TAGGER_ROLE,
] as const

export const DESIGN_QUORUM_ROLES = [
  DESIGNER_ROLE,
  INTERACTIVE_ENHANCER_ROLE,
  READING_EXPERIENCE_ENHANCER_ROLE,
] as const

export const DEFAULT_PROVIDER = "opencode"

export function configuredAgentRoles(config: RuntimeConfig): AgentRole[] {
  const roles: AgentRole[] = [
    ...UTILITY_ROLES,
    DRAFTER_ROLE,
    ...AUDITOR_ROLES,
    SUMMARIZER_ROLE,
  ]

  if (config.quorumConfig.designQuorum?.enabled) {
    roles.push(...DESIGN_QUORUM_ROLES)
  }

  return [...new Set(roles)]
}

export function requiredOpenCodeAgentRoles(config: RuntimeConfig): AgentRole[] {
  const roles: AgentRole[] = [DRAFTER_ROLE, ...AUDITOR_ROLES, SUMMARIZER_ROLE, TAGGER_ROLE]
  if (config.quorumConfig.designQuorum?.enabled) {
    roles.push(DESIGNER_ROLE)
  }
  return roles
}
