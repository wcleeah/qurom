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

export const readabilityReportSchema = z.object({
  round: z.number().int().nonnegative(),
  try: z.number().int().nonnegative(),
  model: z.string().min(1),
  passed: z.boolean(),
  fused: z.boolean().optional(),
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
