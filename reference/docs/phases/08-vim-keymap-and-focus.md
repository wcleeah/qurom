# Phase 08 — Vim-style keymap, panel focus, help overlay, Ctrl-C cancellation

Source plan: `docs/tui-implementation-plan.md` §10 Step 8, §11 (footer hints), §12 (Ctrl-C mitigation).

## Execution Snapshot

- Phase: 08 / 09
- Source plan: `docs/tui-implementation-plan.md`
- Readiness: **Ready**. Phase 07 shipped the component tree and run wiring; Phase 07.5 stabilized the final drafter-primary layout and removed the old placeholder focus prop.
- Primary deliverable: a complete keyboard layer — global `useKeyboard` at `App` for focus navigation + global commands, per-`AgentPanel` `useKeyboard` (gated on `focused`) for scroll commands, a `?` help overlay, mid-run `Ctrl-C` cancellation via `AbortController`, and `r/n/f/q` on `SummaryScreen`.
- Blocking dependencies: Phase 07 and Phase 07.5.
- Target measurements: every binding from §10 Step 8 + §11 footer works; `j`/`k` ambiguity is resolved by which element holds focus; `Esc` releases panel focus; `Ctrl-C` mid-run aborts cleanly within 1–2 s; `?` overlay toggles.
- Next phase: 09 — Re-run flow.

## Why This Phase Exists

The TUI is walkable after Phase 07 but not usable without keys: no panel focus, no scroll, no cancellation, no way to drive the summary actions. Phase 07.5 then stabilizes the final screen hierarchy. This phase installs the keyboard contract against that final layout so the bindings stay coherent — in particular, the `j`/`k` "focus vs scroll" ambiguity is resolved deterministically (panel captures `j/k` only while focused; `Esc` releases). It also closes the orphan-process risk on `Ctrl-C` mid-run.

## Start Criteria

- Phase 07 done: all components mount, real runs drive the TUI, and `App.tsx` already owns run lifecycle plus `SummaryScreen` action routing.
- Phase 07.5 done: the running screen hierarchy is stable (drafter-primary split view on wide terminals, vertical fallback on narrow terminals).
- `App.tsx` already passes an `AbortController.signal` into `runQuorum` (Phase 07 added this).
- `SummaryScreen` already accepts an `onAction(action)` callback (Phase 07 added this stub).
- Controlled shutdown already exists via `onExit` from `src/tui/index.tsx`; Phase 08 should route every quit path through it rather than calling `process.exit(...)` directly.

## Dependencies And How To Check Them

| Dependency | Why | How to verify | Status |
|---|---|---|---|
| `App.tsx` run lifecycle + `onExit` callback | Global key routing and clean cancellation/quit | `grep -n "onExit\|AbortController" src/tui/App.tsx src/tui/index.tsx` | Done |
| `runCtx.ac` (`AbortController`) reachable from `App` | `Ctrl-C` handler aborts | `grep -n "AbortController" src/tui/App.tsx` | Done after Phase 07 |
| `SummaryScreen.onAction` stub | `r/n/f/q` route through it | `grep -n "onAction" src/tui/components/SummaryScreen.tsx` | Done after Phase 07 |
| `useKeyboard` from opentui/react | All bindings | `reference/opentui/packages/react/README.md:184-240` | Confirmed |
| `<scrollbox>` underlying scroll API | `gg`, `G`, `Ctrl-d/u/f/b` | `reference/opentui/packages/core/src/renderables/ScrollBox.ts` + tests | Confirmed (`scrollTop` + `scrollBy`) |

## Target Measurements And Gates

Entry gate: `bun run dev` from Phase 07.5 boots and a topic run completes.

Exit gates (manual unless noted):

