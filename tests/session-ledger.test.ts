import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  findLatestDesignerWritingEntry,
  findLatestDrafterWritingEntry,
  findSessionLedgerEntry,
  readSessionLedger,
  sessionLedgerKey,
  upsertSessionLedgerEntry,
} from "../src/session-ledger"

describe("session ledger", () => {
  test("upserts by role+node+round and serializes parallel writes", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "qurom-ledger-"))
    await Promise.all([
      upsertSessionLedgerEntry(runDir, {
        role: "research-drafter",
        node: "draftFullDraft",
        round: 0,
        handleId: "bc-one",
        status: "created",
      }),
      upsertSessionLedgerEntry(runDir, {
        role: "source-auditor",
        node: "runParallelAudits",
        round: 0,
        handleId: "bc-audit",
        status: "created",
      }),
    ])

    await upsertSessionLedgerEntry(runDir, {
      role: "research-drafter",
      node: "draftFullDraft",
      round: 0,
      cursorRunId: "run-1",
      status: "waiting",
      expectedArtifact: "draft-round-0.md",
    })

    const file = await readSessionLedger(runDir)
    expect(file.sessions).toHaveLength(2)
    const draft = await findSessionLedgerEntry(runDir, {
      role: "research-drafter",
      node: "draftFullDraft",
      round: 0,
    })
    expect(draft).toMatchObject({
      handleId: "bc-one",
      cursorRunId: "run-1",
      status: "waiting",
      expectedArtifact: "draft-round-0.md",
    })
    expect(sessionLedgerKey(draft!)).toBe("research-drafter:draftFullDraft:0")
  })

  test("findLatestDrafterWritingEntry prefers an in-flight writing session", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "qurom-ledger-writing-"))
    await upsertSessionLedgerEntry(runDir, {
      role: "research-drafter",
      node: "draftFullDraft",
      round: 0,
      requestId: "req-1",
      handleId: "bc-draft",
      status: "finished",
    })
    await upsertSessionLedgerEntry(runDir, {
      role: "research-drafter",
      node: "reviseReadability",
      round: 0,
      requestId: "req-1",
      handleId: "bc-draft",
      status: "waiting",
    })
    await upsertSessionLedgerEntry(runDir, {
      role: "source-auditor",
      node: "runParallelAudits",
      round: 0,
      handleId: "bc-audit",
      status: "waiting",
    })

    const writing = await findLatestDrafterWritingEntry(runDir, "req-1")
    expect(writing).toMatchObject({
      node: "reviseReadability",
      handleId: "bc-draft",
      status: "waiting",
    })
  })

  test("findLatestDesignerWritingEntry prefers an in-flight generative design session", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "qurom-ledger-design-"))
    await upsertSessionLedgerEntry(runDir, {
      role: "html-designer",
      node: "runDesignHtml",
      round: 0,
      requestId: "req-1",
      handleId: "bc-design",
      status: "finished",
    })
    await upsertSessionLedgerEntry(runDir, {
      role: "html-designer",
      node: "graphicalEnhance",
      round: 0,
      requestId: "req-1",
      handleId: "bc-design",
      status: "waiting",
    })
    await upsertSessionLedgerEntry(runDir, {
      role: "html-reviewer",
      node: "htmlReview",
      round: 0,
      handleId: "bc-review",
      status: "waiting",
    })

    const writing = await findLatestDesignerWritingEntry(runDir, "req-1")
    expect(writing).toMatchObject({
      node: "graphicalEnhance",
      handleId: "bc-design",
      status: "waiting",
    })
  })
})
