import { join } from "node:path"

import { defaultsOpencodeAgentsDir, opencodeAgentsDir } from "../data-paths"
import { escapeHtml } from "./utils"

export type OpencodeAgentFileView = {
  relativePath: string
  content: string | null
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

export function renderOpencodeAgentReadonly(view: OpencodeAgentFileView): string {
  if (!view.content) {
    return `<p class="tiny-text muted-text">No agent file at <code>${escapeHtml(view.relativePath)}</code>.</p>`
  }
  return `<p class="tiny-text muted-text"><code>${escapeHtml(view.relativePath)}</code></p>
<pre class="config-readonly-agent">${escapeHtml(view.content)}</pre>`
}
