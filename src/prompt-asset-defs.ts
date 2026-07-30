export type PromptAssetDef = {
  file: string
  role: string
  label: string
}

export const promptAssetDefs = {
  researchDrafterDraft: {
    file: "research-drafter.draft.md",
    role: "research-drafter",
    label: "Draft",
  },
  researchDrafterReviewFindings: {
    file: "research-drafter.review-findings.md",
    role: "research-drafter",
    label: "Review findings",
  },
  researchDrafterReviewRebuttals: {
    file: "research-drafter.review-rebuttals.md",
    role: "research-drafter",
    label: "Review rebuttals",
  },
  researchDrafterRevise: {
    file: "research-drafter.revise.md",
    role: "research-drafter",
    label: "Revise draft",
  },
  sourceAuditorAudit: {
    file: "source-auditor.audit.md",
    role: "source-auditor",
    label: "Audit",
  },
  sourceAuditorRebuttal: {
    file: "source-auditor.rebuttal.md",
    role: "source-auditor",
    label: "Rebuttal",
  },
  logicAuditorAudit: {
    file: "logic-auditor.audit.md",
    role: "logic-auditor",
    label: "Audit",
  },
  logicAuditorRebuttal: {
    file: "logic-auditor.rebuttal.md",
    role: "logic-auditor",
    label: "Rebuttal",
  },
  clarityAuditorAudit: {
    file: "clarity-auditor.audit.md",
    role: "clarity-auditor",
    label: "Audit",
  },
  clarityAuditorRebuttal: {
    file: "clarity-auditor.rebuttal.md",
    role: "clarity-auditor",
    label: "Rebuttal",
  },
  readerInterviewerInterview: {
    file: "reader-interviewer.interview.md",
    role: "reader-interviewer",
    label: "Interview",
  },
  readerInterviewerFollowUp: {
    file: "reader-interviewer.follow-up.md",
    role: "reader-interviewer",
    label: "Follow-up",
  },
  readerInterviewerDuplicateCorrection: {
    file: "reader-interviewer.duplicate-correction.md",
    role: "reader-interviewer",
    label: "Duplicate correction",
  },
  htmlDesignerDesign: {
    file: "html-designer.design.md",
    role: "html-designer",
    label: "Design HTML",
  },
  interactiveEnhancerEnhance: {
    file: "interactive-enhancer.enhance.md",
    role: "interactive-enhancer",
    label: "Enhance",
  },
  readingExperienceEnhancerEnhance: {
    file: "reading-experience-enhancer.enhance.md",
    role: "reading-experience-enhancer",
    label: "Enhance",
  },
  htmlReadingCompanionAskPage: {
    file: "html-reading-companion.ask-page.md",
    role: "html-reading-companion",
    label: "Ask page",
  },
  htmlReadingCompanionAskHighlight: {
    file: "html-reading-companion.ask-highlight.md",
    role: "html-reading-companion",
    label: "Ask highlight",
  },
  markdownSummarizerInput: {
    file: "markdown-summarizer.input.md",
    role: "markdown-summarizer",
    label: "Summarize input",
  },
  markdownSummarizerArtifact: {
    file: "markdown-summarizer.artifact.md",
    role: "markdown-summarizer",
    label: "Summarize artifact",
  },
  researchTaggerTag: {
    file: "research-tagger.tag.md",
    role: "research-tagger",
    label: "Tag article",
  },
  jsonFixerFix: {
    file: "json-fixer.fix.md",
    role: "json-fixer",
    label: "Fix JSON",
  },
} as const satisfies Record<string, PromptAssetDef>

export type PromptAssetKey = keyof typeof promptAssetDefs

/** Filename lookup used by config/defaults stores. */
export const promptAssetFiles = Object.fromEntries(
  (Object.entries(promptAssetDefs) as Array<[PromptAssetKey, PromptAssetDef]>).map(([key, def]) => [key, def.file]),
) as Record<PromptAssetKey, string>

export function promptAssetsForRole(role: string): Array<{ key: PromptAssetKey; def: PromptAssetDef }> {
  return (Object.entries(promptAssetDefs) as Array<[PromptAssetKey, PromptAssetDef]>)
    .filter(([, def]) => def.role === role)
    .map(([key, def]) => ({ key, def }))
}

export function auditorAuditPromptKey(agent: string): PromptAssetKey {
  switch (agent) {
    case "source-auditor":
      return "sourceAuditorAudit"
    case "logic-auditor":
      return "logicAuditorAudit"
    case "clarity-auditor":
      return "clarityAuditorAudit"
    default:
      throw new Error(`No audit prompt asset for role ${JSON.stringify(agent)}`)
  }
}

export function auditorRebuttalPromptKey(agent: string): PromptAssetKey {
  switch (agent) {
    case "source-auditor":
      return "sourceAuditorRebuttal"
    case "logic-auditor":
      return "logicAuditorRebuttal"
    case "clarity-auditor":
      return "clarityAuditorRebuttal"
    default:
      throw new Error(`No rebuttal prompt asset for role ${JSON.stringify(agent)}`)
  }
}
