import { afterEach, describe, expect, test } from "bun:test"

import { pipelineAgentRoles } from "../src/role-registry"
import {
  atConcurrencyCapacity,
  concurrencyBusyMessage,
  hasConcurrentActiveRequest,
  pipelineConcurrencyPolicy,
  resetActiveRequestsForTests,
  trackActiveRequest,
} from "../src/run-concurrency"
import { testRuntimeConfig, unitTestDataDir } from "./test-env"

function cursorCloudBindings(config: ReturnType<typeof testRuntimeConfig>) {
  return Object.fromEntries(
    pipelineAgentRoles(config).map((role) => [
      role,
      { provider: "cursor", model: "composer-2.5", options: { runtime: "cloud" } },
    ]),
  )
}

describe("pipelineConcurrencyPolicy", () => {
  test("defaults to one run", () => {
    const config = testRuntimeConfig({ dataDir: unitTestDataDir(`conc-default-${Date.now()}`) })
    const policy = pipelineConcurrencyPolicy(config)
    expect(policy.maxConcurrent).toBe(1)
    expect(policy.requestedMaxConcurrent).toBe(1)
    expect(policy.cursorCloudOnly).toBe(false)
    expect(policy.hasOpenCode).toBe(true)
  })

  test("keeps OpenCode serial even when a higher cap is requested", () => {
    const config = testRuntimeConfig({
      dataDir: unitTestDataDir(`conc-opencode-${Date.now()}`),
      quorumOverrides: { maxConcurrentRuns: 4 },
    })
    const policy = pipelineConcurrencyPolicy(config)
    expect(policy.maxConcurrent).toBe(1)
    expect(policy.requestedMaxConcurrent).toBe(4)
    expect(policy.hasOpenCode).toBe(true)
    expect(policy.reason).toContain("OpenCode")
  })

  test("allows Cursor cloud roles to use the requested cap", () => {
    const config = testRuntimeConfig({
      dataDir: unitTestDataDir(`conc-cursor-${Date.now()}`),
      quorumOverrides: { maxConcurrentRuns: 3 },
    })
    config.roleBindings = cursorCloudBindings(config)
    const policy = pipelineConcurrencyPolicy(config)
    expect(policy.cursorCloudOnly).toBe(true)
    expect(policy.maxConcurrent).toBe(3)
    expect(policy.hasOpenCode).toBe(false)
    expect(policy.hasLocalCursor).toBe(false)
  })

  test("keeps local Cursor serial", () => {
    const config = testRuntimeConfig({
      dataDir: unitTestDataDir(`conc-local-${Date.now()}`),
      quorumOverrides: { maxConcurrentRuns: 3 },
    })
    config.roleBindings = cursorCloudBindings(config)
    config.roleBindings["research-drafter"] = {
      provider: "cursor",
      model: "composer-2.5",
      options: { runtime: "local" },
    }
    const policy = pipelineConcurrencyPolicy(config)
    expect(policy.maxConcurrent).toBe(1)
    expect(policy.hasLocalCursor).toBe(true)
    expect(policy.reason).toContain("Local Cursor")
  })

  test("mixed OpenCode + Cursor stays serial", () => {
    const config = testRuntimeConfig({
      dataDir: unitTestDataDir(`conc-mixed-${Date.now()}`),
      quorumOverrides: { maxConcurrentRuns: 3 },
    })
    config.roleBindings = {
      ...cursorCloudBindings(config),
      "research-drafter": { provider: "opencode", options: {} },
    }
    const policy = pipelineConcurrencyPolicy(config)
    expect(policy.maxConcurrent).toBe(1)
    expect(policy.hasOpenCode).toBe(true)
    expect(policy.cursorCloudOnly).toBe(false)
  })

  test("busy message stays compatible at cap 1", () => {
    const config = testRuntimeConfig({ dataDir: unitTestDataDir(`conc-msg-${Date.now()}`) })
    const policy = pipelineConcurrencyPolicy(config)
    expect(atConcurrencyCapacity(1, policy)).toBe(true)
    expect(concurrencyBusyMessage(policy, 1)).toBe("A run is already active")
  })
})

describe("active request tracking", () => {
  afterEach(() => {
    resetActiveRequestsForTests()
  })

  test("detects a second in-flight request", () => {
    const releaseA = trackActiveRequest("topic-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    expect(hasConcurrentActiveRequest("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(false)
    const releaseB = trackActiveRequest("bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee")
    expect(hasConcurrentActiveRequest("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(true)
    releaseB()
    expect(hasConcurrentActiveRequest("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(false)
    releaseA()
  })
})
