import { readdir } from "node:fs/promises"
import {
  designHtmlArtifactName,
  designHtmlArtifacts,
  DESIGNER_ROLE,
  GRAPHICAL_ENHANCER_ROLE,
  LEGACY_DESIGN_HTML_ROUND_RE,
  presentDesignHtmlArtifact,
  READING_EXPERIENCE_ENHANCER_ROLE,
} from "../design-artifacts"
import { answeredQuestionsFromTranscript } from "../reader-transcript"
import { renderReaderProfileCard, renderReaderProfileSummary } from "./artifact-renderers"
import { resolveLiveNode } from "./node-registry"
import { safeFilePath, safeRunPath } from "./paths"
import type { LiveStatus } from "./types"
import { escapeHtml, renderMarkdown } from "./utils"

const READER_PROFILE_PATTERN = /^reader-profile\.json$/
const QUESTION_PATTERN = /^question-\d+\.json$/
const REPLY_PATTERN = /^reply-\d+\.json$/

/** Profile + question/reply files for the interview UI. */
export async function readerInterviewArtifactFiles(runName: string, files: string[]): Promise<string[]> {
  let disk: string[] = []
  try {
    disk = await readdir(safeRunPath(runName))
  } catch {
    // Run dir unreadable — fall back to caller-provided names only.
  }
  const match = (f: string) => READER_PROFILE_PATTERN.test(f) || QUESTION_PATTERN.test(f) || REPLY_PATTERN.test(f)
  const fromDisk = disk.filter(match)
  const fromList = files.filter(match)
  return [...new Set([...fromList, ...fromDisk])].sort()
}

/** @deprecated Design HTML is role-staged; kept for legacy round-named artifacts. */
export function designRoundNumbers(files: string[], liveStatus: LiveStatus | null): number[] {
  const rounds = new Set<number>()
  for (const file of files) {
    const match = file.match(LEGACY_DESIGN_HTML_ROUND_RE)
    if (match?.[1] !== undefined) rounds.add(parseInt(match[1], 10))
  }
  if (liveStatus?.phase === "running") {
    const liveNode = resolveLiveNode(liveStatus)
    if (
      liveNode === "runDesignHtml"
      || liveNode === "graphicalEnhance"
      || liveNode === "interactiveEnhance"
      || liveNode === "readingExperienceEnhance"
      || liveNode === "finalizeDesign"
    ) {
      const designRound = liveStatus.round ?? 0
      rounds.add(designRound)
    }
  }
  return [...rounds].sort((a, b) => a - b)
}

function questionTurn(filename: string): number {
  const match = filename.match(/^question-(\d+)\.json$/)
  return match?.[1] ? parseInt(match[1], 10) : 0
}

function replyTurn(filename: string): number {
  const match = filename.match(/^reply-(\d+)\.json$/)
  return match?.[1] ? parseInt(match[1], 10) : 0
}

async function readJsonFile(runName: string, filename: string): Promise<unknown | undefined> {
  try {
    return await Bun.file(safeFilePath(runName, filename)).json()
  } catch {
    return undefined
  }
}

async function readTextFile(runName: string, filename: string): Promise<string | undefined> {
  try {
    return await Bun.file(safeFilePath(runName, filename)).text()
  } catch {
    return undefined
  }
}

function renderInterviewTurnBlock(
  turn: number,
  questions: string[],
  answer?: string,
  profileHtml?: string,
  options?: { pending?: boolean },
): string {
  const pending = options?.pending ?? false
  const questionsHtml = questions.map((q, i) =>
    `<div class="interviewer-msg"><span class="chat-icon">${questions.length > 1 ? `Question ${i + 1}` : "Question"}</span> <span class="chat-text">${escapeHtml(q)}</span></div>`
  ).join("")
  const answerHtml = answer
    ? `<div class="reader-msg"><span class="chat-icon">Answer</span> <span class="chat-text">${escapeHtml(answer)}</span></div>`
    : pending
      ? `<p class="empty-inline dim-text">Waiting for reader reply…</p>`
      : ""

  return `<div class="node-work-panel interview-turn-panel">
  <div class="node-work-panel-header">
    <h3>Turn ${turn}</h3>
  </div>
  <div class="chat-transcript">${questionsHtml}${answerHtml}</div>
  ${profileHtml ? `<details class="interview-profile-so-far" data-collapse-key="profile-after-turn-${turn}">
    <summary class="chat-current-label">Profile after turn ${turn}</summary>
    ${profileHtml}
  </details>` : ""}
</div>`
}

