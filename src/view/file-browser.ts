import { classifyFile } from "./data"
import { escapeHtml, formatBytes } from "./utils"
import type { FileClass } from "./types"

export { classifyFile }

export function renderFileBrowser(input: {
  runName: string
  files: string[]
  fileSizes: Map<string, number>
}): string {
  const { runName, files, fileSizes } = input
  const groups = new Map<string, Array<{ name: string } & FileClass>>()

  for (const f of files) {
    const fileClass = classifyFile(f)
    if (!groups.has(fileClass.group)) groups.set(fileClass.group, [])
    groups.get(fileClass.group)!.push({ name: f, ...fileClass })
  }

  const groupOrder = [
    "Final Outputs",
    "Run Metadata",
    "Research Rounds",
    "Rebuttals",
    "Design Rounds",
    "Debug",
    "Other",
  ]

  const renderFileItem = (item: { name: string } & FileClass) => {
    const sz = fileSizes.get(item.name) ?? 0
    const szStr = sz > 0 ? formatBytes(sz) : ""
    return `<li><a href="/runs/${encodeURIComponent(runName)}/raw/${encodeURIComponent(item.name)}">
  <span class="file-icon">${item.icon}</span>
  <span class="file-main">
    <span class="file-label">${escapeHtml(item.label)}</span>
    <span class="file-desc">${escapeHtml(item.description)} · <span class="file-name">${escapeHtml(item.name)}</span></span>
  </span>
  <span class="file-size">${escapeHtml(szStr)}</span>
</a></li>`
  }

  let html = ""
  for (const groupName of groupOrder) {
    const items = groups.get(groupName)
    if (!items || items.length === 0) continue

    const subGroups = new Map<string, Array<{ name: string } & FileClass>>()
    for (const item of items) {
      if (!subGroups.has(item.subGroup)) subGroups.set(item.subGroup, [])
      subGroups.get(item.subGroup)!.push(item)
    }

    const subgroupHtml = [...subGroups.entries()]
      .map(([subGroupName, subItems]) => `<div class="file-subgroup">
  <div class="file-subgroup-title">${escapeHtml(subGroupName)} <span class="dim-text">(${subItems.length})</span></div>
  <ul class="file-list">${subItems.map(renderFileItem).join("")}</ul>
</div>`)
      .join("")

    html += `<div class="file-group">
  <div class="file-group-title">${groupName} <span class="dim-text">(${items.length})</span></div>
  ${subgroupHtml}
</div>`
  }

  return html
}
