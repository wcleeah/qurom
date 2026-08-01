import { describe, expect, test } from "bun:test"

import { toCostDetails, toUsageDetails } from "../src/telemetry.ts"

describe("toUsageDetails", () => {
  test("maps tokens into Langfuse usageDetails", () => {
    expect(toUsageDetails({ tokensIn: 10, tokensOut: 5 })).toEqual({
      input: 10,
      output: 5,
      total: 15,
    })
  })

  test("returns undefined when usage is empty", () => {
    expect(toUsageDetails(undefined)).toBeUndefined()
    expect(toUsageDetails({ tokensIn: 0, tokensOut: 0 })).toBeUndefined()
  })
})

describe("toCostDetails", () => {
  test("maps available costUsd", () => {
    expect(
      toCostDetails({
        tokensIn: 1,
        tokensOut: 1,
        costUsd: 0.02,
        costAvailable: true,
      }),
    ).toEqual({ total: 0.02 })
  })

  test("returns undefined when cost is unavailable", () => {
    expect(toCostDetails({ tokensIn: 1, tokensOut: 1, costUsd: 0.02 })).toBeUndefined()
    expect(toCostDetails(undefined)).toBeUndefined()
  })
})
