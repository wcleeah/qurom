# Phase 05 — TUI shell and `$EDITOR` integration

Source plan: `docs/tui-implementation-plan.md` §10 Step 5.

## Execution Snapshot

- Phase: 05 / 09
- Source plan: `docs/tui-implementation-plan.md`
- Readiness: **Blocked** on Phases 01 (toolchain), 02 (`runQuorum`), 03 (real bridge). Phase 04 not strictly required but recommended (otherwise two entry points exist temporarily).
- Primary deliverable: `src/tui/index.tsx`, `src/tui/App.tsx`, `src/tui/theme.ts`, `src/tui/editor.ts`, plus `src/tui/editor.test.ts`. The TUI process boots, renders an `App` shell, and `openInEditor` correctly suspends/resumes the renderer around `$EDITOR`.
- Blocking dependencies: see Phases 01–03 above.
- Target measurements: `bun run dev` opens the alt-screen, shows a placeholder shell, and exits cleanly on `Ctrl+C`; `editor.test.ts` covers all 6 assertions in plan §13.
- Next phase: 06 — Run store + bindings.

## Why This Phase Exists

The TUI needs an entry point that constructs the `CliRenderer`, mounts the React tree, and routes between three screens (Prompt → Running → Summary). The `$EDITOR` integration is grouped here because it is a shell-level concern: it suspends and resumes the same `CliRenderer` that `index.tsx` creates, and it must work before the prompt screen (Phase 07) can call it. Splitting these would duplicate setup.

## Start Criteria

- Phases 01–03 complete (`tsc` accepts `.tsx`; `runQuorum` callable; bridge wired).
- `reference/opentui/packages/react/README.md` reviewed for `createCliRenderer` and `createRoot` API.
- `renderer.suspend()` / `resume()` semantics confirmed (plan §3, citing `reference/opentui/packages/core/src/renderer.ts:2107-2165`).

## Dependencies And How To Check Them

| Dependency | Why | How to verify | Status |
|---|---|---|---|
| `@opentui/react` installed | Required by `index.tsx` | `bun pm ls @opentui/react` | Done after Phase 01 |
| `runQuorum` exists | `App` will call it (wiring lives mostly in Phase 06+) | `grep -n "runQuorum" src/runner.ts` | Done after Phase 02 |
| `loadRuntimeConfig`, `ensureArtifactDir`, `validateRuntimePrerequisites` | Called by `index.tsx` before `createCliRenderer` | `grep -n "loadRuntimeConfig\\|ensureArtifactDir\\|validateRuntimePrerequisites" src/` | Done (existing) |
| `renderer.suspend()` / `resume()` | `editor.ts` lifecycle | `reference/opentui/packages/core/src/renderer.ts:2107-2165` | Confirmed |
| `node:child_process` `spawnSync` | Editor invocation | Stdlib; always present | Done |

## Target Measurements And Gates

Entry gate: `bunx tsc --noEmit` exits 0 with the new `.tsx` files included.

Exit gates:

- `bun run dev` boots into alt-screen and shows the placeholder `App` shell. Method: manual run. Status: Unknown until executed.
- `Ctrl+C` exits cleanly; no orphan process. Status: Unknown until executed.
- `bun test src/tui/editor.test.ts` exits 0. The 6 assertions:
  1. non-zero exit → `{ ok: false, reason: "exit-code", code }`
  2. exit 0 + empty/whitespace file → `{ ok: false, reason: "empty" }`
  3. exit 0 + non-empty file → `{ ok: true, content, path }`
  4. command resolution honours `VISUAL` > `EDITOR` > `vi`
  5. temp file path = `runs/.drafts/<requestId>.md`; parent dir created if missing
  6. `renderer.suspend()` called before spawn; `renderer.resume()` called after, even when `spawnSync` throws
- `console.log` not invoked anywhere in `src/tui/` (plan §3 constraint that it is invisible while alt-screen is active).

## Scope