- `h/l` move focus across the final running-screen regions in reading order; `j/k` move between stacked regions when no pane is focused; `Tab`/`Shift+Tab` cycle as fallback.
- Focusing a panel highlights its border (e.g. brighter `borderColor` from `theme.ts`); `Esc` returns focus to dashboard.
- While a panel is focused: `j`/`k` scroll one line, `Ctrl-d`/`Ctrl-u` half-page, `Ctrl-f`/`Ctrl-b` full page, `gg` (within 500 ms) top, `G` bottom (and clears the "v new" indicator from Phase 07).
- `?` toggles a centered help overlay listing every binding.
- `Ctrl-C` mid-run: `App` calls `ac.abort()`, awaits the in-flight `runQuorum` promise, then routes through `onExit()` so `root.unmount()` and `renderer.destroy()` restore the terminal cleanly within 1–2 s. No orphan opencode session warning in the next shell.
- On `RunningScreen`: `q` is ignored (footer hints "use Q to force quit"); `Q` (shift-Q) opens a small confirmation `<box>` with `y/n`; `y` quits.
- On `PromptScreen` and `SummaryScreen`: `q` quits immediately. On `SummaryScreen`: `r/n/f` invoke `onAction("rerun" | "new-topic" | "new-document")`.
- Inside `<input>` (topic mode): `i` and `Enter` enter insert; `Esc` leaves; `Enter` inside the input submits — no global key intercepts fire while the input is focused.
- `bunx tsc --noEmit` exit 0.

## Scope

- New `src/tui/keymap/` module:
  - `useGlobalKeymap.ts` — global `useKeyboard` mounted once in `App`. Routes by current `screen` and `focused` state.
  - `usePanelKeymap.ts` — per-`AgentPanel` hook; only fires when `focused === roleKey`.
  - `gridNav.ts` — pure helpers `nextFocus(current, dir, layout)` for `h/j/k/l/Tab/Shift+Tab` over the final focus graph.
- New `src/tui/components/HelpOverlay.tsx` (mounted from `App`, position absolute centered when `showHelp`).
- New `src/tui/components/QuitConfirm.tsx` (mounted from `App` when `pendingForceQuit`).
- Edits to:
  - `src/tui/App.tsx` — wire `useGlobalKeymap`, manage `focused`, `showHelp`, `pendingForceQuit`, and store the active run promise for cancellation.
  - `src/tui/components/AgentPanel.tsx` — wire `usePanelKeymap` on a ref, surface a `focused` border style.
  - `src/tui/components/SummaryScreen.tsx` — add `useKeyboard` for `r/n/f/q`.
  - `src/tui/components/Footer.tsx` — surface mode-aware hint (different text on running vs prompt vs summary, and during a `g` partial sequence).

## Out Of Scope

- Re-run flow logic (`r` action wiring inside `App`): Phase 09. This phase only fires the `onAction("rerun")` callback — `App` may continue to reuse `lastRequestRef` directly until Phase 09 replaces it with the full re-run flow.
- Per-panel `<input>` editing inside the prompt screen — already shipped in Phase 07.
- Cancellation UX polish beyond "abort + exit": the run's `finally` already tears down subscribers (Phase 03).

## Implementation Details

### Layout-aware focus

`gridNav.ts` works over the final running-screen focus graph instead of the provisional 2x2 grid. On wide terminals after Phase 07.5 the natural reading order is:

```
[ dashboard ]
[ drafter pane | source-auditor ]
[               logic-auditor   ]
[               clarity-auditor ]
```

`nextFocus("dashboard", "j")` → `"drafter"`. `nextFocus("drafter", "l")` → `"source-auditor"`. `nextFocus("source-auditor", "j")` → `"logic-auditor"`. `nextFocus("clarity-auditor", "h")` → `"drafter"`. `Tab` cycles in reading order. Single-column layout (Phase 07.5 fallback) collapses to a vertical list and `h/l` become no-ops.

The layout descriptor is shared between the final running-screen layout and `gridNav` via a small `computeLayout(width, slotOrder)` helper (place in `src/tui/state/layout.ts` so both phases agree). Height is not needed for focus order; only the wide-vs-stacked breakpoint matters.

