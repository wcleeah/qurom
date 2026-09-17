import type { ReaderCalibrationProfile, ResearchState } from "../schema"
import type { ReadabilityScoreContext } from "./score"

export function readabilityContextFromProfile(
  profile: ReaderCalibrationProfile | undefined,
  fallbackJob?: string,
): ReadabilityScoreContext {
  const gaps = profile?.inferredGaps ?? []
  return {
    articleJob: profile?.intent.goal
      || fallbackJob?.trim()
      || "Explain the subject for this reader.",
    reader: {
      familiar: gaps.filter((gap) => gap.treatment === "can-assume").map((gap) => gap.concept),
      unfamiliar: gaps.filter((gap) => gap.treatment !== "can-assume").map((gap) => gap.concept),
    },
  }
}

export function readabilityContextFromState(state: ResearchState): ReadabilityScoreContext {
  const fallback = state.inputMode === "topic" ? state.topic : undefined
  return readabilityContextFromProfile(state.readerProfile, fallback)
}
