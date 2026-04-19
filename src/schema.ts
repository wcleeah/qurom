import { z } from "zod"

const nonEmptyStringSchema = z.string().min(1)
const agentNameSchema = nonEmptyStringSchema
const findingIdSchema = nonEmptyStringSchema
const inputModeSchema = z.enum(["topic", "document"])
const auditVoteSchema = z.enum(["approve", "revise"])
const findingSeveritySchema = z.enum(["blocker", "major", "minor"])
const findingCategorySchema = z.enum(["sources", "coherence", "clarity", "structure", "scope"])
const rebuttalResolutionSchema = z.enum(["withdraw", "soften", "reclassify", "withdraw_or_reclassify"])
const aggregateOutcomeSchema = z.enum(["approved", "needs_revision", "failed_non_convergent"])
const failureReasonSchema = z.enum(["max_rounds_exhausted", "stagnated_findings"])
const researchStatusSchema = z.enum([
  "drafting",
  "auditing",
  "reviewing_findings",
  "awaiting_auditor_rebuttal",
  "reviewing_rebuttal_responses",
  "aggregating",
  "revising",
  "approved",
  "failed",
])

const topicInputSchema = z.object({
  inputMode: z.literal("topic"),
  topic: nonEmptyStringSchema,
})

const documentInputSchema = z.object({
  inputMode: z.literal("document"),
  documentPath: nonEmptyStringSchema,
})

export const inputRequestSchema = z.discriminatedUnion("inputMode", [topicInputSchema, documentInputSchema])

export const graphInputSchema = z.object({
  inputMode: inputModeSchema,
  topic: nonEmptyStringSchema.optional(),
  documentPath: nonEmptyStringSchema.optional(),
  requestId: nonEmptyStringSchema.optional(),
})

const auditFindingSchema = z.object({
  severity: findingSeveritySchema,
  category: findingCategorySchema,
  issue: nonEmptyStringSchema,
  evidence: z.array(nonEmptyStringSchema).min(1),
  required_fix: nonEmptyStringSchema,
})

const identifiedAuditFindingSchema = auditFindingSchema.extend({
  findingId: findingIdSchema,
})

const updatedFindingSchema = z.object({
  severity: findingSeveritySchema,
  category: findingCategorySchema,
  issue: nonEmptyStringSchema,
  evidence: z.array(nonEmptyStringSchema).min(1),
  required_fix: nonEmptyStringSchema.optional(),
})

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

const auditResultBaseSchema = z.object({
  vote: auditVoteSchema,
  summary: nonEmptyStringSchema,
  findings: z.array(auditFindingSchema),
})

const auditResultRecordBaseSchema = z.object({
  vote: auditVoteSchema,
  summary: nonEmptyStringSchema,
  findings: z.array(identifiedAuditFindingSchema),
})

export const auditResultSchema = auditResultBaseSchema.superRefine(validateAuditResult)

export const auditResultRecordSchema = auditResultRecordBaseSchema
  .extend({
    agent: agentNameSchema,
  })
  .superRefine(validateAuditResult)

export const rebuttalSchema = z.object({
  targetAgent: agentNameSchema,
  findingId: findingIdSchema,
  findingCategory: findingCategorySchema,
  findingIssue: nonEmptyStringSchema,
  position: z.literal("rebut"),
  argument: nonEmptyStringSchema,
  evidence: z.array(nonEmptyStringSchema).min(1),
  requestedResolution: rebuttalResolutionSchema,
})

const findingReferenceSchema = z.object({
  targetAgent: agentNameSchema,
  findingId: findingIdSchema,
  findingCategory: findingCategorySchema,
  findingIssue: nonEmptyStringSchema,
})

export const drafterFindingReviewSchema = z.object({
  acceptedFindings: z.array(findingReferenceSchema),
  rebuttals: z.array(rebuttalSchema),
})

const rebuttalResponseBaseSchema = z.object({
  targetAgent: agentNameSchema,
  findingId: findingIdSchema,
  findingCategory: findingCategorySchema,
  findingIssue: nonEmptyStringSchema,
  argument: nonEmptyStringSchema,
})

