import { describe, expect, test } from "bun:test"
import { createNoOpBridge, createBridgeForRoles } from "../src/runner"
import { resolveRunVerdict, resolveRunResumeActions, renderRunActionStrip } from "../src/view/run-controls"
import { renderNewRunForm } from "../src/view/new-run-form"

describe("createNoOpBridge", () => {
  test("start and stop resolve without error", async () => {
    const bridge = createNoOpBridge()
    await bridge.start()
    await bridge.stop()
  })
})

describe("resolveRunResumeActions", () => {
  test("offers research resume when failed and idle", () => {
    const actions = resolveRunResumeActions({
      isRunning: false,
      hasFinalMd: false,
      hasFinalHtml: false,
      hasInputMd: false,
      designStatus: null,
    })
    expect(actions.showResumeResearch).toBe(true)
    expect(actions.showResumeDesign).toBe(false)
    expect(actions.showRestartFromSource).toBe(false)
  })

  test("offers design resume when research approved without final html", () => {
    const actions = resolveRunResumeActions({
      isRunning: false,
      hasFinalMd: true,
      hasFinalHtml: false,
      hasInputMd: true,
      designStatus: "failed",
    })
    expect(actions.showResumeResearch).toBe(false)
    expect(actions.showResumeDesign).toBe(true)
    expect(actions.showRestartFromSource).toBe(true)
  })

  test("hides actions while running", () => {
    const actions = resolveRunResumeActions({
      isRunning: true,
      hasFinalMd: false,
      hasFinalHtml: false,
      hasInputMd: true,
      designStatus: null,
    })
    expect(actions.showResumeResearch).toBe(false)
    expect(actions.showResumeDesign).toBe(false)
    expect(actions.showRestartFromSource).toBe(false)
  })
})

describe("renderRunActionStrip", () => {
  test("renders resume research button", () => {
    const html = renderRunActionStrip("my-run-abc", {
      showResumeResearch: true,
      showResumeDesign: false,
      showRestartFromSource: false,
    })
    expect(html).toContain("/api/runs/my-run-abc/resume")
    expect(html).toContain("Resume research")
  })

  test("renders restart-from-source button", () => {
    const html = renderRunActionStrip("my-run-abc", {
      showResumeResearch: false,
      showResumeDesign: false,
      showRestartFromSource: true,
    })
    expect(html).toContain("/api/runs/my-run-abc/restart-from-source")
    expect(html).toContain("New run from source document")
  })
})

describe("resolveRunVerdict", () => {
  test("reports design complete", () => {
    const result = resolveRunVerdict({ researchStatus: "approved", designStatus: "approved" })
    expect(result.verdictText).toContain("Design complete")
    expect(result.errored).toBe(false)
  })

  test("reports live error", () => {
    const result = resolveRunVerdict({ researchStatus: "running", liveError: "boom" })
    expect(result.errored).toBe(true)
    expect(result.verdictText).toContain("boom")
  })
})

describe("renderNewRunForm", () => {
  test("disables controls when a run is active", () => {
    const html = renderNewRunForm({ runActive: true, activeRunId: "abc-123" })
    expect(html).toContain("disabled")
    expect(html).toContain("new-run-card")
    expect(html).toContain("form-input new-run-textarea")
  })

  test("renders document compose textarea and file picker", () => {
    const html = renderNewRunForm({ runActive: false })
    expect(html).toContain('name="documentText"')
    expect(html).toContain("document-file-input")
    expect(html).toContain("Advanced: server path")
  })
})

describe("createBridgeForRoles", () => {
  test("returns no-op bridge when no event bridge providers", () => {
    const config = {
      roleBindings: {
        "research-drafter": { provider: "cursor", model: "gpt-5" },
      },
    } as import("../src/config").RuntimeConfig

    const bridge = createBridgeForRoles(config, ["research-drafter"], {
      bus: { emit: () => {}, on: () => () => {}, off: () => {} },
      getRunDir: () => undefined,
    })
    expect(bridge).toBeDefined()
  })
})
