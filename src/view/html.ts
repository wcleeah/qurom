import { escapeHtml } from "./utils"

export function section(title: string, body: string, className = ""): string {
  const cls = className ? ` section ${className}` : "section"
  return `<div class="${cls}">
  <h2>${title}</h2>
  ${body}
</div>`
}

export function card(body: string, className = ""): string {
  const cls = className ? `card ${className}` : "card"
  return `<div class="${cls}">${body}</div>`
}

export function structuredCard(body: string, className = ""): string {
  const cls = className ? `structured-card ${className}` : "structured-card"
  return `<div class="${cls}">${body}</div>`
}

export function summaryTable(rows: string[], className = ""): string {
  const cls = className ? `summary-table ${className}` : "summary-table"
  return `<table class="${cls}">${rows.join("")}</table>`
}

export function summaryRow(label: string, value: string, options: { labelIsHtml?: boolean } = {}): string {
  const labelHtml = options.labelIsHtml ? label : escapeHtml(label)
  return `<tr><td>${labelHtml}</td><td>${value}</td></tr>`
}
