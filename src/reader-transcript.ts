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
