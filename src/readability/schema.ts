import { z } from "zod"

export const SCORE_CRITERIA = ["convolution", "inversion", "diction", "formality", "density"] as const
export type ScoreCriterion = (typeof SCORE_CRITERIA)[number]

export const REMEDY_CHOICES = [
  "unnest",
  "split",
  "uninvert",
  "simplify_words",
  "lower_register",
  "keep",
] as const
export type RemedyChoice = (typeof REMEDY_CHOICES)[number]

export const readabilitySkipReasonSchema = z.enum(["disabled", "no_api_key", "error"])

const probabilityMapSchema = z.record(z.string(), z.number())

export const scoreAnswerSchema = z.object({
  score: z.number(),
  confidence: z.number().min(0).max(1),
  probabilities: probabilityMapSchema,
  legend: z.record(z.string(), z.string()),
})

export const choiceAnswerSchema = z.object({
  choice: z.enum(REMEDY_CHOICES),
  confidence: z.number().min(0).max(1),
  probabilities: probabilityMapSchema,
})

export const readabilityUnitSchema = z.object({
  id: z.string().min(1),
  section: z.string(),
  quote: z.string(),
  scores: z.object({
    convolution: scoreAnswerSchema,
    inversion: scoreAnswerSchema,
    diction: scoreAnswerSchema,
    formality: scoreAnswerSchema,
    density: scoreAnswerSchema,
  }),
  gates: z.object({
    inversionEarned: z.number().min(0).max(1).optional(),
    densityIsOneMove: z.number().min(0).max(1).optional(),
    dictionIsDomainTerm: z.number().min(0).max(1).optional(),
  }),
  remedy: choiceAnswerSchema,
})

export const readabilityHotspotSchema = z.object({
  unitId: z.string().min(1),
  section: z.string(),
  quote: z.string(),
  criterion: z.enum(SCORE_CRITERIA),
  score: z.number(),
  confidence: z.number().min(0).max(1),
  remedy: z.enum(REMEDY_CHOICES),
})

export const readabilityThresholdsSchema = z.object({
  scoreTrip: z.number(),
  scoreConfidence: z.number(),
  formalityTrip: z.number(),
  noulVeto: z.number(),
})

export const readabilityReportKindSchema = z.enum(["gate", "posthoc"])

export const readabilityReportSchema = z.object({
  round: z.number().int().nonnegative(),
  try: z.number().int().nonnegative(),
  model: z.string().min(1),
  passed: z.boolean(),
  fused: z.boolean().optional(),
  kind: readabilityReportKindSchema.optional(),
  sourceFile: z.string().optional(),
  reviewedAt: z.string().optional(),
  skipped: z
    .object({
      reason: readabilitySkipReasonSchema,
      detail: z.string().optional(),
    })
    .optional(),
  thresholds: readabilityThresholdsSchema.optional(),
  units: z.array(readabilityUnitSchema),
  hotspots: z.array(readabilityHotspotSchema),
})

export type ReadabilityReport = z.infer<typeof readabilityReportSchema>
export type ReadabilityUnit = z.infer<typeof readabilityUnitSchema>
export type ReadabilityHotspot = z.infer<typeof readabilityHotspotSchema>
export type ScoreAnswer = z.infer<typeof scoreAnswerSchema>

export function readabilityReportFilename(round: number, tryIndex: number) {
  return `readability-round-${round}-try-${tryIndex}.json`
}

export function readabilityRawFilename(round: number, tryIndex: number) {
  return `readability-round-${round}-try-${tryIndex}.jev.json`
}

export function readabilityDraftFilename(round: number, tryIndex: number) {
  return `draft-round-${round}-readability-${tryIndex}.md`
}

export const POSTHOC_REPORT_FILENAME = "readability-review.json"
export const POSTHOC_RAW_FILENAME = "readability-review.jev.json"
export const POSTHOC_STATUS_FILENAME = "readability-review-status.json"

export const READABILITY_GATE_REPORT_RE = /^readability-round-\d+-try-\d+\.json$/
export const READABILITY_GATE_RAW_RE = /^readability-round-\d+-try-\d+\.jev\.json$/

export function isPosthocReadabilityReport(filename: string) {
  return filename === POSTHOC_REPORT_FILENAME
}

export function isReadabilityReportFilename(filename: string) {
  return READABILITY_GATE_REPORT_RE.test(filename) || isPosthocReadabilityReport(filename)
}

export function isPosthocReadabilityArtifact(filename: string) {
  return filename === POSTHOC_REPORT_FILENAME
    || filename === POSTHOC_RAW_FILENAME
    || filename === POSTHOC_STATUS_FILENAME
}
