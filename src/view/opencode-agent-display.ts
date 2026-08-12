import { join } from "node:path"

import { defaultsOpencodeAgentsDir, opencodeAgentsDir } from "../data-paths"
import { escapeHtml } from "./utils"

export type OpencodeAgentFileView = {
  relativePath: string
  content: string | null
  /** When set, the content is a fallback (e.g. shipped default) rather than the active file. */
  sourceNote?: string
}

async function readAgentMarkdown(baseDir: string, relativePath: string, role: string): Promise<OpencodeAgentFileView> {
  const path = join(baseDir, `${role}.md`)
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return { relativePath, content: null }
  }
  const content = (await file.text()).trim()
  return { relativePath, content: content || null }
}

export async function readActiveOpencodeAgent(workspaceDir: string, role: string): Promise<OpencodeAgentFileView> {
  return await readAgentMarkdown(opencodeAgentsDir(workspaceDir), `.opencode/agents/${role}.md`, role)
}

export async function readDefaultsOpencodeAgent(workspaceDir: string, role: string): Promise<OpencodeAgentFileView> {
  return await readAgentMarkdown(defaultsOpencodeAgentsDir(workspaceDir), `defaults/opencode/agents/${role}.md`, role)
}

/**
 * Prefer the active `.opencode/agents/` file; if missing, fall back to the shipped
 * defaults copy so new roles still show their agent def on the Roles config page.
 */
export async function readOpencodeAgentForConfigRoles(
  workspaceDir: string,
  role: string,
): Promise<OpencodeAgentFileView> {
  const active = await readActiveOpencodeAgent(workspaceDir, role)
  if (active.content) return active
  const shipped = await readDefaultsOpencodeAgent(workspaceDir, role)
  if (!shipped.content) return active
  return {
    relativePath: active.relativePath,
    content: shipped.content,
    sourceNote: `No file at ${active.relativePath} yet — showing shipped default from ${shipped.relativePath}. Seed missing agents (or Apply on Defaults → Bindings) to copy it into .opencode/agents/.`,
  }
}

export function renderOpencodeAgentReadonly(view: OpencodeAgentFileView): string {
  if (!view.content) {
    return `<p class="tiny-text muted-text">No agent file at <code>${escapeHtml(view.relativePath)}</code>.</p>`
  }
  const note = view.sourceNote
    ? `<p class="tiny-text muted-text">${escapeHtml(view.sourceNote)}</p>`
    : `<p class="tiny-text muted-text"><code>${escapeHtml(view.relativePath)}</code></p>`
  return `${note}
<pre class="config-readonly-agent">${escapeHtml(view.content)}</pre>`
}
