import { describe, expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  readerInterviewStateFromRunDir,
  reconcileAwaitingReaderReplyWithDisk,
  resolveReaderInterviewQuestions,
} from "../src/reader-transcript"

describe("resolveReaderInterviewQuestions", () => {
  test("prefers latest interviewer transcript over stale pending questions", () => {
    expect(
      resolveReaderInterviewQuestions({
        interviewTranscript: [
          { role: "interviewer", text: "First question?" },
          { role: "reader", text: "First answer." },
          { role: "interviewer", text: "Second question?" },
        ],
        pendingNewReaderQuestions: ["First question?"],
      }),
    ).toEqual(["Second question?"])
  })

  test("falls back to pending questions when transcript has no interviewer turn", () => {
    expect(
      resolveReaderInterviewQuestions({
        interviewTranscript: [],
        pendingNewReaderQuestions: ["Only question?"],
        interruptValue: ["Interrupt question?"],
      }),
    ).toEqual(["Only question?"])
  })
})

describe("readerInterviewStateFromRunDir", () => {
  test("returns pending turn from unanswered question artifact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reader-transcript-"))
    await writeFile(join(dir, "question-1.json"), JSON.stringify({ questions: ["Question one?"] }))
    await writeFile(join(dir, "reply-1.json"), JSON.stringify({ reply: "Answer one." }))
    await writeFile(join(dir, "question-2.json"), JSON.stringify({ questions: ["Question two?"] }))

    const state = await readerInterviewStateFromRunDir(dir)
    expect(state?.turn).toBe(2)
    expect(state?.newQuestions).toEqual(["Question two?"])
    expect(state?.transcript).toEqual([
      { role: "interviewer", text: "Question one?" },
      { role: "reader", text: "Answer one." },
      { role: "interviewer", text: "Question two?" },
    ])
  })

  test("includes accepted reader-profile when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reader-transcript-profile-"))
    await writeFile(join(dir, "question-1.json"), JSON.stringify({ questions: ["Question one?"] }))
    await writeFile(join(dir, "reader-profile.json"), JSON.stringify({ intent: { goal: "learn more" } }))

    const state = await readerInterviewStateFromRunDir(dir)
    expect(state?.turn).toBe(1)
    expect(state?.partialProfile).toEqual({ intent: { goal: "learn more" } })
  })
})

describe("reconcileAwaitingReaderReplyWithDisk", () => {
  test("replaces stale live-status question with latest disk profile", () => {
    const q1 = "First question?"
    const q2 = "Second question?"
    const reconciled = reconcileAwaitingReaderReplyWithDisk(
      {
        turn: 1,
        newQuestions: [q1],
        transcript: [{ role: "interviewer", text: q1 }],
        answeredQuestions: [],
      },
      {
        turn: 2,
        newQuestions: [q2],
        transcript: [
          { role: "interviewer", text: q1 },
          { role: "reader", text: "First answer." },
          { role: "interviewer", text: q2 },
        ],
      },
    )

    expect(reconciled.turn).toBe(2)
    expect(reconciled.newQuestions).toEqual([q2])
    expect(reconciled.answeredQuestions).toEqual([{ question: q1, answer: "First answer." }])
  })
})
