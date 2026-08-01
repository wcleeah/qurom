import { describe, expect, test } from "bun:test"

import { toCostDetails, toUsageDetails } from "../src/telemetry"

describe("cursor telemetry helpers via toUsageDetails", () => {
  test("cursor usage maps the same way OpenCode usage does", () => {
    expect(
      toUsageDetails({
        tokensIn: 250,
        tokensOut: 80,
        costUsd: 0.01,
        costAvailable: true,
      }),
    ).toEqual({
      input: 250,
      output: 80,
      total: 330,
    })
    expect(
      toCostDetails({
        tokensIn: 250,
        tokensOut: 80,
        costUsd: 0.01,
        costAvailable: true,
      }),
    ).toEqual({ total: 0.01 })
  })
})