- `src/tui/index.tsx`: bootstrap (`loadRuntimeConfig` → `ensureArtifactDir` → `validateRuntimePrerequisites` → `createCliRenderer({ exitOnCtrlC: false })` → `createRoot(renderer).render(<App ...>)`), install a `console.warn`/`console.error` interceptor that buffers to a hidden system log (plan §12 risk).
- `src/tui/App.tsx`: state machine for `screen: "prompt" | "running" | "summary"`, holds `currentRun: RunHandle | undefined` and last submitted `request` (Phase 09 will use this). For this phase, render placeholder `<box/>` per screen — actual screens land in Phase 07.
- `src/tui/theme.ts`: per-role accent colors (drafter: bright cyan + `borderStyle: "double"`; auditors: distinct muted hues with single border), status colors (running/idle/error). Export tokens as plain constants.
- `src/tui/editor.ts`: implement `openInEditor({ requestId, renderer })` per plan §10 Step 5. Returns `{ ok: true, content, path } | { ok: false, reason: "cancelled" | "empty" | "exit-code", code? }`.
- `src/tui/editor.test.ts`: cover the 6 assertions above using stubs for `node:child_process` and `node:fs`.

## Out Of Scope

- `PromptScreen`, `RunningScreen`, `SummaryScreen`, `Dashboard`, `AgentGrid`, `AgentPanel`, `Footer` (Phase 07).
- `runStore`, `eventBindings` (Phase 06).
- Vim keymap (Phase 08).
- Re-run logic (Phase 09).

## Implementation Details

`src/tui/index.tsx`:

```tsx
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { App } from "./App"
import { loadRuntimeConfig } from "../config"
// + ensureArtifactDir, validateRuntimePrerequisites from existing modules

const config = await loadRuntimeConfig()
await ensureArtifactDir(config)
const prerequisites = await validateRuntimePrerequisites(config)

// Buffer stray warnings/errors so they do not corrupt the alt-screen.
const systemLog: Array<{ level: "warn" | "error"; text: string }> = []
const origWarn = console.warn
const origError = console.error
console.warn = (...a) => systemLog.push({ level: "warn", text: a.map(String).join(" ") })
console.error = (...a) => systemLog.push({ level: "error", text: a.map(String).join(" ") })

const renderer = await createCliRenderer({ exitOnCtrlC: false })
createRoot(renderer).render(<App config={config} prerequisites={prerequisites} systemLog={systemLog} />)
```

`src/tui/App.tsx`: minimal placeholder for this phase:

```tsx
export const App = (props: AppProps) => {
  const [screen, setScreen] = useState<"prompt" | "running" | "summary">("prompt")
  return <box>{/* placeholder; real screens land in Phase 07 */}</box>
}
```

`src/tui/editor.ts`:

```ts
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export type EditorResult =
  | { ok: true; content: string; path: string }
  | { ok: false; reason: "cancelled" | "empty" | "exit-code"; code?: number }

export interface OpenInEditorArgs {
  requestId: string
  renderer: { suspend(): Promise<void> | void; resume(): Promise<void> | void }
  artifactRoot: string
}

export const openInEditor = async ({ requestId, renderer, artifactRoot }: OpenInEditorArgs): Promise<EditorResult> => {
  const cmd = process.env.VISUAL ?? process.env.EDITOR ?? "vi"
  const path = join(artifactRoot, ".drafts", `${requestId}.md`)
  mkdirSync(dirname(path), { recursive: true })
  if (!existsSync(path)) writeFileSync(path, "")

  await renderer.suspend()
  let status: number | null = 0
  try {
    const result = spawnSync(cmd, [path], { stdio: "inherit", shell: false })
    status = result.status
    if (result.error) return { ok: false, reason: "exit-code", code: undefined }
  } finally {
    await renderer.resume()
  }

  if (status !== 0) return { ok: false, reason: "exit-code", code: status ?? undefined }
  const content = readFileSync(path, "utf8")
  if (content.trim().length === 0) return { ok: false, reason: "empty" }
  return { ok: true, content, path }
}
```

Notes:

- `stdio: "inherit"` hands the controlling terminal to the editor, the canonical pattern (plan §15 — `git commit`, `gh pr edit`).
- `renderer.suspend()`/`resume()` are awaited in case future implementations become async; today they are synchronous. (Inferred from `renderer.ts:2107-2165`.)
- `runs/.drafts/` is the artifact subdir; ignored by `.gitignore` (Phase 01).

`src/tui/theme.ts`:

