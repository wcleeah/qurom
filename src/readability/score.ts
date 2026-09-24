import type { ChoiceResponse, ScoreResponse, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk"

import type { ReadabilitySystemOne } from "../typesafe/client"
import {
  buildReadabilityQuestions,
  READABILITY_AUDIENCE,
  READABILITY_REGISTER,
  tripThresholdFor,
  type ReadabilityQuestions,
  type ReadabilityThresholds,
} from "./criteria"
import type { SegmentedUnit } from "./segment"
import {
  readabilityReportSchema,
  SCORE_CRITERIA,
  type ReadabilityHotspot,
  type ReadabilityReport,
  type ReadabilityUnit,
  type RemedyChoice,
  type ScoreAnswer,
  type ScoreCriterion,
} from "./schema"

const DEFAULT_POOL = 8

export type ReadabilityScoreContext = {
  articleJob: string
  reader: {
    familiar: string[]
    unfamiliar: string[]
  }
}

export type RawReadabilityCall = {
  unitId: string
  state: Record<string, unknown>
  answers: unknown
  model: string
}

const GATE_FOR_CRITERION: Partial<Record<ScoreCriterion, keyof ReadabilityUnit["gates"]>> = {
  inversion: "inversionEarned",
  density: "densityIsOneMove",
  diction: "dictionIsDomainTerm",
}

function legendRecord(legend: ScoreResponse["legend"]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const [key, value] of Object.entries(legend)) {
    record[key] = typeof value === "string" ? value : JSON.stringify(value)
  }
  return record
}

function probabilityRecord(probabilities: ScoreResponse["probabilities"] | ChoiceResponse["probabilities"]): Record<string, number> {
  const record: Record<string, number> = {}
  for (const [key, value] of Object.entries(probabilities)) {
    if (typeof value === "number") record[key] = value
  }
  return record
}

function toScoreAnswer(answer: ScoreResponse): ScoreAnswer {
  return {
    score: answer.score,
    confidence: answer.confidence,
    probabilities: probabilityRecord(answer.probabilities),
    legend: legendRecord(answer.legend),
  }
}

function criterionTrips(
  criterion: ScoreCriterion,
  unit: ReadabilityUnit,
  thresholds: ReadabilityThresholds,
): boolean {
  const answer = unit.scores[criterion]
  if (answer.score < tripThresholdFor(criterion, thresholds)) return false
  if (answer.confidence < thresholds.scoreConfidence) return false
  const gateKey = GATE_FOR_CRITERION[criterion]
  if (!gateKey) return true
  const noul = unit.gates[gateKey]
  return (noul ?? 0) < thresholds.noulVeto
}

export function deriveHotspots(units: ReadabilityUnit[], thresholds: ReadabilityThresholds): ReadabilityHotspot[] {
  const hotspots: ReadabilityHotspot[] = []
  for (const unit of units) {
    if (unit.remedy.choice === "keep") continue
    for (const criterion of SCORE_CRITERIA) {
      if (!criterionTrips(criterion, unit, thresholds)) continue
      hotspots.push({
        unitId: unit.id,
        section: unit.section,
        quote: unit.quote,
        startLine: unit.startLine,
        endLine: unit.endLine,
        criterion,
        score: unit.scores[criterion].score,
        confidence: unit.scores[criterion].confidence,
        remedy: unit.remedy.choice,
      })
    }
  }
  return hotspots
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return []
  const results: R[] = new Array(items.length)
  let next = 0
  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await fn(items[index]!, index)
    }
  }))
  return results
}

function reusedUnit(segmented: SegmentedUnit, previous: ReadabilityUnit): ReadabilityUnit {
  return {
    ...previous,
    id: segmented.id,
    section: segmented.section,
    quote: segmented.quote,
    startLine: segmented.startLine,
    endLine: segmented.endLine,
    cached: true,
  }
}