export async function renderDiscoverReaderScope(
  runName: string,
  files: string[],
  liveStatus: LiveStatus | null,
): Promise<string> {
  const interviewFiles = await readerInterviewArtifactFiles(runName, files)
  const questionFiles = interviewFiles
    .filter((f) => QUESTION_PATTERN.test(f))
    .sort((a, b) => questionTurn(a) - questionTurn(b))
  const replyFiles = interviewFiles
    .filter((f) => REPLY_PATTERN.test(f))
    .sort((a, b) => replyTurn(a) - replyTurn(b))

  let panels = ""

  const turns = new Map<number, { questions: string[]; answer?: string }>()
  for (const questionFile of questionFiles) {
    const turn = questionTurn(questionFile)
    const data = await readJsonFile(runName, questionFile) as { questions?: string[] } | undefined
    const questions = Array.isArray(data?.questions) ? data.questions.filter((q) => q.trim().length > 0) : []
    if (questions.length === 0) continue
    const entry = turns.get(turn) ?? { questions: [] }
    entry.questions = questions
    turns.set(turn, entry)
  }

  for (const replyFile of replyFiles) {
    const turn = replyTurn(replyFile)
    const data = await readJsonFile(runName, replyFile) as { reply?: string } | undefined
    const entry = turns.get(turn) ?? { questions: [] }
    if (typeof data?.reply === "string") entry.answer = data.reply
    turns.set(turn, entry)
  }

  const sortedTurns = [...turns.entries()].sort((a, b) => a[0] - b[0])
  if (sortedTurns.length > 0) {
    panels += `<div class="section"><h2>Interview turns</h2>`
    for (const [turn, entry] of sortedTurns) {
      panels += renderInterviewTurnBlock(turn, entry.questions, entry.answer)
    }
    panels += `</div>`
  }

  if (interviewFiles.includes("reader-profile.json")) {
    const data = await readJsonFile(runName, "reader-profile.json")
    panels += `<div class="section">${renderReaderProfileCard(data)}</div>`
  }

  const awaiting = liveStatus?.awaitingReaderReply
  const interviewLive = liveStatus?.phase === "running" && resolveLiveNode(liveStatus) === "discoverReader"
  if (interviewLive && awaiting) {
    const answered = awaiting.answeredQuestions ?? answeredQuestionsFromTranscript(
      (awaiting.transcript ?? []).flatMap((entry) =>
        entry.role === "interviewer" || entry.role === "reader"
          ? [{ role: entry.role, text: entry.text }]
          : [],
      ),
    )
    let liveHtml = `<div class="section"><h2>Live interview · turn ${awaiting.turn}</h2>`
    if (answered.length > 0) {
      liveHtml += `<details class="interview-history" open>
        <summary>Answered history (${answered.length})</summary>
        <div class="chat-transcript">${answered.map((pair, i) =>
          `<div class="chat-answered-turn">
            <div class="interviewer-msg"><span class="chat-icon">Question ${i + 1}</span> <span class="chat-text">${escapeHtml(pair.question)}</span></div>
            <div class="reader-msg"><span class="chat-icon">Answer ${i + 1}</span> <span class="chat-text">${escapeHtml(pair.answer)}</span></div>
          </div>`
        ).join("")}</div>
      </details>`
    }
    const pendingQuestions = awaiting.newQuestions ?? []
    liveHtml += renderInterviewTurnBlock(
      awaiting.turn,
      pendingQuestions.length > 0 ? pendingQuestions : ["(waiting for next question…)"],
      undefined,
      awaiting.partialProfile ? renderReaderProfileSummary(awaiting.partialProfile) : undefined,
      { pending: true },
    )
    liveHtml += `<p class="muted-note dim-text">Reply on the <a href="/runs/${encodeURIComponent(runName)}">run page</a> interview form.</p></div>`
    panels = liveHtml + panels
  }

  if (!panels) {
    panels = `<div class="section"><h2>Reader interview</h2><p class="empty-inline dim-text">No interview artifacts yet.</p></div>`
  }

  return panels
}

