export const promptAssetFiles = {
  deepDiveContract: "deep-dive-contract.md",
  draftFullDraft: "draft-full-draft.md",
  reviseDraft: "revise-draft.md",
  audit: "audit.md",
  reviewFindings: "review-findings.md",
  rebuttal: "rebuttal.md",
  reviewRebuttalResponses: "review-rebuttal-responses.md",
  designHtml: "design-html.md",
  auditDesign: "audit-design.md",
  auditScriptSecurity: "audit-script-security.md",
  reviseDesign: "revise-design.md",
  readerInterview: "reader-interview.md",
  readerInterviewFollowUp: "reader-interview-follow-up.md",
  readerInterviewDuplicateCorrection: "reader-interview-duplicate-correction.md",
  enhanceDesign: "enhance-design.md",
} as const

export type PromptAssetKey = keyof typeof promptAssetFiles