### `useGlobalKeymap`

Mounted once at the top of `App.tsx`. Reads `screen`, `focused`, `pendingForceQuit`, `showHelp`, plus refs to `runCtx.ac`, `runCtx.promise`, and the `gPending` timeout id.

Pseudocode:

```ts
useKeyboard((ev) => {
  if (showHelp && ev.name === "?") return setShowHelp(false)
  if (showHelp) return // swallow other keys while help is open

  if (screen === "prompt") {
    if (ev.name === "q") return onExit()
    return // PromptScreen owns the rest
  }

  if (screen === "running") {
    if (ev.ctrl && ev.name === "c") return cancelRun()
    if (ev.name === "?") return setShowHelp(true)
    if (ev.name === "q") return // ignored on running
    if (ev.shift && ev.name === "q") return setPendingForceQuit(true)

    if (focused === "dashboard") {
      // h/j/k/l move focus into the running-screen regions
      const next = nextFocus(focused, ev.name, layout)
      if (next) return setFocused(next)
    } else {
      // panel-focused: only Esc, Tab, Shift+Tab handled here; j/k/Ctrl-d/etc handled by usePanelKeymap on the focused panel
      if (ev.name === "escape") return setFocused("dashboard")
      if (ev.name === "tab") return setFocused(nextFocus(focused, ev.shift ? "shift-tab" : "tab", layout))
      // h/l move focus across panels even while one is focused (vim convention: h/l never scroll)
      if (ev.name === "h" || ev.name === "l") {
        const next = nextFocus(focused, ev.name, layout)
        if (next) return setFocused(next)
      }
    }
    return
  }

  if (screen === "summary") {
    if (ev.name === "q") return onExit()
    if (ev.name === "r") return summaryAction("rerun")
    if (ev.name === "n") return summaryAction("new-topic")
    if (ev.name === "f") return summaryAction("new-document")
  }
})
```

`pendingForceQuit` rendering: `App` mounts `<QuitConfirm onYes={onExit} onNo={() => setPendingForceQuit(false)} />` which itself uses `useKeyboard` to capture `y` / `n`.

### `usePanelKeymap`

Mounted inside `AgentPanel.tsx`. The hook receives a scroll adapter around the `<scrollbox>` instance and the `focused` flag.

```ts
function usePanelKeymap({ focused, scrollRef }: { focused: boolean; scrollRef: ScrollAdapter }) {
  const gPendingRef = useRef<NodeJS.Timeout | undefined>(undefined)
  useKeyboard((ev) => {
    if (!focused) return
    if (ev.name === "j") return scrollRef.current?.scrollBy(1)
    if (ev.name === "k") return scrollRef.current?.scrollBy(-1)
    if (ev.ctrl && ev.name === "d") return scrollRef.current?.scrollViewport(0.5)
    if (ev.ctrl && ev.name === "u") return scrollRef.current?.scrollViewport(-0.5)
    if (ev.ctrl && ev.name === "f") return scrollRef.current?.scrollContent(1)
    if (ev.ctrl && ev.name === "b") return scrollRef.current?.scrollContent(-1)
    if (ev.shift && ev.name === "g") {
      scrollRef.current?.scrollToBottom()
      return
    }
    if (ev.name === "g") {
      if (gPendingRef.current) {
        clearTimeout(gPendingRef.current)
        gPendingRef.current = undefined
        return scrollRef.current?.scrollToTop()
      }
      gPendingRef.current = setTimeout(() => { gPendingRef.current = undefined }, 500)
    }
  })
}
```

OpenTUI's React README does not document a rich scrollbox ref API. The underlying core `ScrollBox` exposes `scrollTop` and `scrollBy(delta, unit?)`, so Phase 08 should wrap that in a tiny adapter inside `AgentPanel.tsx` instead of assuming helper methods already exist.

### `Ctrl-C` cancellation

`cancelRun()` in `App.tsx`:

