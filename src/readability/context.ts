import type { ResearchState } from "../schema"
import type { ReadabilityScoreContext } from "./score"

export function readabilityContextFromState(state: ResearchState): ReadabilityScoreContext {
  const gaps = state.readerProfile?.inferredGaps ?? []
  return {
    articleJob: state.readerProfile?.intent.goal
      || (state.inputMode === "topic" ? state.topic : undefined)
      || "Explain the subject for this reader.",
    reader: {
      familiar: gaps.filter((gap) => gap.treatment === "can-assume").map((gap) => gap.concept),
      unfamiliar: gaps.filter((gap) => gap.treatment !== "can-assume").map((gap) => gap.concept),
    },
  }
}