function renderDraftPanel(
  runName: string,
  filename: string,
  content: string,
  expanded: boolean,
): string {
  const words = content.split(/\s+/).filter(Boolean).length
  const chars = content.length
  const openHref = `/runs/${encodeURIComponent(runName)}/raw/${encodeURIComponent(filename)}`
  const sourceHref = `${openHref}?source=1`

  return `<div class="node-work-panel draft-panel">
  <div class="node-work-panel-header">
    <h3>${escapeHtml(filename)}</h3>
    <span class="dim-text">${words.toLocaleString()} words · ${chars.toLocaleString()} chars</span>
    <a class="tiny-text" href="${openHref}">Open rendered</a>
    <a class="tiny-text" href="${sourceHref}">Raw source</a>
  </div>
  <details class="draft-preview-details"${expanded ? " open" : ""}>
    <summary>Draft preview</summary>
    <div class="md-content draft-preview-body">${renderMarkdown(content)}</div>
  </details>
</div>`
}

export async function renderDraftFullDraftScope(
  runName: string,
  files: string[],
  scope: "total" | number,
  liveStatus: LiveStatus | null,
): Promise<string> {
  const drafts = files
    .filter((f) => /^draft-round-(\d+)\.md$/.test(f))
    .sort((a, b) => {
      const ra = parseInt(a.match(/round-(\d+)/)?.[1] ?? "0", 10)
      const rb = parseInt(b.match(/round-(\d+)/)?.[1] ?? "0", 10)
      return ra - rb
    })

  const scoped = scope === "total"
    ? drafts
    : drafts.filter((f) => parseInt(f.match(/round-(\d+)/)?.[1] ?? "-1", 10) === scope)

  if (scoped.length === 0) {
    const draftingLive = liveStatus?.phase === "running"
      && resolveLiveNode(liveStatus) === "draftFullDraft"
      && (scope === "total" || liveStatus.round === scope)
    if (draftingLive) {
      return `<div class="section"><h2>Round ${liveStatus!.round} draft</h2><p class="empty-inline dim-text">Research drafter is writing the draft…</p></div>`
    }
    return `<div class="section"><h2>${scope === "total" ? "Drafts" : `Round ${scope} draft`}</h2><p class="empty-inline dim-text">No draft artifact yet.</p></div>`
  }

  let html = `<div class="section"><h2>${scope === "total" ? "Drafts by round" : `Round ${scope} draft`}</h2>`
  for (const draftFile of scoped) {
    const round = parseInt(draftFile.match(/round-(\d+)/)?.[1] ?? "0", 10)
    const content = await readTextFile(runName, draftFile)
    if (!content) continue
    const isCurrent = liveStatus?.phase === "running"
      && resolveLiveNode(liveStatus) === "draftFullDraft"
      && liveStatus.round === round
    html += renderDraftPanel(runName, draftFile, content, isCurrent || scoped.length === 1)
  }
  html += `</div>`
  return html
}

function renderDesignHtmlPanel(
  runName: string,
  filename: string,
  options: { expanded?: boolean; subtitle?: string },
): string {
  const round = filename.match(/round-(\d+)/)?.[1] ?? "?"
  const viewerHref = `/runs/${encodeURIComponent(runName)}/raw/${encodeURIComponent(filename)}`
  const embedSrc = `${viewerHref}?source=1`
  const subtitle = options.subtitle ? `<span class="dim-text">${escapeHtml(options.subtitle)}</span>` : ""

  return `<div class="node-work-panel design-preview-panel">
  <div class="node-work-panel-header">
    <h3>Round ${round} HTML</h3>
    ${subtitle}
    <a class="tiny-text" href="${viewerHref}">Open in viewer</a>
    <a class="tiny-text" href="${embedSrc}" target="_blank" rel="noopener">Raw HTML</a>
  </div>
  <details class="design-preview-details"${options.expanded ? " open" : ""}>
    <summary>Live preview</summary>
    <div class="design-preview-frame-wrap">
      <iframe class="design-preview-frame" src="${embedSrc}" title="${escapeHtml(filename)}" loading="lazy"></iframe>
    </div>
  </details>
</div>`
}

