import { readdir } from "node:fs/promises"
import { answeredQuestionsFromTranscript } from "../reader-transcript"
import { renderReaderProfileCard, renderReaderProfileSummary } from "./artifact-renderers"
import { resolveLiveNode } from "./node-registry"
import { safeFilePath, safeRunPath } from "./paths"
import type { LiveStatus } from "./types"
import { escapeHtml, renderMarkdown } from "./utils"

const READER_PROFILE_PATTERN = /^reader-profile(?:-\d+)?\.json$/
const READER_REPLY_PATTERN = /^reader-reply-turn-\d+\.json$/

/** Profile + reply files for the interview UI (replies are omitted from getRunFiles listings). */
export async function readerInterviewArtifactFiles(runName: string, files: string[]): Promise<string[]> {
  let disk: string[] = []
  try {
    disk = await readdir(safeRunPath(runName))
  } catch {
    // Run dir unreadable — fall back to caller-provided names only.
  }
  const fromDisk = disk.filter((f) => READER_PROFILE_PATTERN.test(f) || READER_REPLY_PATTERN.test(f))
  const fromList = files.filter((f) => READER_PROFILE_PATTERN.test(f) || READER_REPLY_PATTERN.test(f))
  return [...new Set([...fromList, ...fromDisk])].sort()
}

export function designRoundNumbers(files: string[], liveStatus: LiveStatus | null): number[] {
  const rounds = new Set<number>()
  for (const file of files) {
    const match = file.match(/^design-html-round-(\d+)\.html$/)
    if (match?.[1] !== undefined) rounds.add(parseInt(match[1], 10))
  }
  if (liveStatus?.phase === "running") {
    const liveNode = resolveLiveNode(liveStatus)
    if (liveNode === "runDesignHtml" || liveNode === "interactiveEnhance" || liveNode === "finalizeDesign") {
      const designRound = liveStatus.round ?? 0
      rounds.add(designRound)
    }
  }
  return [...rounds].sort((a, b) => a - b)
}

function readerProfileTurn(filename: string): number {
  const match = filename.match(/^reader-profile(?:-(\d+))?\.json$/)
  if (!match) return 0
  return match[1] ? parseInt(match[1], 10) : 999
}