export function takeUnchangedPassedUnit(
  previous: ReadabilityReport | undefined,
  quote: string,
  consumed: Set<string>,
): ReadabilityUnit | undefined {
  if (!previous) return undefined
  const hotspotIds = new Set(previous.hotspots.map((hotspot) => hotspot.unitId))
  for (const unit of previous.units) {
    if (consumed.has(unit.id)) continue
    if (hotspotIds.has(unit.id)) continue
    if (unit.quote !== quote) continue
    consumed.add(unit.id)
    return unit
  }
  return undefined
}

function unitFromAnswers(
  segmented: SegmentedUnit,
  result: SystemOneResult<ReadabilityQuestions>,
): ReadabilityUnit {
  const answers = result.answers
  return {
    id: segmented.id,
    section: segmented.section,
    quote: segmented.quote,
    startLine: segmented.startLine,
    endLine: segmented.endLine,
    scores: {
      convolution: toScoreAnswer(answers.convolution),
      inversion: toScoreAnswer(answers.inversion),
      diction: toScoreAnswer(answers.diction),
      formality: toScoreAnswer(answers.formality),
      density: toScoreAnswer(answers.density),
    },
    gates: {
      inversionEarned: answers.inversionEarned.noul,
      densityIsOneMove: answers.densityIsOneMove.noul,
      dictionIsDomainTerm: answers.dictionIsDomainTerm.noul,
    },
    remedy: {
      choice: answers.remedy.choice as RemedyChoice,
      confidence: answers.remedy.confidence,
      probabilities: probabilityRecord(answers.remedy.probabilities),
    },
  }
}

export async function scoreDraftReadability(input: {
  units: SegmentedUnit[]
  context: ReadabilityScoreContext
  model: string
  thresholds: ReadabilityThresholds
  systemOne: ReadabilitySystemOne
  round: number
  tryIndex: number
  pool?: number
  previous?: ReadabilityReport
}): Promise<{ report: ReadabilityReport; raw: RawReadabilityCall[] }> {
  const questions = buildReadabilityQuestions()
  const raw: RawReadabilityCall[] = []
  const consumed = new Set<string>()
  const pending: Array<{ index: number; segmented: SegmentedUnit }> = []
  const units: ReadabilityUnit[] = new Array(input.units.length)

  for (const [index, segmented] of input.units.entries()) {
    const previous = takeUnchangedPassedUnit(input.previous, segmented.quote, consumed)
    if (previous) {
      units[index] = reusedUnit(segmented, previous)
    } else {
      pending.push({ index, segmented })
    }
  }

  const scored = await mapPool(pending, input.pool ?? DEFAULT_POOL, async (item) => {
    const segmented = item.segmented
    const state = {
      unit: segmented.quote,
      section: segmented.section,
      before: segmented.before,
      after: segmented.after,
      article_job: input.context.articleJob,
      reader: input.context.reader,
      audience: READABILITY_AUDIENCE,
      register: READABILITY_REGISTER,
    }
    const request = {
      state,
      model: input.model,
      questions,
    } satisfies SystemOneRequest<ReadabilityQuestions>
    const result = await input.systemOne(request)
    return {
      index: item.index,
      unit: unitFromAnswers(segmented, result),
      raw: {
        unitId: segmented.id,
        state,
        answers: result.answers,
        model: result.model,
      } satisfies RawReadabilityCall,
    }
  })

  for (const item of scored) {
    units[item.index] = item.unit
    raw.push(item.raw)
  }

  const hotspots = deriveHotspots(units, input.thresholds)
  const report = readabilityReportSchema.parse({
    round: input.round,
    try: input.tryIndex,
    model: input.model,
    passed: hotspots.length === 0,
    thresholds: input.thresholds,
    units,
    hotspots,
  })
  return { report, raw }
}

export function skippedReadabilityReport(input: {
  round: number
  tryIndex: number
  model: string
  reason: "disabled" | "no_api_key" | "error"
  detail?: string
}): ReadabilityReport {
  return readabilityReportSchema.parse({
    round: input.round,
    try: input.tryIndex,
    model: input.model,
    passed: true,
    skipped: { reason: input.reason, detail: input.detail },
    units: [],
    hotspots: [],
  })
}