function renderDesignStageScope(input: {
  runName: string
  files: string[]
  liveStatus: LiveStatus | null
  nodeId: string
  role: string
  title: string
  emptyLabel: string
  liveLabel: string
  note: string
}): string {
  const primary = presentDesignHtmlArtifact(input.role, input.files)
  const legacy = input.files.filter((f) => LEGACY_DESIGN_HTML_ROUND_RE.test(f)).sort()
  const live = input.liveStatus?.phase === "running" && resolveLiveNode(input.liveStatus) === input.nodeId

  if (!primary && legacy.length === 0) {
    if (live) {
      return `<div class="section"><h2>${escapeHtml(input.title)}</h2><p class="empty-inline dim-text">${escapeHtml(input.liveLabel)}</p></div>`
    }
    return `<div class="section"><h2>${escapeHtml(input.title)}</h2><p class="empty-inline dim-text">${escapeHtml(input.emptyLabel)}</p></div>`
  }

  let body = `<div class="section"><h2>${escapeHtml(input.title)}</h2>
  <p class="muted-note dim-text">${input.note}</p>`
  if (primary) {
    body += renderDesignHtmlPanel(input.runName, primary, {
      expanded: true,
      subtitle: live ? input.liveLabel : `Produced by ${input.role}`,
    })
  }
  if (legacy.length > 0) {
    body += `<details class="design-history-details"><summary>Legacy round artifacts (${legacy.length})</summary>`
    for (const htmlFile of legacy) {
      body += renderDesignHtmlPanel(input.runName, htmlFile, { subtitle: "Legacy design-html-round artifact" })
    }
    body += `</details>`
  }
  body += `</div>`
  return body
}

export async function renderDesignHtmlScope(
  runName: string,
  files: string[],
  _scope: "total" | number,
  liveStatus: LiveStatus | null,
): Promise<string> {
  const stageFiles = designHtmlArtifacts(files)
  const designerFile = designHtmlArtifactName(DESIGNER_ROLE)
  const draftingLive = liveStatus?.phase === "running" && resolveLiveNode(liveStatus) === "runDesignHtml"

  if (!files.includes(designerFile) && !files.some((f) => LEGACY_DESIGN_HTML_ROUND_RE.test(f))) {
    if (draftingLive) {
      return `<div class="section"><h2>Design HTML</h2><p class="empty-inline dim-text">HTML designer agent is generating the page…</p></div>`
    }
    return `<div class="section"><h2>Design HTML</h2><p class="empty-inline dim-text">No design HTML artifact yet.</p></div>`
  }

  let body = `<div class="section"><h2>Design HTML</h2>
  <p class="muted-note dim-text">The html-designer agent writes <code>${escapeHtml(designerFile)}</code>.</p>`
  if (files.includes(designerFile)) {
    body += renderDesignHtmlPanel(runName, designerFile, {
      expanded: true,
      subtitle: draftingLive ? "Design in progress…" : "Generated by html-designer",
    })
  }
  const others = stageFiles.filter((f) => f !== designerFile)
  if (others.length > 0) {
    body += `<details class="design-history-details"><summary>Other design HTML stages (${others.length})</summary>`
    for (const htmlFile of others) {
      body += renderDesignHtmlPanel(runName, htmlFile, { subtitle: "Later or legacy design stage" })
    }
    body += `</details>`
  }
  body += `</div>`
  return body
}

export async function renderGraphicalEnhanceScope(
  runName: string,
  files: string[],
  liveStatus: LiveStatus | null,
): Promise<string> {
  return renderDesignStageScope({
    runName,
    files,
    liveStatus,
    nodeId: "graphicalEnhance",
    role: GRAPHICAL_ENHANCER_ROLE,
    title: "Graphical enhancement",
    emptyLabel: "No graphical HTML artifact yet.",
    liveLabel: "Graphical enhancer agent is updating the HTML…",
    note: `The graphical-enhancer agent reads the designer HTML and writes <code>${escapeHtml(designHtmlArtifactName(GRAPHICAL_ENHANCER_ROLE))}</code>. Older runs may still have <code>design-html-interactive-enhancer.html</code>.`,
  })
}

export async function renderReadingExperienceEnhanceScope(
  runName: string,
  files: string[],
  liveStatus: LiveStatus | null,
): Promise<string> {
  return renderDesignStageScope({
    runName,
    files,
    liveStatus,
    nodeId: "readingExperienceEnhance",
    role: READING_EXPERIENCE_ENHANCER_ROLE,
    title: "Reading experience",
    emptyLabel: "No reading-experience HTML artifact yet.",
    liveLabel: "Reading-experience enhancer is updating the HTML…",
    note: `The reading-experience-enhancer agent reads the graphical HTML and writes <code>${escapeHtml(designHtmlArtifactName(READING_EXPERIENCE_ENHANCER_ROLE))}</code>.`,
  })
}
