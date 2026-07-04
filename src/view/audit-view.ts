import { renderFindingRow } from "./artifact-renderers"
import { tableWrap } from "./html"
import { resolveLiveNode } from "./node-registry"
import { safeFilePath } from "./paths"
import { AUDITOR_ROLES } from "../role-registry"
import type { RoundArtifacts } from "./run-artifacts"
import type { AuditFinding, AuditRecord, LiveAgentStatus, LiveStatus } from "./types"
import { escapeHtml } from "./utils"

function countBySeverity(findings: AuditFinding[]): Record<string, number> {
  const counts: Record<string, number> = { blocker: 0, major: 0, minor: 0 }
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1
  }
  return counts
}

export async function readAuditBundle(runName: string, filename: string): Promise<AuditRecord[] | null> {
  try {
    const raw = await Bun.file(safeFilePath(runName, filename)).text()
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data as AuditRecord[] : null
  } catch {
    return null
  }
}

export async function readPerAgentAudit(runName: string, filename: string): Promise<AuditRecord | null> {
  try {
    const raw = await Bun.file(safeFilePath(runName, filename)).text()
    const data = JSON.parse(raw)
    if (!data || typeof data !== "object") return null
    const record = data as AuditRecord
    if (typeof record.agent !== "string") return null
    return record
  } catch {
    return null
  }
}

export type AuditVoteRow = {
  agent: string
  vote?: string
  findings?: number
  status: "complete" | "running" | "pending" | "error"
}

function liveAgentForAuditor(agents: Record<string, LiveAgentStatus>, agent: string): LiveAgentStatus | undefined {
  return agents[`auditor:${agent}`] ?? agents[agent]
}

function liveRowStatus(agent: LiveAgentStatus | undefined): AuditVoteRow["status"] {
  if (!agent) return "pending"
  if (agent.status === "running") return "running"
  if (agent.status === "error") return "error"
  if (agent.status === "complete") return "running"
  return "pending"
}

export async function buildRoundAuditVoteRows(
  runName: string,
  round: RoundArtifacts,
  liveStatus: LiveStatus | null,
  options?: { isCurrentRound?: boolean },
): Promise<AuditVoteRow[]> {
  if (round.audits) {
    const bundle = await readAuditBundle(runName, round.audits)
    if (bundle) {
      return bundle.map((audit) => ({
        agent: audit.agent,
        vote: audit.vote,
        findings: audit.findings?.length ?? 0,
        status: "complete" as const,
      }))
    }
  }

  const isCurrentRound = options?.isCurrentRound ?? false
  const auditingLive = isCurrentRound
    && liveStatus?.phase === "running"
    && liveStatus.round === round.round
    && resolveLiveNode(liveStatus) === "runParallelAudits"

  if (!auditingLive && round.perAgentAudits.length === 0) {
    return []
  }

  const rows = new Map<string, AuditVoteRow>()

  for (const file of round.perAgentAudits) {
    const match = file.match(/^audit-([\w-]+)-round-\d+\.json$/)
    if (!match) continue
    const agent = match[1]!
    const record = await readPerAgentAudit(runName, file)
    if (!record) continue
    rows.set(agent, {
      agent: record.agent,
      vote: record.vote,
      findings: record.findings?.length ?? 0,
      status: "complete",
    })
  }

  if (auditingLive) {
    for (const agent of AUDITOR_ROLES) {
      if (rows.has(agent)) continue
      const liveAgent = liveAgentForAuditor(liveStatus!.agents, agent)
      rows.set(agent, {
        agent,
        status: liveRowStatus(liveAgent),
      })
    }
  }

  return AUDITOR_ROLES
    .filter((agent) => rows.has(agent))
    .map((agent) => rows.get(agent)!)
}

export function renderRoundAuditVoteTable(rows: AuditVoteRow[]): string {
  if (rows.length === 0) {
    return `<p class="empty-inline dim-text">No auditor results yet.</p>`
  }

  const body = rows.map((row) => {
    if (row.status === "complete") {
      return `<tr>
  <td>${escapeHtml(row.agent)}</td>
  <td><span class="auditor-vote ${escapeHtml(row.vote ?? "")}">${escapeHtml(row.vote ?? "")}</span></td>
  <td>${row.findings ?? 0}</td>
</tr>`
    }

    const voteCell = row.status === "running"
      ? `<span class="audit-row-status running"><span class="audit-row-spinner" aria-hidden="true"></span> auditing…</span>`
      : row.status === "error"
        ? `<span class="audit-row-status error">error</span>`
        : `<span class="audit-row-status pending dim-text">waiting…</span>`

    return `<tr class="audit-row-${row.status}">
  <td>${escapeHtml(row.agent)}</td>
  <td>${voteCell}</td>
  <td><span class="dim-text">—</span></td>
</tr>`
  }).join("")

  return tableWrap(`<table class="summary-table summary-table-compact audit-vote-table audit-vote-table-compact">
  <thead><tr><th>Auditor</th><th>Vote</th><th>Findings</th></tr></thead>
  <tbody>${body}</tbody>
</table>`)
}

