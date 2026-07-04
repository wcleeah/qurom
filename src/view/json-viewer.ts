import { tableWrap } from "./html"
import { escapeHtml } from "./utils"

const JSON_VIEWER_SCRIPT = /* html */ `
<script>
(function () {
  var root = document.querySelector(".json-viewer")
  if (!root) return
  var expand = root.querySelector("[data-json-expand-all]")
  var collapse = root.querySelector("[data-json-collapse-all]")
  if (expand instanceof HTMLButtonElement) {
    expand.addEventListener("click", function () {
      root.querySelectorAll("details.json-nested").forEach(function (el) { el.open = true })
    })
  }
  if (collapse instanceof HTMLButtonElement) {
    collapse.addEventListener("click", function () {
      root.querySelectorAll("details.json-nested").forEach(function (el) { el.open = false })
    })
  }
})()
</script>`

function jsonMeta(data: unknown): string {
  if (data === null) return "null"
  if (Array.isArray(data)) {
    return `Array · ${data.length} item${data.length !== 1 ? "s" : ""}`
  }
  if (typeof data === "object") {
    const keys = Object.keys(data)
    return `Object · ${keys.length} key${keys.length !== 1 ? "s" : ""}`
  }
  return typeof data
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isUniformObjectArray(arr: unknown[]): arr is Record<string, unknown>[] {
  if (arr.length === 0) return false
  if (!arr.every(isPlainObject)) return false
  const keys = Object.keys(arr[0]!)
  if (keys.length === 0 || keys.length > 16) return false
  return arr.every((item) => {
    const itemKeys = Object.keys(item)
    return itemKeys.length === keys.length && keys.every((key) => key in item)
  })
}

function uniformObjectColumns(arr: Record<string, unknown>[]): string[] {
  return Object.keys(arr[0] ?? {})
}

function renderPrimitive(value: unknown): string {
  if (value === null) return `<span class="json-null">null</span>`
  if (typeof value === "boolean") return `<span class="json-boolean">${value}</span>`
  if (typeof value === "number") return `<span class="json-number">${String(value)}</span>`
  if (typeof value === "string") {
    if (value.length > 200) {
      return `<details class="json-string-details json-nested">
  <summary><span class="json-string">"${escapeHtml(value.slice(0, 80))}…"</span> <span class="json-meta">(${value.length} chars)</span></summary>
  <pre class="json-string-block">${escapeHtml(value)}</pre>
</details>`
    }
    return `<span class="json-string">"${escapeHtml(value)}"</span>`
  }
  return `<span class="json-unknown">${escapeHtml(String(value))}</span>`
}

function renderNestedSummary(value: unknown): string {
  if (Array.isArray(value)) {
    return `Array · ${value.length} item${value.length !== 1 ? "s" : ""}`
  }
  if (isPlainObject(value)) {
    const count = Object.keys(value).length
    return `Object · ${count} key${count !== 1 ? "s" : ""}`
  }
  return "Value"
}

function renderCellValue(value: unknown, open = false): string {
  if (value === null || typeof value !== "object") {
    return renderPrimitive(value)
  }
  if (Array.isArray(value)) {
    if (isUniformObjectArray(value)) {
      return renderJsonObjectArrayTable(value, { nested: true })
    }
    return renderJsonArrayBlock(value, open)
  }
  if (isPlainObject(value)) {
    return renderJsonObjectBlock(value, open)
  }
  return renderPrimitive(value)
}

function renderJsonObjectBlock(obj: Record<string, unknown>, open = false): string {
  const rows = Object.entries(obj).map(([key, value]) =>
    `<tr><td>${escapeHtml(key)}</td><td>${renderCellValue(value)}</td></tr>`,
  ).join("")
  if (rows.length === 0) {
    return `<span class="json-meta">{ empty object }</span>`
  }
  const openAttr = open ? " open" : ""
  return `<details class="json-nested"${openAttr}>
  <summary>${escapeHtml(renderNestedSummary(obj))}</summary>
  ${tableWrap(`<table class="summary-table json-kv-table">${rows}</table>`)}
</details>`
}

function renderJsonArrayBlock(arr: unknown[], open = false): string {
  if (arr.length === 0) {
    return `<span class="json-meta">[ empty array ]</span>`
  }
  const items = arr.map((value, index) => {
    const label = `[${index}]`
    if (value === null || typeof value !== "object") {
      return `<li class="json-array-item"><span class="json-index">${label}</span> ${renderPrimitive(value)}</li>`
    }
    return `<li class="json-array-item"><span class="json-index">${label}</span> ${renderCellValue(value)}</li>`
  }).join("")
  const openAttr = open ? " open" : ""
  return `<details class="json-nested"${openAttr}>
  <summary>${escapeHtml(renderNestedSummary(arr))}</summary>
  <ul class="json-array-list">${items}</ul>
</details>`
}

function renderJsonObjectArrayTable(
  arr: Record<string, unknown>[],
  options: { nested?: boolean } = {},
): string {
  const columns = uniformObjectColumns(arr)
  const header = columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")
  const body = arr.map((row) => {
    const cells = columns.map((col) => `<td>${renderCellValue(row[col])}</td>`).join("")
    return `<tr>${cells}</tr>`
  }).join("")
  const table = tableWrap(
    `<table class="summary-table summary-table-wide json-data-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`,
  )
  if (options.nested) {
    return `<details class="json-nested">
  <summary>${escapeHtml(renderNestedSummary(arr))}</summary>
  ${table}
</details>`
  }
  return `<div class="structured-card json-viewer-card">${table}</div>`
}

function renderJsonObjectTable(obj: Record<string, unknown>): string {
  const rows = Object.entries(obj).map(([key, value]) =>
    `<tr><td>${escapeHtml(key)}</td><td>${renderCellValue(value, true)}</td></tr>`,
  ).join("")
  if (rows.length === 0) {
    return `<div class="structured-card json-viewer-card"><p class="muted-text json-empty">Empty object</p></div>`
  }
  return `<div class="structured-card json-viewer-card">${tableWrap(`<table class="summary-table json-kv-table">${rows}</table>`)}</div>`
}

export function renderJsonPayload(data: Record<string, unknown>): string {
  const rows = Object.entries(data).map(([key, value]) =>
    `<tr><td>${escapeHtml(key)}</td><td>${renderCellValue(value)}</td></tr>`,
  ).join("")
  if (rows.length === 0) {
    return `<p class="muted-text json-empty">No payload</p>`
  }
  return tableWrap(`<table class="summary-table json-kv-table">${rows}</table>`)
}

export function renderJsonViewer(data: unknown): string {
  let body: string
  if (Array.isArray(data) && isUniformObjectArray(data)) {
    body = renderJsonObjectArrayTable(data)
  } else if (isPlainObject(data)) {
    body = renderJsonObjectTable(data)
  } else if (Array.isArray(data)) {
    body = `<div class="structured-card json-viewer-card">${renderJsonArrayBlock(data, true)}</div>`
  } else {
    body = `<div class="structured-card json-viewer-card json-primitive-root">${renderPrimitive(data)}</div>`
  }

  return `<div class="json-viewer">
  <div class="json-viewer-toolbar">
    <span class="json-viewer-meta">${escapeHtml(jsonMeta(data))}</span>
    <div class="json-viewer-actions">
      <button type="button" class="json-viewer-btn" data-json-expand-all>Expand all</button>
      <button type="button" class="json-viewer-btn" data-json-collapse-all>Collapse all</button>
    </div>
  </div>
  <div class="json-viewer-body">${body}</div>
</div>${JSON_VIEWER_SCRIPT}`
}