```ts
async function cancelRun() {
  if (!runCtx) return onExit()
  runCtx.ac.abort()
  // The runQuorum promise's .finally already calls unbind(); we just wait for it.
  try { await runCtx.promise } catch {}
  onExit()
}
```

`runCtx` should also carry the `runQuorum` promise itself. Current code stores `bus + store + unbind + ac`; extend it here to also store the active promise.

### Footer hints

`Footer.tsx` reads `screen` + a `mode` prop (e.g. `"normal" | "panel-focused" | "g-pending"`) and renders a one-line hint matching the active key set. Keep the longest hint under ~110 chars so it fits in the standard width.

### `<input>` interaction

opentui's `<input>` already captures keys when focused. Verify that `useKeyboard` at `App` does **not** fire while `<input>` is focused (per `reference/opentui/packages/react/README.md:184-240` — Inferred). If it does, gate the global handler on a `isInputFocused` flag exposed by `PromptScreen` via a small context.

## Execution Checklist

1. Add `src/tui/state/layout.ts` exporting `computeLayout(width, slotOrder)` shared by the final running-screen layout and `gridNav`.
2. Add `src/tui/keymap/gridNav.ts` with `nextFocus` + a unit test under `src/tui/keymap/gridNav.test.ts` covering wide split-view and single-column fallback layouts and `h/j/k/l/Tab/Shift+Tab`.
3. Add `src/tui/keymap/usePanelKeymap.ts`.
4. Add `src/tui/keymap/useGlobalKeymap.ts` (or inline the hook in `App.tsx` if it stays small).
5. Add `src/tui/components/HelpOverlay.tsx` listing every binding from §10 Step 8.
6. Add `src/tui/components/QuitConfirm.tsx`.
7. Wire `usePanelKeymap` inside `src/tui/components/AgentPanel.tsx`; add `focused` border highlight (e.g. `borderColor={focused ? theme.accent : isDrafter ? theme.drafter : theme.panel}`).
8. Wire `r/n/f/q` `useKeyboard` inside `src/tui/components/SummaryScreen.tsx` so it can react even before `App`'s global handler dispatches (defense in depth).
9. Edit `src/tui/App.tsx`:
   - mount `useGlobalKeymap`,
   - manage `focused`, `showHelp`, `pendingForceQuit` state,
   - extend `runCtx` with the `runQuorum` promise,
   - render `<HelpOverlay/>` and `<QuitConfirm/>` as conditional siblings.
10. Update `src/tui/components/Footer.tsx` to switch hints by `screen` + `mode`.
11. `bunx tsc --noEmit`. Fix.
12. `bun test src/tui/keymap/`. All tests green.
13. Manual walk-through (plan §13 step 4 + step 5):
    - `l/j/k/h` cycle focus through the final running-screen regions in the order defined above.
    - Focus a panel; `j/k/Ctrl-d/Ctrl-u/gg/G` scroll; `Esc` releases.
    - `?` toggles help overlay; help dismisses on `?`.
    - `Ctrl-C` mid-run exits within 1–2 s with no warnings.
    - On `RunningScreen`: `q` is silently ignored; `Q` shows confirm; `y` quits.
    - On `SummaryScreen`: `r` triggers `onAction("rerun")` (still a stub — verify the callback fires by, e.g., a log to the system buffer).

## Files And Systems Likely Affected

- `src/tui/App.tsx` (extended)
- `src/tui/components/AgentPanel.tsx` (extended)
- `src/tui/components/SummaryScreen.tsx` (extended)
- `src/tui/components/Footer.tsx` (extended)
- `src/tui/components/HelpOverlay.tsx` (new)
- `src/tui/components/QuitConfirm.tsx` (new)
- `src/tui/keymap/gridNav.ts` (new)
- `src/tui/keymap/gridNav.test.ts` (new)
- `src/tui/keymap/useGlobalKeymap.ts` (new)
- `src/tui/keymap/usePanelKeymap.ts` (new)
- `src/tui/state/layout.ts` (new; shared by the final running-screen layout and keymap helpers)