```ts
export const theme = {
  drafter: { borderColor: "brightCyan", borderStyle: "double" as const },
  auditor: {
    "source-auditor": { borderColor: "magenta", borderStyle: "single" as const },
    "logic-auditor":  { borderColor: "yellow",  borderStyle: "single" as const },
    "clarity-auditor":{ borderColor: "green",   borderStyle: "single" as const },
  },
  status: { running: "yellow", idle: "gray", error: "red", complete: "green" },
}
```

(Color tokens are Inferred; opentui accepts standard ANSI color names per `reference/opentui/packages/react/README.md` examples.)

`src/tui/editor.test.ts`: use `bun test`'s mocking (`mock.module(...)` or dependency injection — plan does not specify, so prefer DI: `openInEditor` accepts a `spawn` and `fs` parameter in tests, defaulting to real ones in production).

## Execution Checklist

1. Create `src/tui/theme.ts` with the tokens above.
2. Create `src/tui/editor.ts` per Implementation Details; export `openInEditor` and `EditorResult`.
3. Create `src/tui/App.tsx` placeholder.
4. Create `src/tui/index.tsx` with bootstrap, console interceptor, renderer + `createRoot`.
5. Create `src/tui/editor.test.ts` with the 6 assertions; use stubs/DI for `spawnSync` and `fs`; verify `renderer.suspend()` is called before spawn and `renderer.resume()` is called in a `finally` even when the spawn throws.
6. Run `bunx tsc --noEmit`. Fix.
7. Run `bun test src/tui/editor.test.ts`. All 6 assertions green.
8. Run `bun run dev`. Confirm alt-screen opens, placeholder visible, `Ctrl+C` exits cleanly. Confirm cursor/echo state is restored after exit.
9. Manual editor smoke: temporarily wire a key to call `openInEditor` (or run a one-off script) and confirm `vi`/`$EDITOR` opens, `:wq` returns ok-true, `:cq` returns ok-false `exit-code`, and saving an empty file returns ok-false `empty`. Remove the temporary wire after.

## Files And Systems Likely Affected

- `src/tui/index.tsx` (new)
- `src/tui/App.tsx` (new — placeholder)
- `src/tui/theme.ts` (new)
- `src/tui/editor.ts` (new)
- `src/tui/editor.test.ts` (new)
- `runs/.drafts/` directory created lazily at first use

## Verification

- `bunx tsc --noEmit` → exit 0.
- `bun test src/tui/editor.test.ts` → all green.
- `bun run dev` → alt-screen renders; `Ctrl+C` exits without orphan; terminal restored.
- `grep -n "console\\.log" src/tui/` → empty.
- Manual `$EDITOR` smoke described above passes for `:wq`, `:cq`, empty save.

## Done Criteria

- All four source files exist and compile.
- Editor tests pass with the exact six assertions from plan §13.
- TUI boots and exits cleanly.
- `console.warn` / `console.error` interceptor is installed.
- Theme tokens are defined and ready for Phase 07 to consume.

## Handoff To Next Phase

- Next phase: **06 — Run store + event bindings** (`docs/phases/06-run-store-and-bindings.md`).
- What it depends on from this phase: a working renderer + `App` shell where the store can be mounted and components can subscribe; `theme.ts` tokens available.
- Becomes unblocked: Phase 06 (store + bindings) and Phase 07 (components) can both proceed; Phase 07's `PromptScreen` will import `openInEditor` from this phase.

## Open Questions Or Blockers

- Bun's mocking story for `node:child_process` and `node:fs` in `editor.test.ts`: dependency injection is recommended (cleaner), but `bun:test` also supports `mock.module`. Pick one and apply consistently (Inferred — plan does not say).
- Color tokens in `theme.ts` are Inferred from common ANSI names; if `@opentui/react` requires specific palette names, adjust at first compile.

## Sources

- `docs/tui-implementation-plan.md` §10 Step 5, §3 (constraints), §12 (renderer.suspend risk), §13 (editor tests).
- `reference/opentui/packages/react/README.md:138-181` — `createCliRenderer`, `createRoot`, `renderer.console.show()`.
- `reference/opentui/packages/core/src/renderer.ts:2107-2165` — `suspend()` / `resume()` semantics.
- `node:child_process` `spawnSync` + `stdio: "inherit"`; POSIX `VISUAL` / `EDITOR` convention (plan §15 Node subsection).
