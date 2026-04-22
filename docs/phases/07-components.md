# Phase 07 — TUI components (Dashboard, AgentGrid, AgentPanel, PromptScreen, SummaryScreen, Footer)

Source plan: `docs/tui-implementation-plan.md` §10 Step 7, §11 (UI sketch + component map).

## Execution Snapshot

- Phase: 07 / 09
- Source plan: `docs/tui-implementation-plan.md`
- Readiness: **Blocked** on Phase 05 (TUI shell + `editor.ts`) and Phase 06 (`createRunStore` + `bindBusToStore`).
- Primary deliverable: a complete component tree under `src/tui/components/` plus an updated `src/tui/App.tsx` that switches between `PromptScreen` → `RunningScreen` → `SummaryScreen`, owns the bus + store + binding lifecycle, and calls `runQuorum` from Phase 02.
- Blocking dependencies: Phases 05 and 06.
- Target measurements: all functional screens mount and run end-to-end; all four agents are visible during a run; single-column fallback exists at narrow widths; "Terminal too small" banner appears at <60×20; per-panel scrollback renders without overflowing the box; `PromptScreen` and `SummaryScreen` are walkable. Visual hierarchy is intentionally provisional because the ambitious layout pass lands in Phase 07.5.
- Next phase: 07.5 — UI hierarchy and layout polish.

## Why This Phase Exists

Phases 02–06 produced the data plane. Nothing is on screen yet. This phase puts the first functional pixels on the terminal: it composes the opentui primitives (`<box>`, `<scrollbox>`, `<ascii-font>`, `<select>`, `<input>`) into a working prompt → run → summary flow, wires each component to a store selector so panels do not all re-render on every event, and ties the state machine together inside `App`. The goal here is correctness and basic usability, not final hierarchy. The ambitious layout pass lands immediately after this in Phase 07.5; vim keys arrive in Phase 08, re-run flow in Phase 09.

## Start Criteria

- Phase 05 done: `src/tui/index.tsx` boots a `CliRenderer`, `App.tsx` exists as a placeholder, `src/tui/editor.ts` exports `openInEditor`.
- Phase 06 done: `createRunStore`, `bindBusToStore`, role mapping all in `src/tui/state/`.
- Phase 02 done: `runQuorum` callable with `(request, bus, opts)`.

## Dependencies And How To Check Them

| Dependency | Why | How to verify | Status |
|---|---|---|---|
| `src/tui/index.tsx` + `App.tsx` placeholder | Mount point | `ls src/tui/index.tsx src/tui/App.tsx` | Done after Phase 05 |
| `src/tui/editor.ts` `openInEditor` | Compose-document flow | `grep -n "export.*openInEditor" src/tui/editor.ts` | Done after Phase 05 |
| `createRunStore`, `bindBusToStore` | State plumbing | `grep -n "export" src/tui/state/runStore.ts src/tui/state/eventBindings.ts` | Done after Phase 06 |
| `runQuorum`, `createEventBus` | Run invocation | `grep -n "export.*runQuorum\\|createEventBus" src/runner.ts` | Done after Phase 02 |
| `quorum.config.json` | Drafter + auditor names for grid layout | `cat quorum.config.json` | Done |
| `useTerminalDimensions`, `useKeyboard`, `useRenderer` | opentui hooks | `reference/opentui/packages/react/README.md:165-285` | Confirmed |
| `<scrollbox>`, `<box>`, `<ascii-font>`, `<select>`, `<input>` | opentui components | `reference/opentui/packages/react/README.md:373-505` | Confirmed |

## Target Measurements And Gates

Entry gate: Phases 05 + 06 green; `bunx tsc --noEmit` exit 0; `bun test` exit 0.

Exit gates:

- `bun run dev` boots into `PromptScreen` without throwing.
- Topic mode: typing a topic + `Enter` transitions `App` to `RunningScreen` and `runQuorum` is invoked.
- During a run, all four agent panels are visible at ≥100 cols; drafter is top-left with `borderStyle="double"`; the dashboard wordmark renders via `<ascii-font font="tiny" text="QUORUM"/>`.
- At <100 cols the layout falls back to a single column (drafter first); at <60×20 a "Terminal too small" banner replaces the grid.
- After `runQuorum` resolves, `App` transitions to `SummaryScreen` showing outcome, approved agents, output path, trace id.
- Compose-document mode: pressing `e` calls `openInEditor`, the renderer suspends, the editor opens, and on resume the prompt screen shows a one-line document summary card.
- `bunx tsc --noEmit` exit 0.
- No `console.log` calls in any new component file (`grep -n "console\\." src/tui/components/` returns nothing) — all debug output goes through the system log buffer mentioned in plan §12.

## Scope

