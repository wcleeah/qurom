import { describe, expect, test } from "bun:test"

import { isDeadKeepAliveReason, KeepAliveSessionDeadError } from "../src/agent-runtime/keep-alive"

describe("keepAlive session death", () => {
  test("detects cancelled, error, and inactive provider sessions", () => {
    expect(isDeadKeepAliveReason("cursor run status cancelled")).toBe(true)
    expect(isDeadKeepAliveReason("cursor run ended with status error")).toBe(true)
    expect(isDeadKeepAliveReason("cursor agent handle bc-1 is not active")).toBe(true)
    expect(isDeadKeepAliveReason("cursor local agents cannot harvest cloud artifacts")).toBe(false)
    expect(isDeadKeepAliveReason("cursor artifact was empty")).toBe(false)
  })

  test("KeepAliveSessionDeadError names the handle", () => {
    const error = new KeepAliveSessionDeadError("bc-dead", "cancelled")
    expect(error.name).toBe("KeepAliveSessionDeadError")
    expect(error.handleId).toBe("bc-dead")
    expect(error.message).toContain("bc-dead")
  })
})
