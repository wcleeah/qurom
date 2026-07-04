import { describe, expect, test } from "bun:test"

import { __runRefMatching } from "../src/run-manager"

describe("run ref matching", () => {
  test("matches full run directory names against bare request ids", () => {
    const requestId = "81bd5919-0ed0-4eaa-81f5-264124740010"
    const runPath = `rocket-league-speedflip-${requestId}`

    expect(__runRefMatching.runRefsMatch(requestId, runPath)).toBe(true)
    expect(__runRefMatching.runRefsMatch(requestId, requestId)).toBe(true)
    expect(__runRefMatching.requestIdFromRunRef(runPath)).toBe(requestId)
  })

  test("rejects unrelated run refs", () => {
    expect(__runRefMatching.runRefsMatch(
      "81bd5919-0ed0-4eaa-81f5-264124740010",
      "other-topic-11111111-1111-1111-1111-111111111111",
    )).toBe(false)
  })
})