- New files under `src/tui/components/`:
  - `Dashboard.tsx`
  - `AgentGrid.tsx`
  - `AgentPanel.tsx`
  - `PromptScreen.tsx`
  - `RunningScreen.tsx` (thin composer of `Dashboard` + `AgentGrid`)
  - `SummaryScreen.tsx`
  - `Footer.tsx`
  - `TooSmallBanner.tsx`
- Replace `src/tui/App.tsx` placeholder from Phase 05 with the real screen state machine.
- A small `useStoreSelector(store, selector)` hook (or inline `useSyncExternalStore`) under `src/tui/state/useStore.ts` so components subscribe by selector without re-rendering all four panels on every event.

## Out Of Scope

- Running-screen hierarchy polish and the drafter-primary split layout: Phase 07.5.
- Vim keybindings (`useKeyboard` for `j/k`, `h/l`, `gg`, `G`, `Ctrl-d`, `?` overlay, `Esc` release): all Phase 08.
- Re-run flow (`r`, `n`, `f` from `SummaryScreen`): Phase 09.
- Mid-run `Ctrl-C` cancellation wiring: Phase 08.
- Help overlay (`?`): Phase 08.

## Implementation Details

### `App.tsx`

Owns three pieces of state: `screen: "prompt" | "running" | "summary"`, `lastRequest: { mode: "topic" | "document"; topic?: string; document?: { path: string; content: string } } | undefined`, and the per-run `bus + store + abortController + unbind`.

