import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
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
})