export function renderCompactAuditVoteTable(audits: AuditRecord[]): string {
  return renderRoundAuditVoteTable(audits.map((audit) => ({
    agent: audit.agent,
    vote: audit.vote,
    findings: audit.findings?.length ?? 0,
    status: "complete" as const,
  })))
}

export function renderAuditVoteTable(audits: AuditRecord[]): string {
  if (audits.length === 0) {
    return `<p class="empty-inline dim-text">No auditor results.</p>`
  }

  const rows = audits.map((audit) => {
    const sev = countBySeverity(audit.findings ?? [])
    const total = audit.findings?.length ?? 0
    return `<tr>
  <td><strong>${escapeHtml(audit.agent)}</strong></td>
  <td><span class="auditor-vote ${escapeHtml(audit.vote)}">${escapeHtml(audit.vote)}</span></td>
  <td>${sev.blocker ?? 0}</td>
  <td>${sev.major ?? 0}</td>
  <td>${sev.minor ?? 0}</td>
  <td>${total}</td>
</tr>`
  }).join("")

  return tableWrap(`<table class="summary-table summary-table-wide audit-vote-table">
  <thead><tr><th>Auditor</th><th>Vote</th><th>Blocker</th><th>Major</th><th>Minor</th><th>Total findings</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`)
}

export function renderAuditorFindingsBlocks(audits: AuditRecord[]): string {
  if (audits.length === 0) return ""

  let html = ""
  for (const audit of audits) {
    const totalFindings = audit.findings?.length ?? 0
    html += `<div class="structured-card audit-auditor-card">
  <div class="auditor-header">
    <span>${escapeHtml(audit.agent)}</span>
    <span class="auditor-vote ${escapeHtml(audit.vote)}">${escapeHtml(audit.vote)}${totalFindings > 0 ? ` · ${totalFindings} finding${totalFindings !== 1 ? "s" : ""}` : ""}</span>
  </div>`

    if (audit.summary) {
      html += `<div class="audit-summary">${escapeHtml(audit.summary)}</div>`
    }

    if (totalFindings === 0) {
      html += `<p class="empty-inline dim-text">No findings.</p>`
    } else {
      for (const f of audit.findings ?? []) {
        html += renderFindingRow(f)
      }
    }

    html += `</div>`
  }
  return html
}

export function renderAuditRoundPanel(
  runName: string,
  round: number,
  filename: string,
  audits: AuditRecord[],
  options?: { expanded?: boolean },
): string {
  const expanded = options?.expanded ?? false
  const rawHref = `/runs/${encodeURIComponent(runName)}/raw/${encodeURIComponent(filename)}`

  return `<div class="audit-round-panel" id="audit-round-${round}">
  <div class="audit-round-panel-header">
    <h3>Round ${round}</h3>
    <a class="tiny-text" href="${rawHref}">${escapeHtml(filename)}</a>
  </div>
  ${renderAuditVoteTable(audits)}
  <details class="audit-findings-details"${expanded ? " open" : ""}>
    <summary>Findings by auditor (${audits.reduce((n, a) => n + (a.findings?.length ?? 0), 0)} total)</summary>
    ${renderAuditorFindingsBlocks(audits)}
  </details>
</div>`
}

export async function renderAllAuditRounds(
  runName: string,
  rounds: Array<{ round: number; audits?: string }>,
  focusRound?: number,
  options?: { includeNav?: boolean },
): Promise<string> {
  const panels: string[] = []
  const withAudits = rounds.filter((r) => r.audits)

  for (const entry of withAudits) {
    if (!entry.audits) continue
    const data = await readAuditBundle(runName, entry.audits)
    if (!data) continue
    const expanded = focusRound !== undefined
      ? entry.round === focusRound
      : entry.round === withAudits[withAudits.length - 1]?.round
    panels.push(renderAuditRoundPanel(runName, entry.round, entry.audits, data, { expanded }))
  }

  if (panels.length === 0) {
    return `<p class="empty-inline dim-text">No audit bundles yet.</p>`
  }

  if (options?.includeNav === false) {
    return panels.join("")
  }

  const roundNav = withAudits.map((r) =>
    `<a class="round-nav-chip" href="#audit-round-${r.round}">R${r.round}</a>`,
  ).join("")

  return `<div class="audit-rounds-nav round-nav">${roundNav}</div>${panels.join("")}`
}