function readerReplyTurn(filename: string): number {
  const match = filename.match(/^reader-reply-turn-(\d+)\.json$/)
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
  ${profileHtml ? `<div class="interview-profile-so-far"><div class="chat-current-label">Profile after turn ${turn}</div>${profileHtml}</div>` : ""}
</div>`
}

export async function renderDiscoverReaderScope(
  runName: string,
  files: string[],
  liveStatus: LiveStatus | null,
): Promise<string> {
  const interviewFiles = await readerInterviewArtifactFiles(runName, files)
  const profileFiles = interviewFiles
    .filter((f) => READER_PROFILE_PATTERN.test(f))
    .sort((a, b) => readerProfileTurn(a) - readerProfileTurn(b))
  const replyFiles = interviewFiles
    .filter((f) => READER_REPLY_PATTERN.test(f))
    .sort((a, b) => readerReplyTurn(a) - readerReplyTurn(b))

  let panels = ""

  const turns = new Map<number, { questions: string[]; answer?: string; profileFile?: string }>()
  for (const profileFile of profileFiles) {
    const turn = readerProfileTurn(profileFile)
    if (turn === 999) continue
    const data = await readJsonFile(runName, profileFile) as { newQuestions?: string[]; done?: boolean; profile?: unknown } | undefined
    if (data?.done === true) continue
    const questions = Array.isArray(data?.newQuestions) ? data.newQuestions.filter((q) => q.trim().length > 0) : []
    if (questions.length === 0) continue
    const entry = turns.get(turn) ?? { questions: [] }
    entry.questions = questions
    entry.profileFile = profileFile
    turns.set(turn, entry)
  }

  for (const replyFile of replyFiles) {
    const turn = readerReplyTurn(replyFile)
    const data = await readJsonFile(runName, replyFile) as { reply?: string } | undefined
    const entry = turns.get(turn) ?? { questions: [] }
    if (typeof data?.reply === "string") entry.answer = data.reply
    turns.set(turn, entry)
  }

  const sortedTurns = [...turns.entries()].sort((a, b) => a[0] - b[0])
  if (sortedTurns.length > 0) {
    panels += `<div class="section"><h2>Interview turns</h2>`
    for (const [turn, entry] of sortedTurns) {
      let profileHtml = ""
      if (entry.profileFile) {
        const profileData = await readJsonFile(runName, entry.profileFile)
        profileHtml = renderReaderProfileSummary(profileData)
      }
      panels += renderInterviewTurnBlock(turn, entry.questions, entry.answer, profileHtml || undefined)
    }
    panels += `</div>`
  }

  const finalProfile = profileFiles.find((f) => f === "reader-profile.json")
    ?? [...profileFiles]
      .filter((f) => f !== "reader-profile.json" && readerProfileTurn(f) !== 999)
      .sort((a, b) => readerProfileTurn(b) - readerProfileTurn(a))[0]
  if (finalProfile) {
    const data = await readJsonFile(runName, finalProfile)
    panels += `<div class="section"><h2>Reader profile</h2>${renderReaderProfileCard(data)}</div>`
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

export async function renderDesignHtmlScope(
  runName: string,
  files: string[],
  scope: "total" | number,
  liveStatus: LiveStatus | null,
): Promise<string> {
  const htmlFiles = files
    .filter((f) => /^design-html-round-(\d+)\.html$/.test(f))
    .sort((a, b) => {
      const ra = parseInt(a.match(/round-(\d+)/)?.[1] ?? "0", 10)
      const rb = parseInt(b.match(/round-(\d+)/)?.[1] ?? "0", 10)
      return ra - rb
    })

  const scoped = scope === "total"
    ? htmlFiles
    : htmlFiles.filter((f) => parseInt(f.match(/round-(\d+)/)?.[1] ?? "-1", 10) === scope)

  if (scoped.length === 0) {
    const draftingLive = liveStatus?.phase === "running" && resolveLiveNode(liveStatus) === "runDesignHtml"
    if (draftingLive && (scope === "total" || liveStatus!.round === scope)) {
      return `<div class="section"><h2>Round ${liveStatus!.round ?? 0} design HTML</h2><p class="empty-inline dim-text">HTML designer agent is generating the page…</p></div>`
    }
    return `<div class="section"><h2>${scope === "total" ? "Design HTML" : `Round ${scope} design HTML`}</h2><p class="empty-inline dim-text">No design HTML artifact yet.</p></div>`
  }

  let body = `<div class="section"><h2>${scope === "total" ? "HTML drafts by round" : `Round ${scope} design HTML`}</h2>`
  for (const htmlFile of scoped) {
    const round = parseInt(htmlFile.match(/round-(\d+)/)?.[1] ?? "0", 10)
    const isCurrent = liveStatus?.phase === "running"
      && resolveLiveNode(liveStatus) === "runDesignHtml"
      && (liveStatus.round ?? 0) === round
    body += renderDesignHtmlPanel(runName, htmlFile, {
      expanded: isCurrent || scoped.length === 1,
      subtitle: "Generated by html-designer",
    })
  }
  body += `</div>`
  return body
}

export async function renderInteractiveEnhanceScope(
  runName: string,
  files: string[],
  liveStatus: LiveStatus | null,
): Promise<string> {
  const htmlFiles = files
    .filter((f) => /^design-html-round-(\d+)\.html$/.test(f))
    .sort((a, b) => {
      const ra = parseInt(a.match(/round-(\d+)/)?.[1] ?? "0", 10)
      const rb = parseInt(b.match(/round-(\d+)/)?.[1] ?? "0", 10)
      return ra - rb
    })

  if (htmlFiles.length === 0) {
    const enhancingLive = liveStatus?.phase === "running" && resolveLiveNode(liveStatus) === "interactiveEnhance"
    if (enhancingLive) {
      return `<div class="section"><h2>Interactive enhancement</h2><p class="empty-inline dim-text">Interactive enhancer agent is updating the HTML…</p></div>`
    }
    return `<div class="section"><h2>Interactive enhancement</h2><p class="empty-inline dim-text">No enhanced HTML artifact yet.</p></div>`
  }

  const latest = htmlFiles[htmlFiles.length - 1]!
  const enhancingLive = liveStatus?.phase === "running" && resolveLiveNode(liveStatus) === "interactiveEnhance"

  let body = `<div class="section"><h2>Enhanced HTML output</h2>
  <p class="muted-note dim-text">The interactive-enhancer agent reads and rewrites <code>design-html-round-N.html</code> in place.</p>`
  body += renderDesignHtmlPanel(runName, latest, {
    expanded: true,
    subtitle: enhancingLive ? "Enhancement in progress…" : "Produced by interactive-enhancer",
  })
  if (htmlFiles.length > 1) {
    body += `<details class="design-history-details"><summary>All design HTML rounds (${htmlFiles.length})</summary>`
    for (const htmlFile of htmlFiles.slice(0, -1)) {
      body += renderDesignHtmlPanel(runName, htmlFile, { subtitle: "Earlier round" })
    }
    body += `</details>`
  }
  body += `</div>`
  return body
}