const rebuttalResponseRecordBaseSchema = rebuttalResponseBaseSchema.extend({
  agent: agentNameSchema,
  turn: z.number().int().positive(),
})

const rebuttalResponseSchema = z.discriminatedUnion("decision", [
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

export const rebuttalBatchResponseSchema = z.object({
  responses: z.array(rebuttalResponseSchema),
})

const findingKeySchema = findingIdSchema

const rebuttalHistoryEntrySchema = z.object({
  findingKey: findingKeySchema,
  round: z.number().int().nonnegative(),
  turn: z.number().int().positive(),
  rebuttal: rebuttalSchema,
})

const rebuttalResponseHistoryEntrySchema = z.object({
  findingKey: findingKeySchema,
  round: z.number().int().nonnegative(),
  turn: z.number().int().positive(),
  response: rebuttalResponseRecordSchema,
})

export const aggregatedFindingSchema = identifiedAuditFindingSchema.extend({
  agent: agentNameSchema,
})

export const runSummarySchema = z.object({
  requestId: nonEmptyStringSchema,
  outcome: aggregateOutcomeSchema,
  round: z.number().int().nonnegative(),
  approvedAgents: z.array(agentNameSchema),
  unresolvedFindings: z.array(aggregatedFindingSchema),
  rebuttalTurnCounts: z.record(findingKeySchema, z.number().int().positive()),
  rebuttalHistory: z.array(rebuttalHistoryEntrySchema),
  rebuttalResponseHistory: z.array(rebuttalResponseHistoryEntrySchema),
  failureReason: failureReasonSchema.optional(),
})

export const aggregatedFindingsSchema = z
  .object({
    outcome: aggregateOutcomeSchema,
    approvedAgents: z.array(agentNameSchema),
    unresolvedFindings: z.array(aggregatedFindingSchema),
    failureReason: failureReasonSchema.optional(),
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

export const researchStateObjectSchema = z.object({
  requestId: nonEmptyStringSchema,
  inputMode: inputModeSchema,
  topic: nonEmptyStringSchema.optional(),
  documentPath: nonEmptyStringSchema.optional(),
  documentText: nonEmptyStringSchema.optional(),
  round: z.number().int().nonnegative(),
  draft: z.string(),
  audits: z.array(auditResultRecordSchema),
  auditSessionIds: z.record(agentNameSchema, nonEmptyStringSchema),
  activeRebuttals: z.record(findingKeySchema, rebuttalSchema),
  currentRebuttalResponsesByFinding: z.record(findingKeySchema, rebuttalResponseRecordSchema),
  rebuttalTurnCounts: z.record(findingKeySchema, z.number().int().positive()),
  rebuttalHistory: z.array(rebuttalHistoryEntrySchema),
  rebuttalResponseHistory: z.array(rebuttalResponseHistoryEntrySchema),
  unresolvedFindings: z.array(aggregatedFindingSchema),
  lastUnresolvedSignature: nonEmptyStringSchema.optional(),
  approvedAgents: z.array(agentNameSchema),
  status: researchStatusSchema,
  failureReason: failureReasonSchema.optional(),
  rootSessionId: nonEmptyStringSchema.optional(),
  drafterSessionId: nonEmptyStringSchema.optional(),
  outputPath: nonEmptyStringSchema.optional(),
})

export const researchStateSchema = researchStateObjectSchema.superRefine((value, ctx) => {
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

  if (value.status === "drafting" && value.round !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Drafting state must start at round 0",
      path: ["round"],
    })
  }
})

export type InputRequest = z.infer<typeof inputRequestSchema>
export type GraphInput = z.infer<typeof graphInputSchema>
export type AuditResult = z.infer<typeof auditResultSchema>
export type AuditResultRecord = z.infer<typeof auditResultRecordSchema>
export type Rebuttal = z.infer<typeof rebuttalSchema>
export type RebuttalResponseRecord = z.infer<typeof rebuttalResponseRecordSchema>
export type AggregatedFinding = z.infer<typeof aggregatedFindingSchema>
export type AggregatedFindings = z.infer<typeof aggregatedFindingsSchema>
export type ResearchState = z.infer<typeof researchStateSchema>
