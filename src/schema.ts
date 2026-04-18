import { z } from "zod"

// Shared helper for fields that should never be blank.
const nonEmptyStringSchema = z.string().min(1)

// Canonical schema for configured agent names.
const agentNameSchema = nonEmptyStringSchema

// Distinguishes whether a run starts from a topic prompt or a source document.
export const inputModeSchema = z.enum(["topic", "document"])

// Every auditor either approves the draft or asks for revision.
export const auditVoteSchema = z.enum(["approve", "revise"])

// Finding severity drives later aggregation and routing decisions.
export const findingSeveritySchema = z.enum(["blocker", "major", "minor"])

// Finding category keeps audit issues normalized across auditors.
export const findingCategorySchema = z.enum(["sources", "coherence", "clarity", "structure", "scope"])

// The drafter uses this to say how a disputed finding should be changed.
export const rebuttalResolutionSchema = z.enum(["withdraw", "soften", "reclassify", "withdraw_or_reclassify"])

// The auditor's final response to a rebuttal.
export const rebuttalDecisionSchema = z.enum(["uphold", "soften", "withdraw"])

// Aggregation collapses a round into one of these workflow outcomes.
export const aggregateOutcomeSchema = z.enum(["approved", "needs_revision", "failed_non_convergent"])

// High-level run status used in the graph state.
export const researchStatusSchema = z.enum(["drafting", "auditing", "rebutting", "revising", "approved", "failed"])

// Request payload when the user starts a run from a topic.
export const topicInputSchema = z.object({
  inputMode: z.literal("topic"),
  topic: nonEmptyStringSchema,
})

// Request payload when the user starts a run from a document path.
export const documentInputSchema = z.object({
  inputMode: z.literal("document"),
  documentPath: nonEmptyStringSchema,
})

// Entry-point request contract for the orchestrator.
export const inputRequestSchema = z.discriminatedUnion("inputMode", [topicInputSchema, documentInputSchema])

// One normalized issue raised by an auditor.
export const auditFindingSchema = z.object({
  severity: findingSeveritySchema,
  category: findingCategorySchema,
  issue: nonEmptyStringSchema,
  evidence: z.array(nonEmptyStringSchema).min(1),
  required_fix: nonEmptyStringSchema,
})

// Replacement form used when an auditor softens a finding during rebuttal.
export const updatedFindingSchema = z.object({
  severity: findingSeveritySchema,
  category: findingCategorySchema,
  issue: nonEmptyStringSchema,
  evidence: z.array(nonEmptyStringSchema).min(1),
  required_fix: nonEmptyStringSchema.optional(),
})

// Keeps audit votes and finding lists consistent with each other.
const validateAuditResult = (
  value: {
    vote: z.infer<typeof auditVoteSchema>
    findings: Array<unknown>
  },
  ctx: z.RefinementCtx,
) => {
  if (value.vote === "approve" && value.findings.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Approved audits must not include findings",
      path: ["findings"],
    })
  }

  if (value.vote === "revise" && value.findings.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Revision audits must include at least one finding",
      path: ["findings"],
    })
  }
}

// Shared audit payload before agent metadata is attached.
const auditResultBaseSchema = z.object({
  vote: auditVoteSchema,
  summary: nonEmptyStringSchema,
  findings: z.array(auditFindingSchema),
})

// Structured audit result returned by a single auditor call.
export const auditResultSchema = auditResultBaseSchema.superRefine(validateAuditResult)

// Audit result plus the name of the auditor that produced it.
export const auditResultRecordSchema = auditResultBaseSchema
  .extend({
    agent: agentNameSchema,
  })
  .superRefine(validateAuditResult)

// Structured rebuttal emitted by the drafter against one finding.
export const rebuttalSchema = z.object({
  targetAgent: agentNameSchema,
  findingIssue: nonEmptyStringSchema,
  position: z.literal("rebut"),
  argument: nonEmptyStringSchema,
  evidence: z.array(nonEmptyStringSchema).min(1),
  requestedResolution: rebuttalResolutionSchema,
})

// Shared fields present in every rebuttal response.
const rebuttalResponseBaseSchema = z.object({
  targetAgent: agentNameSchema,
  findingIssue: nonEmptyStringSchema,
  argument: nonEmptyStringSchema,
})

