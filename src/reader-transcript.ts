export type ReaderTranscriptEntry = {
  role: "interviewer" | "reader"
  text: string
}

export type ReaderQuestionAnswer = {
  question: string
  answer?: string
}

function splitQuestions(text: string) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean)
}

function splitAnswers(text: string) {
  const labeled = text.match(/(?:^|\n\n)Answer \d+:/)
  if (labeled) {
    return text
      .split(/\n\n(?=Answer \d+:)/)
      .map((part) => part.replace(/^Answer \d+:\s*/i, "").trim())
      .filter(Boolean)
  }
  return text.split("\n\n").map((part) => part.trim()).filter(Boolean)
}

export function pairReaderTranscriptTurn(questionText: string, answerText?: string): ReaderQuestionAnswer[] {
  const questions = splitQuestions(questionText)
  const answers = answerText === undefined ? [] : splitAnswers(answerText)
  return questions.map((question, index) => ({
    question,
    answer: answers[index] ?? (answers.length === 1 && questions.length === 1 ? answers[0] : undefined),
  }))
}

export function answeredQuestionsFromTranscript(transcript: ReaderTranscriptEntry[]) {
  const answered: Array<{ question: string; answer: string }> = []
  for (let i = 0; i < transcript.length; i += 1) {
    const entry = transcript[i]
    if (!entry) continue
    if (entry.role !== "interviewer") continue
    const next = transcript[i + 1]
    if (next?.role !== "reader") continue
    for (const pair of pairReaderTranscriptTurn(entry.text, next.text)) {
      if (pair.answer !== undefined) answered.push({ question: pair.question, answer: pair.answer })
    }
    i += 1
  }
  return answered
}

/** Prefer the latest interviewer turn in transcript over stale pending question state. */
export function resolveReaderInterviewQuestions(input: {
  interviewTranscript?: ReaderTranscriptEntry[]
  pendingNewReaderQuestions?: string[]
  interruptValue?: unknown
}): string[] {
  const transcript = input.interviewTranscript ?? []
  const lastEntry = transcript[transcript.length - 1]
  if (lastEntry?.role === "interviewer") {
    const fromTranscript = splitQuestions(lastEntry.text)
    if (fromTranscript.length > 0) return fromTranscript
  }
  if (input.pendingNewReaderQuestions?.length) return input.pendingNewReaderQuestions
  if (Array.isArray(input.interruptValue)) {
    return input.interruptValue.map((entry) => String(entry)).filter(Boolean)
  }
  if (input.interruptValue !== undefined) return [String(input.interruptValue)]
  return []
}

export function readerInterviewTurnFromTranscript(transcript: ReaderTranscriptEntry[]): number {
  return Math.max(1, Math.ceil(transcript.length / 2))
}

type QuestionArtifact = {
  questions?: string[]
}

type ReplyArtifact = {
  reply?: string
}

export async function readerInterviewStateFromRunDir(runDir: string): Promise<{
  turn: number
  newQuestions: string[]
  transcript: ReaderTranscriptEntry[]
  partialProfile?: Record<string, unknown>
} | undefined> {
  const { readdir, readFile } = await import("node:fs/promises")
  const { join } = await import("node:path")

  const files = await readdir(runDir)
  const questionTurns = new Map<number, string[]>()
  const replyTurns = new Map<number, string>()

  for (const file of files) {
    const questionMatch = file.match(/^question-(\d+)\.json$/)
    if (questionMatch) {
      const turn = Number.parseInt(questionMatch[1]!, 10)
      const raw = JSON.parse(await readFile(join(runDir, file), "utf8")) as QuestionArtifact
      const questions = Array.isArray(raw.questions)
        ? raw.questions.map((entry) => String(entry).trim()).filter(Boolean)
        : []
      if (questions.length > 0) questionTurns.set(turn, questions)
      continue
    }
    const replyMatch = file.match(/^reply-(\d+)\.json$/)
    if (replyMatch) {
      const turn = Number.parseInt(replyMatch[1]!, 10)
      const raw = JSON.parse(await readFile(join(runDir, file), "utf8")) as ReplyArtifact
      if (typeof raw.reply === "string" && raw.reply.trim()) replyTurns.set(turn, raw.reply.trim())
    }
  }

  if (questionTurns.size === 0) return undefined

  const transcript: ReaderTranscriptEntry[] = []
  const maxQuestionTurn = Math.max(...questionTurns.keys())
  let partialProfile: Record<string, unknown> | undefined
  try {
    const profileRaw = JSON.parse(await readFile(join(runDir, "reader-profile.json"), "utf8")) as Record<string, unknown>
    if (profileRaw && typeof profileRaw === "object") partialProfile = profileRaw
  } catch {
    // Final profile may not exist yet during the interview.
  }

  for (let turn = 1; turn <= maxQuestionTurn; turn += 1) {
    const questions = questionTurns.get(turn)
    if (!questions) break
    transcript.push({ role: "interviewer", text: questions.join("\n") })

    const reply = replyTurns.get(turn)
    if (reply !== undefined) {
      transcript.push({ role: "reader", text: reply })
      continue
    }

    return {
      turn,
      newQuestions: questions,
      transcript,
      ...(partialProfile ? { partialProfile } : {}),
    }
  }

  return undefined
}

export type AwaitingReaderReplyState = {
  turn: number
  answeredQuestions?: Array<{ question: string; answer: string }>
  newQuestions: string[]
  transcript?: ReaderTranscriptEntry[]
  partialProfile?: Record<string, unknown>
}

/** Prefer on-disk question/reply artifacts when live-status lags the graph checkpoint. */
export function reconcileAwaitingReaderReplyWithDisk(
  awaiting: AwaitingReaderReplyState,
  disk: {
    turn: number
    newQuestions: string[]
    transcript: ReaderTranscriptEntry[]
    partialProfile?: Record<string, unknown>
  },
): AwaitingReaderReplyState {
  const liveTranscript = awaiting.transcript ?? []
  const useDisk =
    disk.turn > awaiting.turn
    || disk.transcript.length > liveTranscript.length
    || (
      disk.turn >= awaiting.turn
      && disk.newQuestions.join("\0") !== awaiting.newQuestions.join("\0")
    )

  if (!useDisk) return awaiting

  return {
    turn: disk.turn,
    newQuestions: disk.newQuestions,
    transcript: disk.transcript,
    answeredQuestions: answeredQuestionsFromTranscript(disk.transcript),
    partialProfile: disk.partialProfile ?? awaiting.partialProfile,
  }
}

export function formatReaderTranscriptForPrompt(transcript: ReaderTranscriptEntry[]) {
  if (transcript.length === 0) return "(none yet -- this is the first question)"

  const lines: string[] = []
  let displayedQuestion = 1
  for (let i = 0; i < transcript.length; i += 1) {
    const entry = transcript[i]
    if (!entry) continue

    if (entry.role === "interviewer") {
      const next = transcript[i + 1]
      const pairs = pairReaderTranscriptTurn(entry.text, next?.role === "reader" ? next.text : undefined)
      for (const pair of pairs) {
        lines.push(`Question ${displayedQuestion}: ${pair.question}`)
        if (pair.answer !== undefined) lines.push(`Answer ${displayedQuestion}: ${pair.answer}`)
        displayedQuestion += 1
      }
      if (next?.role === "reader") i += 1
      continue
    }

    lines.push(`Unpaired reader answer: ${entry.text}`)
  }

  return lines.join("\n")
}
