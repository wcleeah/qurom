import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, parse, relative, resolve } from "node:path"

import { listRuns } from "./data"
import { getRunsDir, safeFilePath } from "./paths"
import type { RunMeta } from "./types"
import { escapeHtml } from "./utils"

const STATIC_CSS = `
:root{color-scheme:light dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5;background:#f6f7f9;color:#172033}
*{box-sizing:border-box}body{margin:0}a{color:inherit}.shell{width:min(960px,calc(100% - 32px));margin:0 auto;padding:48px 0 72px}
.brand{display:inline-block;margin-bottom:40px;text-decoration:none;font-weight:750;letter-spacing:-.02em}.eyebrow{color:#667085;font-size:.8rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
h1{font-size:clamp(2rem,5vw,3.5rem);line-height:1.05;letter-spacing:-.04em;margin:.35rem 0 1rem}.lede{max-width:680px;color:#667085;font-size:1.05rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:32px}.card{display:block;padding:22px;border:1px solid #d8dde7;border-radius:14px;background:#fff;text-decoration:none;box-shadow:0 4px 18px #1720330a}
.card:hover{border-color:#98a2b3}.card h2{font-size:1.1rem;margin:0 0 8px}.meta{color:#667085;font-size:.88rem}.summary{color:#475467}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}
.button{display:inline-block;padding:10px 15px;border-radius:9px;background:#172033;color:#fff;text-decoration:none;font-weight:700}.button.secondary{background:transparent;color:inherit;border:1px solid #98a2b3}
.empty{margin-top:32px;padding:24px;border:1px dashed #98a2b3;border-radius:12px;color:#667085}
@media(prefers-color-scheme:dark){:root{background:#101318;color:#f2f4f7}.card{background:#171b22;border-color:#344054}.lede,.meta,.summary,.eyebrow,.empty{color:#98a2b3}.button{background:#f2f4f7;color:#101318}}
`
const EXPORT_MARKER = ".qurom-static-export"

export type StaticExportResult = {
  outputDir: string
  runCount: number
}

type StaticRun = RunMeta & { summary?: string }

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<style>${STATIC_CSS}</style>
</head>
<body><main class="shell">${body}</main></body>
</html>`
}

function encodedRunName(name: string): string {
  return encodeURIComponent(name)
}

async function readSummary(run: RunMeta): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile(safeFilePath(run.name, "summary.json"), "utf8")) as {
      summary?: unknown
    }
    return typeof parsed.summary === "string" ? parsed.summary : undefined
  } catch {
    return undefined
  }
}

function renderIndex(runs: StaticRun[]): string {
  const cards = runs.map((run) => `<a class="card" href="runs/${encodedRunName(run.name)}/">
  <h2>${escapeHtml(run.topic)}</h2>
  ${run.summary ? `<p class="summary">${escapeHtml(run.summary)}</p>` : ""}
  <span class="meta">${new Date(run.mtime).toISOString().slice(0, 10)} · ${run.roundCount} research round${run.roundCount === 1 ? "" : "s"}</span>
</a>`).join("\n")
  return page("Successful runs — quorum", `<a class="brand" href="./">quorum</a>
<p class="eyebrow">Published research</p>
<h1>Successful runs</h1>
<p class="lede">Read-only, deployable snapshots of completed quorum runs.</p>
${cards ? `<div class="grid">${cards}</div>` : `<div class="empty">No successful runs found.</div>`}`)
}

function renderRun(run: StaticRun): string {
  return page(`${run.topic} — quorum`, `<a class="brand" href="../../">← Successful runs</a>
<p class="eyebrow">Completed quorum run</p>
<h1>${escapeHtml(run.topic)}</h1>
${run.summary ? `<p class="lede">${escapeHtml(run.summary)}</p>` : ""}
<p class="meta">Run ${escapeHtml(run.name)} · ${run.roundCount} research round${run.roundCount === 1 ? "" : "s"} · ${run.designRoundCount} design round${run.designRoundCount === 1 ? "" : "s"}</p>
<div class="actions">
  <a class="button" href="share/">Open published HTML</a>
  <a class="button secondary" href="../../">Back to all runs</a>
</div>`)
}

export function assertSafeStaticOutput(outputDir: string): string {
  const output = resolve(outputDir)
  const cwd = resolve(process.cwd())
  const root = parse(output).root
  const runs = resolve(getRunsDir())
  if (output === root || output === cwd || output === runs || relative(output, runs) === "") {
    throw new Error(`Refusing unsafe static export path: ${output}`)
  }
  if (!relative(output, runs).startsWith("..") || !relative(runs, output).startsWith("..")) {
    throw new Error("Static export path must not contain or be inside the runs directory")
  }
  return output
}

export async function exportStaticSite(outputDir: string): Promise<StaticExportResult> {
  const output = assertSafeStaticOutput(outputDir)
  const parent = dirname(output)
  await mkdir(parent, { recursive: true })
  const temporary = join(parent, `.${parse(output).base}.tmp-${process.pid}-${Date.now()}`)

  try {
    try {
      const existing = await readdir(output)
      if (existing.length > 0 && !existing.includes(EXPORT_MARKER)) {
        throw new Error(`Refusing to replace non-export directory: ${output}`)
      }
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error
      }
    }
    await mkdir(temporary, { recursive: true })
    const approved = (await listRuns()).filter((run) => run.status === "approved" && run.hasFinalHtml)
    const runs: StaticRun[] = await Promise.all(approved.map(async (run) => ({
      ...run,
      summary: await readSummary(run),
    })))

    await writeFile(join(temporary, "index.html"), renderIndex(runs))
    await writeFile(join(temporary, EXPORT_MARKER), "Generated by qurom. Contents may be replaced.\n")
    for (const run of runs) {
      const runDir = join(temporary, "runs", encodedRunName(run.name))
      const shareDir = join(runDir, "share")
      await mkdir(shareDir, { recursive: true })
      await writeFile(join(runDir, "index.html"), renderRun(run))
      const finalHtml = await readFile(safeFilePath(run.name, "final.html"))
      await writeFile(join(shareDir, "index.html"), finalHtml)
    }

    await rm(output, { recursive: true, force: true })
    await rename(temporary, output)
    return { outputDir: output, runCount: runs.length }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}

export async function isStaticExportDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(join(path, "index.html"))).isFile()
  } catch {
    return false
  }
}