// Rebuttal response with the responding auditor attached.
const rebuttalResponseRecordBaseSchema = rebuttalResponseBaseSchema.extend({
  agent: agentNameSchema,
})

// Auditor response to a rebuttal before agent metadata is attached.
export const rebuttalResponseSchema = z.discriminatedUnion("decision", [
  rebuttalResponseBaseSchema.extend({
    decision: z.literal("uphold"),
  }),
  rebuttalResponseBaseSchema.extend({
    decision: z.literal("withdraw"),
  }),
  rebuttalResponseBaseSchema.extend({
    decision: z.literal("soften"),
    updatedFinding: updatedFindingSchema,
  }),
])

// Auditor response to a rebuttal with the responding agent recorded.
export const rebuttalResponseRecordSchema = z.discriminatedUnion("decision", [
  rebuttalResponseRecordBaseSchema.extend({
    decision: z.literal("uphold"),
  }),
  rebuttalResponseRecordBaseSchema.extend({
    decision: z.literal("withdraw"),
  }),
  rebuttalResponseRecordBaseSchema.extend({
    decision: z.literal("soften"),
    updatedFinding: updatedFindingSchema,
  }),
])

// Unresolved finding plus the auditor responsible for it.
export const aggregatedFindingSchema = auditFindingSchema.extend({
  agent: agentNameSchema,
})

// Post-aggregation view of the round after audits and rebuttals are merged.
export const aggregatedFindingsSchema = z
  .object({
    outcome: aggregateOutcomeSchema,
    approvedAgents: z.array(agentNameSchema),
    unresolvedFindings: z.array(aggregatedFindingSchema),
  })
  .superRefine((value, ctx) => {
    if (value.outcome === "approved" && value.unresolvedFindings.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Approved outcomes must not contain unresolved findings",
        path: ["unresolvedFindings"],
      })
    }

    if (value.outcome === "needs_revision" && value.unresolvedFindings.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Revision outcomes must include unresolved findings",
        path: ["unresolvedFindings"],
      })
    }
  })

// Durable graph state carried across drafting, auditing, rebuttal, and revision rounds.
export const researchStateSchema = z
  .object({
    requestId: nonEmptyStringSchema,
    inputMode: inputModeSchema,
    topic: nonEmptyStringSchema.optional(),
    documentPath: nonEmptyStringSchema.optional(),
    documentText: nonEmptyStringSchema.optional(),
    round: z.number().int().nonnegative(),
    draft: z.string(),
    audits: z.array(auditResultRecordSchema),
    rebuttals: z.array(rebuttalSchema),
    rebuttalResponses: z.array(rebuttalResponseRecordSchema),
    unresolvedFindings: z.array(aggregatedFindingSchema),
    approvedAgents: z.array(agentNameSchema),
    status: researchStatusSchema,
    rootSessionId: nonEmptyStringSchema.optional(),
    drafterSessionId: nonEmptyStringSchema.optional(),
    outputPath: nonEmptyStringSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.inputMode === "topic" && !value.topic) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Topic input mode requires a topic",
        path: ["topic"],
      })
    }

    if (value.inputMode === "document" && !value.documentPath && !value.documentText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Document input mode requires documentPath or documentText",
        path: ["documentPath"],
      })
    }
  })

export type InputRequest = z.infer<typeof inputRequestSchema>
export type AuditFinding = z.infer<typeof auditFindingSchema>
export type UpdatedFinding = z.infer<typeof updatedFindingSchema>
export type AuditResult = z.infer<typeof auditResultSchema>
export type AuditResultRecord = z.infer<typeof auditResultRecordSchema>
export type Rebuttal = z.infer<typeof rebuttalSchema>
export type RebuttalResponse = z.infer<typeof rebuttalResponseSchema>
export type RebuttalResponseRecord = z.infer<typeof rebuttalResponseRecordSchema>
export type AggregatedFinding = z.infer<typeof aggregatedFindingSchema>
export type AggregatedFindings = z.infer<typeof aggregatedFindingsSchema>
export type ResearchState = z.infer<typeof researchStateSchema>