Lifecycle for a run (called from `PromptScreen`'s `onSubmit`):

```ts
const bus = createEventBus()
const store = createRunStore({ config: quorumConfig })
const unbind = bindBusToStore(bus, store)
const ac = new AbortController()
setRunCtx({ bus, store, unbind, ac })
setScreen("running")
runQuorum(request, bus, { signal: ac.signal })
  .then((result) => {
    setResult(result)
    setScreen("summary")
  })
  .catch((err) => {
    setError(err)
    setScreen("summary")
  })
  .finally(() => {
    unbind()
  })
```

Notes:

- `quorumConfig` is loaded once at module top-level via the existing `src/config.ts` loader.
- `setRunCtx` keeps the references reachable so Phase 08 can wire `Ctrl-C` to `ac.abort()` and Phase 09 can reset the store.
- The store is recreated per run, so Phase 09's "reset between runs" requirement is naturally satisfied.

### `useStore.ts` (selector hook)

```ts
export function useStoreSelector<T>(store: RunStore, selector: (s: RunStoreState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()))
}
```

Components must call this with a narrow selector (e.g. `(s) => s.agents["source-auditor"]`) so unrelated updates do not re-render them. React's `useSyncExternalStore` already short-circuits via `Object.is`, so reducer outputs need to preserve referential identity for unchanged sub-trees — Phase 06's reducer should already do this; if it does not, treat as a Phase 06 follow-up.

### `Dashboard.tsx`

Two rows for the functional baseline. Row 1: `<ascii-font font="tiny" text="QUORUM"/>` left-aligned, then phase badge, round, short request id (first 4 hex chars + `..`), short trace id, elapsed time `mm:ss`. Row 2: per-agent compact stats `[role | tools | errors | last]` plus output dir.

Selector reads `lifecycle`, `graph`, and a slim per-agent summary (`{ status, toolsTotal, toolsErrored, lastEventAt }`) — not full scrollback.

Elapsed time: a tiny `useElapsed(startedAt)` hook using `useState` + `setInterval(1000)`; pauses when `lifecycle.phase === "complete"`.

Responsive: when `height < 30`, collapse to a single row showing only phase + round + short request id. Per-agent stats then move into each `AgentPanel` header (the panel already has room). Phase 07.5 may remove or demote the wordmark entirely during active runs.

### `AgentGrid.tsx`

Reads `quorumConfig` to know the slot order: `[drafter, ...auditors]`. Computes a simple functional layout via `useTerminalDimensions()`:

- `width >= 100 && height >= 30`: equal-weight wide layout so all agents are visible.
- `width < 100`: single column (`flexDirection: "column"` only), drafter first.
- `width < 60 || height < 20`: render `<TooSmallBanner/>` instead of the grid.

For `1 + N` cells where N != 3, take `Math.ceil(Math.sqrt(1 + N))` columns; below 4 cells stay single row. Today N=3 so the equal-weight wide layout is enough to prove plumbing. Phase 07.5 replaces this with the drafter-primary split view.

Passes `focused: false` to every panel (Phase 08 will lift focus state up to `App`).

### `AgentPanel.tsx`

Props: `{ roleKey: string; title: string; isDrafter: boolean; focused: boolean }`.

Selector: `(s) => s.agents[roleKey]`.

Layout:

```tsx
<box border title={title} borderStyle={isDrafter ? "double" : "single"} borderColor={isDrafter ? theme.drafter : theme.panel}>
  <box flexDirection="row">
    <text>{statusDot(agent.status)} {agent.activeTool?.tool ?? "-"}</text>
    {hasNewWhileScrolledUp ? <text fg={theme.accent}>v new</text> : null}
  </box>
  <scrollbox focused={focused} ref={scrollRef}>
    {agent.scrollback.map((entry, i) => <text key={i}>{formatEntry(entry)}</text>)}
  </scrollbox>
</box>
```

`formatEntry` prefixes with `> ` and applies a per-kind color from `theme.ts` (reasoning: dim, tool: cyan, permission: yellow, system: red).

`hasNewWhileScrolledUp`: track `lastSeenLength` in a ref; when `agent.scrollback.length > lastSeenLength` AND the scrollbox is not at the bottom, set a local `hasNew` state. Auto-scroll-to-bottom + reset of `hasNew` happens in Phase 08 on `G` keypress; for this phase, scrolling to the very bottom via mouse wheel (opentui default) clears `hasNew` via an `onScroll` callback if the API exposes one — otherwise leave it as an Open Question and let Phase 08 own the reset.

### `PromptScreen.tsx`

Two modes via a top-level `<select>` (Topic / Compose document).

Topic mode: `<input>` for the topic. `onSubmit` (Enter) calls `props.onSubmit({ mode: "topic", topic })`. Empty topic disables submit (visual hint: "type a topic to run").

Compose-document mode:

- Maintains `doc: { path: string; content: string } | undefined` and `requestId: string` (generated once via `crypto.randomUUID()` per session of the prompt screen).
- Renders a one-line summary card: `runs/.drafts/<requestId>.md  ·  <N> chars  ·  <first-line-preview>` when `doc` exists; otherwise `(no document yet — press e to compose)`.
- Renders three actions: `e edit`, `Enter run` (disabled when `!doc || doc.content.trim() === ""`), `Esc back to mode select`.
- `e` handler:
  ```ts
  const renderer = useRenderer()
  const result = await openInEditor({ requestId, renderer })
  if (result.ok) setDoc({ path: result.path, content: result.content })
  else setHint(result.reason === "empty" ? "(empty — nothing saved)" : "(cancelled)")
  ```
- `Enter` (when enabled): `props.onSubmit({ mode: "document", document: doc })`.

Per plan §10 Step 5/7: `e` is the only way into the editor in this phase; `Enter` never opens it.

### `RunningScreen.tsx`

```tsx
<box flexDirection="column">
  <Dashboard />
  <AgentGrid />
  <Footer />
</box>
```

Selector at this level: only `lifecycle.phase` (to know if a "complete" overlay should show — but Phase 09 owns that).

### `SummaryScreen.tsx`

Reads `state.lifecycle`, `state.result`, and the per-agent statuses to compute "approved agents" (those with `status === "complete"` and no `agent.permission` blockers). Renders the card from §11 plus a `<select>` of `["Re-run same input", "New topic", "New document", "Quit"]`.

The `<select>` `onChange` handler is wired to `props.onAction("rerun" | "new-topic" | "new-document" | "quit")`. Phase 09 implements those handlers; for now `App` can stub them as `setScreen("prompt")` so the screen is at least walkable.

### `Footer.tsx`

A single `<text>` line with minimal hints. Keep it truthful: only show controls that actually work in Phase 07. Phase 07.5 redesigns the footer hierarchy; Phase 08 makes it mode-aware.

### `TooSmallBanner.tsx`

```tsx
<box border title="QUORUM" alignItems="center" justifyContent="center">
  <text>terminal too small — please resize to at least 60x20</text>
</box>
```

### `theme.ts` (extend Phase 05's stub)

Add color tokens used above: `panel`, `drafter`, `accent`, `dim`, `tool`, `permission`, `system`.

## Execution Checklist

1. Create `src/tui/state/useStore.ts` exporting `useStoreSelector`.
2. Extend `src/tui/theme.ts` with the color tokens listed above.
3. Create `src/tui/components/Footer.tsx`.
4. Create `src/tui/components/TooSmallBanner.tsx`.
5. Create `src/tui/components/Dashboard.tsx` with `useElapsed` helper inline (or split if it grows).
6. Create `src/tui/components/AgentPanel.tsx`.
7. Create `src/tui/components/AgentGrid.tsx` (uses `useTerminalDimensions` and `quorumConfig`).
8. Create `src/tui/components/RunningScreen.tsx`.
9. Create `src/tui/components/PromptScreen.tsx`.
10. Create `src/tui/components/SummaryScreen.tsx` (action handlers stubbed, not yet wired in Phase 09).
11. Replace `src/tui/App.tsx` with the screen-switching state machine described above; import + load `quorumConfig` once at module top via existing `src/config.ts`.
12. `bunx tsc --noEmit`. Fix.
13. `bun run dev`. Walk through: prompt → topic → run completes → summary appears.
14. Walk through compose-document path: `e` opens editor, save+exit, summary card appears, `Enter` runs.
15. Resize to <100 cols mid-run: confirm single-column fallback. Resize to <60×20: confirm "Terminal too small" banner.
16. Inspect summary screen: outcome, approved agents, output path, trace id all visible. (`<select>` actions are stubs in this phase — clicking "Re-run" simply returns to prompt.)

## Files And Systems Likely Affected

- `src/tui/App.tsx` (rewritten)
- `src/tui/state/useStore.ts` (new)
- `src/tui/theme.ts` (extended)
- `src/tui/components/Dashboard.tsx` (new)
- `src/tui/components/AgentGrid.tsx` (new)
- `src/tui/components/AgentPanel.tsx` (new)
- `src/tui/components/PromptScreen.tsx` (new)
- `src/tui/components/RunningScreen.tsx` (new)
- `src/tui/components/SummaryScreen.tsx` (new)
- `src/tui/components/Footer.tsx` (new)
- `src/tui/components/TooSmallBanner.tsx` (new)

## Verification

- `bunx tsc --noEmit` → exit 0.
- `bun test` → still green (no test changes here, but nothing should regress).
- `bun run dev` → walk-through above completes without an exception in the alt-screen and without leaving the terminal in a bad state on `Ctrl-C` (Phase 08 will improve cancellation, but a hard `Ctrl-C` should at least not corrupt the cursor — opentui's `CliRenderer.destroy()` already handles teardown).
- `grep -n "console\\." src/tui/components/` returns nothing.
- `grep -rn "borderStyle.*double" src/tui/components/AgentPanel.tsx` confirms drafter highlight wiring.
- Visual: take a screenshot or terminal recording of the running grid for the next phase to reference when adding focus borders.

## Done Criteria

- All component files exist and compile.
- A real run drives every panel from `idle` → `running` → `complete` (or `error`), with reasoning, tool, and permission entries showing in the right panels.
- Drafter is visually distinct (double border, brighter color) at default size.
- Single-column fallback and "too small" banner verified by manual resize.
- Summary screen shows the same outcome/path/trace id that the old `src/index.ts:160-175` would have printed (compare against a side log if needed — see plan §13 step 6).

## Handoff To Next Phase

- Next phase: **08 — Vim keymap and focus** (`docs/phases/08-vim-keymap-and-focus.md`).
- What 08 needs from this phase:
  - `App.tsx` exposes a focus state (`focused: "dashboard" | "<roleKey>"`) it can mutate from a global `useKeyboard`. Add a placeholder `focused` state already in this phase (default `"dashboard"`) and pass it through `AgentGrid` → `AgentPanel` so 08 only needs to wire keys, not refactor props.
  - `App.tsx` exposes `runCtx.ac` for `Ctrl-C` cancellation.
  - `SummaryScreen` `onAction` callback is plumbed but stubbed — 08 will add `r/n/f/q` keybindings that drive it.
- Components untouched by 08: `Footer.tsx` (only text changes if any), `Dashboard.tsx`, `TooSmallBanner.tsx`.

## Open Questions Or Blockers

- Does `<scrollbox>` expose an `onScroll` (or scroll position via ref) that lets `AgentPanel` clear the `hasNew` indicator when the user manually scrolls to the bottom? `reference/opentui/packages/react/README.md:407-449` — Unknown until checked. Fallback: leave the indicator until Phase 08 wires `G` to "scroll to bottom and clear `hasNew`".
- Whether `useSyncExternalStore` in opentui's React version requires a polyfill (it is React 18 stable). Inferred — opentui targets a React version that includes it; verify by `grep "react" package.json` after Phase 01.
- Exact tokens to derive `outputDir` for the dashboard. Confirmed via plan §10 Step 6 / §3 — emitted on `RunnerEvent.kind = "lifecycle"` with `outputDir`. If Phase 02 omitted it, retroactively add.

## Sources

- `docs/tui-implementation-plan.md` §10 Step 7, §11 (UI mocks + component map + state ownership + responsive behaviour), §12 (drafter slot for variable N, "too small" mitigation).
- `reference/opentui/packages/react/README.md:165-285` — `useRenderer`, `useTerminalDimensions`, `useOnResize`.
- `reference/opentui/packages/react/README.md:373-405` — `<box>` borders, `borderStyle: "double"`.
- `reference/opentui/packages/react/README.md:407-449` — `<scrollbox>`.
- `reference/opentui/packages/react/README.md:451-505` — `<ascii-font>`.
- `quorum.config.json:1-15` — drafter + auditor names.
- `src/config.ts` — existing config loader (reused by `App` to obtain `quorumConfig`).