## Verification

- `bunx tsc --noEmit` → exit 0.
- `bun test src/tui/keymap/` → all `gridNav` cases pass.
- `bun test` → previous suites still green.
- Manual checklist above.
- Quick check: `grep -n "process.exit" src/tui/` shows only `src/tui/index.tsx` (inside the controlled shutdown helper) — no stray `process.exit` from inside hooks/components.
- `grep -rn "useKeyboard" src/tui/` lists exactly: one `App.tsx` global mount, one per-panel mount, `SummaryScreen.tsx`, `HelpOverlay.tsx`, `QuitConfirm.tsx`. Plus `<input>` and `<select>` internal usage from opentui.

## Done Criteria

- Every binding from plan §10 Step 8 works as described.
- `Ctrl-C` mid-run cancels cleanly with no orphan opencode warnings.
- `?` help overlay lists every binding currently active.
- `j/k` ambiguity is deterministically resolved by panel focus, with `Esc` as the documented release.
- Footer hints reflect the current screen + mode (and the `g`-pending state surfaces as a subtle hint such as `…g`).
- `gridNav` has unit coverage proving the navigation rules for the final split layout; visual confirmation matches.

## Handoff To Next Phase

- Next phase: **09 — Re-run flow** (`docs/phases/09-rerun-flow.md`).
- What 09 needs from this phase:
  - `SummaryScreen.onAction(action)` is wired and reaches `App`.
  - `App` already retains `lastRequest` (Phase 07).
  - `Ctrl-C` and `Q` already terminate cleanly so re-run does not have to worry about leaking subscribers from a previous run.
- 09 will replace the stub action handlers in `App` (`setScreen("prompt")`) with real flows: `rerun` re-invokes `runQuorum` (re-reading `runs/.drafts/<requestId>.md` for document mode), `new-topic` returns to topic prompt, `new-document` returns to compose mode and immediately invokes `openInEditor` with a fresh requestId.

## Open Questions Or Blockers

- Exact React-side `<scrollbox>` ref plumbing: the core `ScrollBox` supports `scrollTop` + `scrollBy(delta, unit?)`, but the React wrapper does not document a ref helper API. Phase 08 should confirm the instance/ref shape during implementation and keep the adapter logic local to `AgentPanel.tsx`.
- Whether opentui's `useKeyboard` is suppressed while a child `<input>` is focused: Inferred from typical alt-screen UI conventions. If not, add an `isInputFocused` context exposed by `PromptScreen` and `SummaryScreen` and gate the global handler on it.
- `Ctrl-C` delivery via `useKeyboard` vs Node's `SIGINT`: opentui's `CliRenderer` typically intercepts raw mode and surfaces it as a `key` event. If it instead lets `SIGINT` through to Node, attach a `process.on("SIGINT", cancelRun)` in `App`'s mount effect and remove the `useKeyboard` `Ctrl-C` branch. Confirm during execution.
- The "vim insert-mode entry" (`i` in topic mode) was already specified in plan §10 Step 8. Phase 07 wired `Enter` and `Esc` for the input but not `i`. Add `i` here as a small extension to `PromptScreen` (treat `i` as "focus the input").

## Sources

- `docs/tui-implementation-plan.md` §10 Step 8 (focus + scroll + global keys), §11 (footer hints), §12 (Ctrl-C mitigation, `j/k` ambiguity mitigation).
- `reference/opentui/packages/react/README.md:184-240` — `useKeyboard` shape.
- `reference/opentui/packages/react/README.md:407-449` — `<scrollbox>` (ref API to confirm).
- `reference/opentui/packages/react/README.md:243-285` — `useTerminalDimensions` (consumed by `computeLayout`).
- `reference/opentui/packages/core/src/renderer.ts:2107-2165` — `CliRenderer.suspend/resume` (referenced by Phase 05; relevant here only because cancellation must not leave the renderer suspended).
