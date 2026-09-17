import { choice, noul, score } from "@typesafe-ai/sdk"

import type { QuorumConfig } from "../config"
import type { ScoreCriterion } from "./schema"

export type ReadabilityThresholds = {
  scoreTrip: number
  scoreConfidence: number
  formalityTrip: number
  noulVeto: number
}

export const DEFAULT_READABILITY_THRESHOLDS: ReadabilityThresholds = {
  scoreTrip: 1.3,
  scoreConfidence: 0.5,
  formalityTrip: 1.6,
  noulVeto: 0.4,
}

export const READABILITY_REGISTER =
  "Technical research prose for a fluent non-native English reader. Domain terms are allowed. Flag nested syntax and ornamental diction, not necessary terminology."

export const READABILITY_AUDIENCE =
  "The reader is fluent but not a native English speaker. Judge first-pass processing cost for that reader."

const CONVOLUTION_LEVELS = [
  "Direct: canonical order, one move per sentence",
  "Some extra clauses; still parseable on first read",
  "Requires re-reading: nested or piled modifiers bury the subject",
] as const

const INVERSION_LEVELS = [
  "Canonical order",
  "Marked order that still lands cleanly",
  "Marked order that makes the sentence costly",
] as const

const DICTION_LEVELS = [
  "Simplest accurate words",
  "Mixed: some ornamental synonyms",
  "Ornate where a simpler word would do",
] as const

const FORMALITY_LEVELS = [
  "Natural for this subject and reader",
  "Stiff but still in register",
  "Performatively academic: Latinate padding, dummy it-clefts, throat-clearing",
] as const

const DENSITY_LEVELS = [
  "One digestible move",
  "Full but followable",
  "Packed: should split or sequence",
] as const

export function readabilityThresholds(config: QuorumConfig): ReadabilityThresholds {
  const readability = config.readability
  return {
    scoreTrip: readability.scoreTrip,
    scoreConfidence: readability.scoreConfidence,
    formalityTrip: readability.formalityTrip,
    noulVeto: readability.noulVeto,
  }
}

export function tripThresholdFor(criterion: ScoreCriterion, thresholds: ReadabilityThresholds) {
  return criterion === "formality" ? thresholds.formalityTrip : thresholds.scoreTrip
}

export function buildReadabilityQuestions() {
  return {
    convolution: score(
      "How syntactically convoluted is `unit` for `audience`? Judge clause nesting and re-reading cost, not whether the idea is advanced. Use `register` and `audience`.",
      CONVOLUTION_LEVELS,
    ),
    inversion: score(
      "How much does `unit` delay the subject or main verb via inversion or fronted machinery? `before`/`after` may show whether this is a turn.",
      INVERSION_LEVELS,
    ),
    diction: score(
      "Does `unit` use a fancier word where a simpler one would carry the same idea for `audience`? Domain terms listed in `reader` are not padding.",
      DICTION_LEVELS,
    ),
    formality: score(
      "How performatively formal is `unit` relative to `register`, `reader`, and `audience`? Stiff academic cadence, not complete sentences.",
      FORMALITY_LEVELS,
    ),
    density: score(
      "How many distinct moves are packed into `unit`? One mechanism with modifiers is not several claims.",
      DENSITY_LEVELS,
    ),
    inversionEarned: noul(
      "The marked order in `unit` is doing rhetorical or logical work, not decoration.",
      {
        true: "Inversion emphasizes a contrast, lands a punchline, or follows the subject's real order",
        false: "Inversion is decorative and makes parsing worse",
      },
    ),
    densityIsOneMove: noul("Despite long syntax, `unit` is still one mechanism or claim."),
    dictionIsDomainTerm: noul(
      "Hard words in `unit` are necessary domain terms for `audience`, not ornamental synonyms.",
    ),
    remedy: choice(
      "If `unit` should be edited for processing cost, which single class of edit is the right one? Choose `keep` if the marked style is earned.",
      {
        unnest: "Flatten clauses; keep one paragraph",
        split: "More than one move; break the unit",
        uninvert: "Restore canonical subject-verb order",
        simplify_words: "Same claim, plainer diction",
        lower_register: "Drop performative formality only",
        keep: "No edit; style is doing work",
      },
    ),
  }
}

export type ReadabilityQuestions = ReturnType<typeof buildReadabilityQuestions>
