import { renderFindingRow } from "./artifact-renderers"
import { tableWrap } from "./html"
import { safeFilePath } from "./paths"
import type { AuditFinding, AuditRecord } from "./types"
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

  const roundNav = withAudits.map((r) =>
    `<a class="round-nav-chip" href="#audit-round-${r.round}">R${r.round}</a>`,
  ).join("")

  return `<div class="audit-rounds-nav round-nav">${roundNav}</div>${panels.join("")}`
}
