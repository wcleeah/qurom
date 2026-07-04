#!/usr/bin/env bun
/**
 * Sync Cursor model IDs + API pricing into defaults/cursor-model-pricing.json.
 *
 * Model IDs are fetched from each https://cursor.com/docs/models/<slug> page
 * (embedded JSON field `modelId`).
 *
 * Pricing rows are scraped from the rendered docs table at
 * https://cursor.com/docs/models-and-pricing — refresh PRICING_ROWS by running
 * extractCursorPricingTable() in Chrome DevTools on that page (expand
 * "Show more models" first), then paste the JSON over PRICING_ROWS below.
 */

import { writeFile } from "node:fs/promises"
import { join } from "node:path"

const DOCS_ORIGIN = "https://cursor.com"
const PRICING_URL = `${DOCS_ORIGIN}/docs/models-and-pricing`
const OUTPUT_PATH = join(import.meta.dir, "..", "defaults", "cursor-model-pricing.json")

/** Paste output of extractCursorPricingTable() from DevTools to refresh pricing. */
const PRICING_ROWS: PricingRow[] = [
  { name: "Composer 2.5", href: "/docs/models/cursor-composer-2-5", input: 0.5, cacheWrite: null, cacheRead: 0.2, output: 2.5 },
  { name: "Composer 2.5 (Fast)", href: "/docs/models/cursor-composer-2-5", input: 3, cacheWrite: null, cacheRead: 0.5, output: 15, variantKey: "composer-2.5-fast" },
  { name: "Claude 4 Sonnet", href: "/docs/models/claude-4-sonnet", input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  { name: "Claude 4 Sonnet 1M", href: "/docs/models/claude-4-sonnet-1m", input: 6, cacheWrite: 7.5, cacheRead: 0.6, output: 22.5 },
  { name: "Claude 4.5 Haiku", href: "/docs/models/claude-4-5-haiku", input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
  { name: "Claude 4.5 Opus", href: "/docs/models/claude-opus-4-5", input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  { name: "Claude 4.5 Sonnet", href: "/docs/models/claude-4-5-sonnet", input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  { name: "Claude 4.6 Opus", href: "/docs/models/claude-opus-4-6", input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  { name: "Claude 4.6 Sonnet", href: "/docs/models/claude-4-6-sonnet", input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  { name: "Claude 4.7 Opus", href: "/docs/models/claude-opus-4-7", input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  { name: "Claude Fable 5", href: "/docs/models/claude-fable-5", input: 10, cacheWrite: 12.5, cacheRead: 1, output: 50 },
  { name: "Claude Opus 4.7 (fast mode)", href: "/docs/models/claude-opus-4-7-fast", input: 30, cacheWrite: 37.5, cacheRead: 3, output: 150 },
  { name: "Claude Opus 4.8", href: "/docs/models/claude-opus-4-8", input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  { name: "Claude Sonnet 5", href: "/docs/models/claude-sonnet-5", input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  { name: "Composer 1", href: "/docs/models/cursor-composer-1", input: 1.25, cacheWrite: null, cacheRead: 0.125, output: 10 },
  { name: "Composer 1.5", href: "/docs/models/cursor-composer-1-5", input: 3.5, cacheWrite: null, cacheRead: 0.35, output: 17.5 },
  { name: "Composer 2", href: "/docs/models/cursor-composer-2", input: 0.5, cacheWrite: null, cacheRead: 0.2, output: 2.5 },
  { name: "Gemini 2.5 Flash", href: "/docs/models/gemini-2-5-flash", input: 0.3, cacheWrite: null, cacheRead: 0.03, output: 2.5 },
  { name: "Gemini 3 Flash", href: "/docs/models/gemini-3-flash", input: 0.5, cacheWrite: null, cacheRead: 0.05, output: 3 },
  { name: "Gemini 3 Pro", href: "/docs/models/gemini-3-pro", input: 2, cacheWrite: null, cacheRead: 0.2, output: 12 },
  { name: "Gemini 3 Pro Image Preview", href: "/docs/models/gemini-3-pro-image-preview", input: 2, cacheWrite: null, cacheRead: 0.2, output: 12 },
  { name: "Gemini 3.1 Pro", href: "/docs/models/gemini-3-1-pro", input: 2, cacheWrite: null, cacheRead: 0.2, output: 12 },
  { name: "Gemini 3.5 Flash", href: "/docs/models/gemini-3-5-flash", input: 1.5, cacheWrite: null, cacheRead: 0.15, output: 9 },
  { name: "GLM 5.2", href: "/docs/models/glm-5-2", input: 1.4, cacheWrite: null, cacheRead: 0.26, output: 4.4 },
  { name: "GPT-5", href: "/docs/models/gpt-5", input: 1.25, cacheWrite: null, cacheRead: 0.125, output: 10 },
  { name: "GPT-5 Fast", href: "/docs/models/gpt-5-fast", input: 2.5, cacheWrite: null, cacheRead: 0.25, output: 20 },
  { name: "GPT-5 Mini", href: "/docs/models/gpt-5-mini", input: 0.25, cacheWrite: null, cacheRead: 0.025, output: 2 },
  { name: "GPT-5-Codex", href: "/docs/models/gpt-5-codex", input: 1.25, cacheWrite: null, cacheRead: 0.125, output: 10 },
  { name: "GPT-5.1 Codex", href: "/docs/models/gpt-5-1-codex", input: 1.25, cacheWrite: null, cacheRead: 0.125, output: 10 },
  { name: "GPT-5.1 Codex Max", href: "/docs/models/gpt-5-1-codex-max", input: 1.25, cacheWrite: null, cacheRead: 0.125, output: 10 },
  { name: "GPT-5.1 Codex Mini", href: "/docs/models/gpt-5-1-codex-mini", input: 0.25, cacheWrite: null, cacheRead: 0.025, output: 2 },
  { name: "GPT-5.2", href: "/docs/models/gpt-5-2", input: 1.75, cacheWrite: null, cacheRead: 0.175, output: 14 },
  { name: "GPT-5.2 Codex", href: "/docs/models/gpt-5-2-codex", input: 1.75, cacheWrite: null, cacheRead: 0.175, output: 14 },
  { name: "GPT-5.3 Codex", href: "/docs/models/gpt-5-3-codex", input: 1.75, cacheWrite: null, cacheRead: 0.175, output: 14 },
  { name: "GPT-5.4", href: "/docs/models/gpt-5-4", input: 2.5, cacheWrite: null, cacheRead: 0.25, output: 15 },
  { name: "GPT-5.4 Mini", href: "/docs/models/gpt-5-4-mini", input: 0.75, cacheWrite: null, cacheRead: 0.075, output: 4.5 },
  { name: "GPT-5.4 Nano", href: "/docs/models/gpt-5-4-nano", input: 0.2, cacheWrite: null, cacheRead: 0.02, output: 1.25 },
  { name: "GPT-5.5", href: "/docs/models/gpt-5-5", input: 5, cacheWrite: null, cacheRead: 0.5, output: 30 },
  { name: "Grok 4.20", href: "/docs/models/grok-4-20", input: 2, cacheWrite: null, cacheRead: 0.2, output: 6, variantKey: "grok-4.20", modelIdOverride: "grok-4.20" },
  { name: "Grok 4.3", href: "/docs/models/grok-4-3", input: 1.25, cacheWrite: null, cacheRead: 0.2, output: 2.5 },
  { name: "Grok Build 0.1", href: "/docs/models/grok-build-0-1", input: 1, cacheWrite: null, cacheRead: 0.2, output: 2 },
  { name: "Kimi K2.5", href: "/docs/models/kimi-k2-5", input: 0.6, cacheWrite: null, cacheRead: 0.1, output: 3 },
]

const AUTO_PRICING = {
  input: 1.25,
  output: 6,
  cache: {
    read: 0.25,
    write: 1.25,
  },
  note: "Auto pool bills Input + Cache Write at the input rate ($1.25/M).",
}

type PricingRow = {
  name: string
  href: string
  input: number
  cacheWrite: number | null
  cacheRead: number
  output: number
  variantKey?: string
  modelIdOverride?: string
}

type ModelPricingEntry = {
  name: string
  docSlug: string
  input: number
  output: number
  cache: {
    read: number
    write?: number
  }
  modelIdSource: "docs-page" | "override" | "inferred-from-slug"
}

type CursorModelPricingFile = {
  source: string
  syncedAt: string
  unit: "USD per 1M tokens"
  note: string
  auto: typeof AUTO_PRICING
  models: Record<string, ModelPricingEntry>
}

function docSlugFromHref(href: string) {
  const match = href.match(/\/docs\/models\/([^/?#]+)/)
  if (!match) throw new Error(`Unexpected model href: ${href}`)
  return match[1]!
}

function extractModelId(html: string): string | undefined {
  const match = html.match(/modelId\\":\\"([^\\"]+)\\"/)
  return match?.[1]
}

function inferModelIdFromSlug(slug: string): string {
  if (slug.startsWith("cursor-composer-")) {
    return slug.replace(/^cursor-composer-/, "composer-").replace(/-/g, (m, offset, s) => {
      const before = s.slice(0, offset)
      if (/composer-\d+$/.test(before)) return "."
      return m
    })
  }

  return slug
    .replace(/-(\d+)-(\d+)-/g, "-$1.$2-")
    .replace(/-(\d+)-(\d+)$/g, "-$1.$2")
    .replace(/-(\d+)$/g, (full, tail, offset, whole) => {
      if (/gemini-\d+-\d+$/.test(whole) || /gpt-\d+-\d+$/.test(whole) || /glm-\d+-\d+$/.test(whole)) {
        return full.replace(`-${tail}`, `.${tail}`)
      }
      return full
    })
}

async function fetchModelIdForSlug(slug: string): Promise<{ modelId?: string; modelIdSource: ModelPricingEntry["modelIdSource"] }> {
  const res = await fetch(`${DOCS_ORIGIN}/docs/models/${slug}`)
  if (!res.ok) return { modelId: inferModelIdFromSlug(slug), modelIdSource: "inferred-from-slug" }

  const html = await res.text()
  const modelId = extractModelId(html)
  if (!modelId) return { modelId: inferModelIdFromSlug(slug), modelIdSource: "inferred-from-slug" }

  if (slug === "grok-4-20" && modelId === "grok-build-0-1") {
    return { modelId: "grok-4.20", modelIdSource: "inferred-from-slug" }
  }

  return { modelId, modelIdSource: "docs-page" }
}

function buildCachePricing(row: PricingRow) {
  const cache: ModelPricingEntry["cache"] = { read: row.cacheRead }
  if (row.cacheWrite != null) cache.write = row.cacheWrite
  return cache
}

export function extractCursorPricingTable() {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Show more models")
  btn?.click()

  function parsePrice(raw: string | undefined | null) {
    if (!raw || raw.trim() === "-") return null
    const n = Number(raw.replace(/\$/g, "").trim())
    return Number.isFinite(n) ? n : null
  }

  const models: Array<Omit<PricingRow, "variantKey" | "modelIdOverride">> = []
  for (const table of document.querySelectorAll("table")) {
    const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent?.trim()).filter(Boolean)
    if (!headers.some((h) => h?.includes("Input"))) continue
    if (headers.includes("Plan")) continue

    for (const tr of table.querySelectorAll("tbody tr")) {
      const tds = [...tr.querySelectorAll("td")]
      if (tds.length < 4) continue
      const link = tr.querySelector('a[href*="/docs/models/"]')
      const name = link?.textContent?.trim() ?? tds[0]?.textContent?.trim()
      const href = link?.getAttribute("href")
      if (!name || !href) continue
      const cells = tds.map((td) => td.textContent?.replace(/\s+/g, " ").trim())
      models.push({
        name,
        href,
        input: parsePrice(cells[1]) ?? 0,
        cacheWrite: parsePrice(cells[2]),
        cacheRead: parsePrice(cells[3]) ?? 0,
        output: parsePrice(cells[4]) ?? 0,
      })
    }
  }

  return models
}

async function main() {
  const uniqueSlugs = [...new Set(PRICING_ROWS.map((row) => docSlugFromHref(row.href)))]
  const slugModelIds = new Map<string, { modelId: string; modelIdSource: ModelPricingEntry["modelIdSource"] }>()

  for (const slug of uniqueSlugs) {
    const result = await fetchModelIdForSlug(slug)
    slugModelIds.set(slug, {
      modelId: result.modelId ?? inferModelIdFromSlug(slug),
      modelIdSource: result.modelIdSource,
    })
    process.stderr.write(`fetched ${slug} -> ${result.modelId ?? inferModelIdFromSlug(slug)}\n`)
  }

  const models: Record<string, ModelPricingEntry> = {}

  for (const row of PRICING_ROWS) {
    const docSlug = docSlugFromHref(row.href)
    const slugInfo = slugModelIds.get(docSlug)!
    const modelId = row.modelIdOverride ?? row.variantKey ?? slugInfo.modelId
    const modelIdSource = row.modelIdOverride ? "override" as const : row.variantKey ? "override" as const : slugInfo.modelIdSource

    models[modelId] = {
      name: row.name,
      docSlug,
      input: row.input,
      output: row.output,
      cache: buildCachePricing(row),
      modelIdSource,
    }
  }

  const payload: CursorModelPricingFile = {
    source: PRICING_URL,
    syncedAt: new Date().toISOString(),
    unit: "USD per 1M tokens",
    note: "Estimated API-pool rates from Cursor docs. Subscription included usage may differ. Regenerate with: bun run scripts/sync-cursor-model-pricing.ts",
    auto: AUTO_PRICING,
    models,
  }

  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`Wrote ${OUTPUT_PATH} (${Object.keys(models).length} models)`)
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
