# Reader Discovery — Phase Execution Briefs

Execution packaging of the implementation plan: **Reader Discovery** (`README.md`, this directory).

## Phase-to-file mapping

| File | Phase | Title |
|---|---|---|
| `01-discover-reader-node-and-view-chat.md` | Phase 1 | `discoverReader` interrupt-loop node + view-server chat + drafter-only profile injection |
| `02-thread-profile-to-auditors-rebuttals.md` | Phase 2 | Thread `readerContextBlock` to auditors, rebuttals, and drafter-review |
| `03-surface-profile-in-view-tui.md` | Phase 3 | Reader-profile card, live pipeline row, node summary, TUI badge |
| `04-adaptive-interview-upgrades.md` | Phase 4 (optional) | Per-concept drill-down, reader-asks-back branch, dynamic turn budget |

## Phase order = dependency order

Phase 1 is the minimum that proves the feature (interview runs → `reader-profile.json` written → drafter includes calibrated Prerequisites). Phase 2 is where the feature starts improving audit signal instead of fighting it. Phase 3 is surfacing and can run in parallel with Phase 2 (see Phase 3's brief). Phase 4 is optional and only if Phase 1–2 data shows the fixed-cap interview is too thin or too long.

## Rollout ladder

```
submit → discoverReader (interrupt loop, view-server chat) → draftFullDraft (profile-aware) → auditors (profile-aware, Phase 2) → rebuttals (profile-aware, Phase 2) → final document
```

## Verification anchor

The manual end-to-end check (Phase 1 exit gate): run `bun run dev`, type "What is MLX?", answer the interview in the view dashboard, confirm (a) `runs/<rid>/reader-profile.json` exists with on-domain concepts at `unknown`/`heard-of`, (b) the first draft includes a Prerequisites section naming those concepts, (c) `readerDiscovery.enabled: false` short-circuits to a default profile and the draft looks like today's phantom-reader output. Repeat with a pasted document (document mode).
