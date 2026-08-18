import { describe, expect, test } from "bun:test"
import { createNoOpBridge, createBridgeForRoles } from "../src/runner"
import { resolveRunVerdict, resolveRunResumeActions, renderRunActionStrip } from "../src/view/run-controls"
import { renderRerunQueueStrip } from "../src/view/rerun-queue-view"
import { renderNewRunForm } from "../src/view/new-run-form"

describe("createNoOpBridge", () => {
  test("start and stop resolve without error", async () => {
    const bridge = createNoOpBridge()
    await bridge.start()
    await bridge.stop()
  })
})

describe("resolveRunResumeActions", () => {
  test("offers resume when research failed and idle", () => {
    const actions = resolveRunResumeActions({
      isRunning: false,
      hasFinalMd: false,
      hasFinalHtml: false,
      hasInputMd: false,
      hasTopic: true,
      hasReaderProfile: false,
      designStatus: null,
    })
    expect(actions.showResume).toBe(true)
    expect(actions.showRestartFromSource).toBe(false)
    expect(actions.showRerunFreshInterview).toBe(true)
    expect(actions.showRerunReuseProfile).toBe(false)
    expect(actions.showRerunRepairProfile).toBe(false)
  })

  test("offers resume when research approved without final html", () => {
    const actions = resolveRunResumeActions({
      isRunning: false,
      hasFinalMd: true,
      hasFinalHtml: false,
      hasInputMd: true,
      hasTopic: false,
      hasReaderProfile: true,
      designStatus: "failed",
    })
    expect(actions.showResume).toBe(true)
    expect(actions.showRestartFromSource).toBe(true)
    expect(actions.showRerunReuseProfile).toBe(true)
    expect(actions.showRerunRepairProfile).toBe(true)
    expect(actions.showRerunFreshInterview).toBe(true)
  })

  test("hides actions while running", () => {
    const actions = resolveRunResumeActions({
      isRunning: true,
      hasFinalMd: false,
      hasFinalHtml: false,
      hasInputMd: true,
      hasTopic: true,
      hasReaderProfile: true,
      designStatus: null,
    })
    expect(actions.showResume).toBe(false)
    expect(actions.showRestartFromSource).toBe(false)
    expect(actions.showRerunReuseProfile).toBe(false)
    expect(actions.showRerunRepairProfile).toBe(false)
    expect(actions.showRerunFreshInterview).toBe(false)
  })

  test("hides resume when design is complete but still offers rerun", () => {
    const actions = resolveRunResumeActions({
      isRunning: false,
      hasFinalMd: true,
      hasFinalHtml: true,
      hasInputMd: true,
      hasTopic: false,
      hasReaderProfile: true,
      designStatus: "approved",
    })
    expect(actions.showResume).toBe(false)
    expect(actions.showRerunReuseProfile).toBe(true)
    expect(actions.showRerunRepairProfile).toBe(true)
    expect(actions.showRerunFreshInterview).toBe(true)
  })
})

describe("renderRunActionStrip", () => {
  test("renders resume button", () => {
    const html = renderRunActionStrip("my-run-abc", {
      showResume: true,
      showRestartFromSource: false,
      showRerunReuseProfile: false,
      showRerunRepairProfile: false,
      showRerunFreshInterview: false,
    })
    expect(html).toContain("/api/runs/my-run-abc/resume")
    expect(html).toContain("Resume run")
  })

  test("renders restart-from-source button", () => {
    const html = renderRunActionStrip("my-run-abc", {
      showResume: false,
      showRestartFromSource: true,
      showRerunReuseProfile: false,
      showRerunRepairProfile: false,
      showRerunFreshInterview: false,
    })
    expect(html).toContain("/api/runs/my-run-abc/restart-from-source")
    expect(html).toContain("New run from source document")
  })

  test("renders reuse, repair, and fresh rerun buttons", () => {
    const html = renderRunActionStrip("my-run-abc", {
      showResume: false,
      showRestartFromSource: false,
      showRerunReuseProfile: true,
      showRerunRepairProfile: true,
      showRerunFreshInterview: true,
    })
    expect(html).toContain("/api/runs/my-run-abc/rerun")
    expect(html).toContain('name="interview" value="reuse"')
    expect(html).toContain('name="interview" value="repair"')
    expect(html).toContain('name="interview" value="fresh"')
    expect(html).toContain("Rerun (reuse profile)")
    expect(html).toContain("Rerun (repair profile)")
    expect(html).toContain("Rerun (fresh interview)")
    expect(html).toContain("Start a new run")
  })

  test("keeps reuse and repair clickable while another run is active", () => {
    const html = renderRunActionStrip(
      "my-run-abc",
      {
        showResume: true,
        showRestartFromSource: false,
        showRerunReuseProfile: true,
        showRerunRepairProfile: true,
        showRerunFreshInterview: true,
      },
      { runActiveGlobally: true },
    )
    expect(html).toContain("will queue")
    const reuse = html.match(/value="reuse"[\s\S]*?<\/button>/)?.[0] ?? ""
    const repair = html.match(/value="repair"[\s\S]*?<\/button>/)?.[0] ?? ""
    const fresh = html.match(/value="fresh"[\s\S]*?<\/button>/)?.[0] ?? ""
    expect(reuse).not.toContain("disabled")
    expect(repair).not.toContain("disabled")
    expect(fresh).toContain("disabled")
    expect(html).toContain('disabled>Resume run')
  })

  test("renders archive button when showArchive is set", () => {
    const html = renderRunActionStrip(
      "my-run-abc",
      {
        showResume: false,
        showRestartFromSource: false,
        showRerunReuseProfile: false,
        showRerunRepairProfile: false,
        showRerunFreshInterview: false,
      },
      { showArchive: true },
    )
    expect(html).toContain("/api/runs/my-run-abc/archive")
    expect(html).toContain("Archive run")
  })
})

describe("renderRerunQueueStrip", () => {
  test("renders queued reuse and repair rows", () => {
    const html = renderRerunQueueStrip({
      paused: false,
      items: [
        {
          id: "q1",
          position: 1,
          interview: "reuse",
          sourceRunName: "old-run",
          topic: "What is MLX?",
          payload: {
            request: { inputMode: "topic", topic: "What is MLX?" },
            readerProfile: {
              intent: { goal: "learn", secondaryGoals: [], depth: "conceptual" },
              background: { summary: "reader" },
              competence: {
                inTopic: { level: "novice", summary: "new", evidence: [] },
                adjacent: { summary: "ok", evidence: [] },
              },
              inferredGaps: [],
            },
          },
          createdAt: new Date().toISOString(),
        },
      ],
    })
    expect(html).toContain("Rerun playlist")
    expect(html).toContain("What is MLX?")
    expect(html).toContain("Reuse reader")
    expect(html).toContain("/api/rerun-queue/q1/remove")
    expect(html).toContain("/api/rerun-queue/pause")
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
    expect(html).toContain("data-new-run-submit-status")
    expect(html).toContain("Starting run…")
  })

  test("does not render a separate design tab", () => {
    const html = renderNewRunForm({ runActive: false })
    expect(html).not.toContain('data-new-run-tab="design"')
    expect(html).not.toContain("data-design-form")
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
