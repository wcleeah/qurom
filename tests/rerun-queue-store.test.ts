import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createSqliteRerunQueueStore } from "../src/rerun-queue-store"
import type { ReaderCalibrationProfile } from "../src/schema"

const sampleProfile: ReaderCalibrationProfile = {
  intent: { goal: "learn the topic", secondaryGoals: [], depth: "conceptual" },
  background: { summary: "curious reader" },
  competence: {
    inTopic: { level: "novice", summary: "new to it", evidence: ["said so"] },
    adjacent: { summary: "some coding", evidence: [] },
  },
  inferredGaps: [
    { concept: "basics", treatment: "must-explain", rationale: "needed" },
  ],
}

describe("rerun queue store", () => {
  let dataDir = ""

  afterEach(async () => {
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
    dataDir = ""
  })

  test("enqueues, lists, takes, and dedupes the same source and mode", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "qurom-rerun-queue-"))
    const store = createSqliteRerunQueueStore(dataDir)
    const payload = {
      request: { inputMode: "topic" as const, topic: "What is MLX?" },
      readerProfile: sampleProfile,
    }

    const first = await store.enqueue({
      interview: "reuse",
      sourceRunName: "old-run",
      topic: "What is MLX?",
      payload,
    })
    const again = await store.enqueue({
      interview: "reuse",
      sourceRunName: "old-run",
      topic: "What is MLX?",
      payload,
    })
    const repair = await store.enqueue({
      interview: "repair",
      sourceRunName: "old-run",
      topic: "What is MLX?",
      payload,
    })

    expect(again.id).toBe(first.id)
    expect(repair.id).not.toBe(first.id)

    const listed = await store.list()
    expect(listed.map((item) => item.interview)).toEqual(["reuse", "repair"])

    const next = await store.takeNext()
    expect(next?.id).toBe(first.id)
    expect((await store.list()).map((item) => item.id)).toEqual([repair.id])
  })

  test("pause flag and remove/clear", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "qurom-rerun-queue-ctrl-"))
    const store = createSqliteRerunQueueStore(dataDir)
    await store.enqueue({
      interview: "reuse",
      sourceRunName: "a",
      topic: "A",
      payload: {
        request: { inputMode: "topic", topic: "A" },
        readerProfile: sampleProfile,
      },
    })
    expect(await store.isPaused()).toBe(false)
    await store.setPaused(true)
    expect(await store.isPaused()).toBe(true)
    expect(await store.remove("missing")).toBe(false)
    const items = await store.list()
    expect(await store.remove(items[0]!.id)).toBe(true)
    expect(await store.list()).toEqual([])
    await store.enqueue({
      interview: "reuse",
      sourceRunName: "b",
      topic: "B",
      payload: {
        request: { inputMode: "topic", topic: "B" },
        readerProfile: sampleProfile,
      },
    })
    expect(await store.clear()).toBe(1)
    expect(await store.list()).toEqual([])
  })
})
