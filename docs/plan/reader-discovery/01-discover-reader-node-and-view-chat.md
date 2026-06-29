# Phase 1 — `discoverReader` interrupt-loop node + view-server chat + drafter-only profile injection

## Execution Snapshot

- **Phase:** 1
- **Source plan:** `docs/plan/reader-discovery/README.md` (Phase 1 section, Decisions A2/B1/C/D2, "How the interviewer outputs questions", "Where the chat lives", "The interviewer's JSON output goes through the recovery router")
- **Readiness status:** `Ready` — all entry conditions confirmed against the repo (see Dependencies). One SDK detail to nail in the first commit (`Command({ resume })` shape) is flagged in Open Questions, not a blocker.
- **Primary deliverable:** A new `discoverReader` graph node between `prepareOutputPath` and `draftFullDraft` that runs a multi-turn interview via LangGraph `interrupt`, with the chat UI hosted in the view-server (file-mediated handshake via `live-status.json` + `reader-reply.json`). The interviewer is a `reader-interviewer` subagent that writes `reader-profile.json` (auditor pattern) and its parsed profile is injected into `fullDraftPrompt` only.
- **Blocking dependencies:** none (this is the first phase). The just-removed `classifyComplexity` slot (`prepareOutputPath → ? → draftFullDraft`) is vacant and ready.
- **Target measurements summary:** (1) topic-mode AND document-mode runs each produce `reader-profile.json` + a draft with a Prerequisites section naming `unknown`/`heard-of` concepts; (2) `readerDiscovery.enabled: false` short-circuits to a default profile and the draft looks like today; (3) `bunx tsc --noEmit` clean + `bun test` green.
- **Next phase:** `02-thread-profile-to-auditors-rebuttals.md` (Phase 2).

## Why This Phase Exists

Today every run produces one document for one phantom "competent practitioner" reader. The prompt-contract functions (`fullDraftPrompt`, `auditPrompt`, …) build prompts from `state.topic`/`state.documentText` plus static assets — nothing about who is asking. This phase introduces the missing *input*: a per-concept `readerProfile` + a `learningGoal`, collected via a multi-turn interview, and injects it into the drafter only. Phase 1 proves the core value (drafts now include calibrated Prerequisites) without yet touching the auditors (that's Phase 2, where the quorum stops fighting the calibration).

## Start Criteria

- The `prepareOutputPath → draftFullDraft` direct edge exists and is the insertion point. **Confirmed** — `src/graph.ts` edge chain: `.addEdge("prepareOutputPath", "draftFullDraft")`.
- LangGraph `interrupt` and `Command` are importable from `@langchain/langgraph`. **Confirmed** — v1.2.9, `node_modules/@langchain/langgraph/dist/index.d.ts` exports both.
- The checkpoint saver persists graph state across suspends. **Confirmed** — `src/checkpointer.ts:35` `BunSqliteSaver extends BaseCheckpointSaver`; used by `createGraph`.
- The runner already has a checkpoint-resume pattern to extend. **Confirmed** — `src/runner.ts:763` design-resume does `graph.invoke(null, { configurable: { thread_id, checkpoint_id } })`.
- The view-server polls `live-status.json` and is the chat host. **Confirmed** — `src/view-server.ts:193` `readLiveStatus`, `:2555` "Background poll handles refresh".
- `researchToolBlock(config)` exists and is reusable. **Confirmed** — `src/graph.ts:108`.
- The auditor JSON-output pattern (`outputFile` + scoped `edit` + file-first read) is the template. **Confirmed** — `src/graph.ts:668-675`, `.opencode/agents/source-auditor.md`, `src/opencode.ts:556`.

## Dependencies And How To Check Them

| Dependency | Why it matters | How to verify | Status |
|---|---|---|---|
| `promptAgent` accepts `schema` + `outputFile` and reads the file file-first | The interviewer reuses this exact path; the recovery router runs inside it | `grep -n "schema?:\|outputFile?:" src/opencode.ts` returns both params; `src/opencode.ts:556` `readOutputFile()` | `Done` |
| `BunSqliteSaver` wired into `createGraph` | `interrupt` suspends persist via the saver | `grep -n "BunSqliteSaver\|checkpointer" src/graph.ts src/checkpointer.ts` | `Done` |
| `interrupt`/`Command` exported by the installed langgraph | The node suspends with `interrupt`, the runner resumes with `Command({ resume })` | `grep -oE "\binterrupt\b\|\bCommand\b" node_modules/@langchain/langgraph/dist/index.d.ts \| head` returns hits; version `1.2.9` | `Done` |
| `liveStatusWriter` serializes the whole `LiveStatus` to `live-status.json` | The `awaitingReaderReply` field rides this channel | `src/live-status.ts:85` `writeFile(join(dir, "live-status.json"), JSON.stringify(status))` | `Done` |
| View-server fetch handler is the place to add the `POST /runs/:name/reply` route | The chat form submits here | `src/view-server.ts:2702` `async fetch(req)`; currently all `GET` | `Done` |
| `researchTools` config field exists | `researchToolBlock(config)` reads it for the interviewer prompt | `grep -n "researchTools" src/config.ts quorum.config.json` returns `prefer: ["context7","exa","grepapp"]` | `Done` |
| Auditor agent def shape (template for `reader-interviewer.md`) | The interviewer mirrors its permission pattern + adds research-tool allows | `cat .opencode/agents/source-auditor.md` | `Done` |
| OpenCode subagent carries multi-turn state across `prompt` calls in one session | Lets the interviewer reference prior answers within a session | Not verified at the SDK level — but the node re-sends the full `interviewTranscript` each turn, so the interviewer is stateless across calls. The `interrupt` path does not depend on this. | `Inferred` (non-blocking — see Open Questions) |

## Target Measurements And Gates

| Measurement | Threshold | Method | Gate | Status |
|---|---|---|---|---|
| Topic-mode run produces calibrated draft | `reader-profile.json` exists with on-domain concepts at `unknown`/`heard-of`; first draft includes a Prerequisites section naming those concepts | Manual: `bun run dev`, type "What is MLX?", answer the interview in the view dashboard, inspect `runs/<rid>/reader-profile.json` + the draft | Exit | `Unknown` |
| Document-mode run produces calibrated draft | Same as above with a pasted document | Manual: paste a technical document, answer the interview, inspect artifacts | Exit | `Unknown` |
| Kill-switch works | `readerDiscovery.enabled: false` → `discoverReader` short-circuits to a default (empty) profile; draft looks like today's phantom-reader output; no interview card in the view-server | Set the flag in `quorum.config.json`, run a topic, confirm no `awaitingReaderReply` in `live-status.json` and no interview card | Exit | `Unknown` |
| Type-check clean | `bunx tsc --noEmit` exit 0 | Run the command | Exit | `Unknown` |
| Test suite green | `bun test` 0 fail | Run the command | Exit | `Unknown` |
| Interrupt/resume round-trips a value | A scripted `interrupt` + `Command({ resume })` returns the resume value to the node | Unit test in `tests/reader-discovery.test.ts` (stubbed OpenCode client, scripted replies) | Exit | `Unknown` |

## Scope

- New `discoverReader` graph node implementing the LangGraph `interrupt` loop (Decisions A2/D2, per-turn schema from the plan).
- New `reader-interviewer` agent def + `assets/prompts/reader-interview.md` prompt asset.
- New `readerInterviewTurnSchema` + `readerProfileSchema` + `learningGoalSchema` + `interviewTranscriptSchema` in `src/schema.ts`; new optional `ResearchState` fields `readerProfile`, `learningGoal`, `interviewTranscript`.
- New `readerContextBlock(state)` function; inject it into `fullDraftPrompt` **only** (Phase 2 does the auditors/rebuttals).
- Runner: detect `GraphInterrupt`, write `awaitingReaderReply` to `live-status.json`, watch for `reader-reply.json`, resume with `Command({ resume })`.
- `src/live-status.ts`: extend `LiveStatus` with `awaitingReaderReply?: { turn, questions, transcript }`.
- View-server: render the interview chat card when `awaitingReaderReply` is present; add `POST /runs/:name/reply` route that writes `reader-reply.json`.
- TUI: a one-line interview-status pointer on the running screen (reusing `viewUrl`). **No new TUI screen, no `InterviewScreen` component.**
- Config: `readerDiscovery: { maxTurns: 6, enabled: true }` in `src/config.ts` + `quorum.config.json`; wire the kill-switch in the node.
- New `tests/reader-discovery.test.ts` with a stubbed OpenCode client (reuse the `tests/json-repair.test.ts:45` harness pattern).

## Out Of Scope

- Injecting `readerContextBlock` into `auditPrompt`, `rebuttalPrompt`, `rebuttalReviewPrompt`, `drafterReviewPrompt` — **Phase 2**.
- The view-server Reader-profile card, live pipeline row, `summarizeNodeState` case, and TUI badge repurposing — **Phase 3** (the interview *chat* card is in Phase 1; the *profile* card is Phase 3).
- Design-phase profile injection — out of scope for v1 (the profile's job is done before the markdown is written).
- Adaptive upgrades (per-concept drill-down, reader-asks-back) — **Phase 4 (optional)**.
- A TUI chat surface. The chat lives in the view-server; do not build TUI chat.

## Implementation Details

### The `discoverReader` node (`src/graph.ts`)

Loop, one `promptAgent` call per turn, all with `outputFile: ${state.outputPath}/reader-profile.json`:

1. Build the interviewer prompt: `researchToolBlock(config)` + `requestContextBlock(state)` + `state.interviewTranscript` (joined) + `promptBundle.assets.readerInterview`. The prompt instructs: ask one question per turn by default, batch only independent questions, set `done: true` only when the profile is complete, write JSON to the output file per the schema.
2. `const turn = await promptAgent({ config, sessionID, agent: "reader-interviewer", prompt, schema: readerInterviewTurnSchema, outputFile: ${state.outputPath}/reader-profile.json, telemetry: graphAgentTelemetry({...}) })`. The agent writes `reader-profile.json`; `promptAgent` reads it back file-first. Recovery router (D/A/B/C) runs inside `promptAgent` — no special handling.
3. If `!turn.structured.done`: `const reply = interrupt(turn.structured.questions)` (graph suspends, checkpoint persists). On resume, append `{ role: "interviewer", text: turn.structured.questions.join("\n") }` and `{ role: "reader", text: reply }` to `state.interviewTranscript`. Loop.
4. If `turn.structured.done`: set `state.readerProfile`/`state.learningGoal` from `turn.structured.profile`. The file is already written by the agent — **no `writeRunJsonArtifact` call**. Return.

Kill-switch: at node entry, if `!config.quorumConfig.readerDiscovery?.enabled`, return `researchStateSchema.parse({ ...state })` with default (empty) profile fields. Turn cap: loop counter, break at `config.quorumConfig.readerDiscovery.maxTurns` (default 6) even if `done` is false — write whatever partial profile the last turn returned, or an empty profile if none.

Runs for both `inputMode === "topic"` and `"document"` — `requestContextBlock(state)` already branches on mode.

### The interviewer agent (`.opencode/agents/reader-interviewer.md`)

Mirror `.opencode/agents/source-auditor.md`'s permission block: `read: "runs/**": allow` + `edit: "runs/**/reader-profile.json": allow` + `websearch: allow` + `codesearch: allow` + `webfetch: allow`; deny bash/task/skill/todowrite/question/glob/grep/list. Model: a capable model (the interviewer's probing quality is the feature's core — `opencode-go/glm-5.2` or similar; **not** the cheapest model).

### The runner interrupt handler (`src/runner.ts`)

After `graph.invoke` (`:436`) resolves, inspect the result for a `GraphInterrupt`-shaped value (LangGraph surfaces interrupts in the result/task data). When detected:
- Extract the interrupt value (the `questions` array).
- Write `awaitingReaderReply: { turn, questions, transcript: <current interviewTranscript from state> }` to `live-status.json` via the existing `liveStatusWriter`.
- Watch `state.outputPath` for `reader-reply.json` (a small `fs.watch` or short poll loop). When it appears, read the reply text, delete the file, clear `awaitingReaderReply` from `live-status.json`.
- Resume: `graph.invoke(new Command({ resume: replyText }), { configurable: { thread_id, checkpoint_id }, recursionLimit, signal })`. This extends the existing design-resume pattern at `:763` with a resume value.

### The view-server chat card (`src/view-server.ts`)

- Extend the `LiveStatus` interface (`:62`) with `awaitingReaderReply?: { turn: number; questions: string[]; transcript: { role: string; text: string }[] }`.
- In `renderRun`, when `liveStatus.awaitingReaderReply` is present, render a chat card: transcript (from `awaitingReaderReply.transcript`) + a `<form method="POST" action="/runs/<name>/reply">` with a `<textarea name="reply">` and submit button. No skip button (Decision C).
- Add the first non-`GET` route to the fetch handler (`:2702`): `if (req.method === "POST" && path.match(/^\/runs\/(.+?)\/reply$/))` — read `await req.text()`, write it to `${safeRunPath(name)}/reader-reply.json`, return a small ack HTML (or redirect back to the run page). Validate the run name via `safeRunPath`.

### The TUI pointer (`src/tui/components/Dashboard.tsx`)

No new screen. During the interview (detected via a `graph.node` state carrying `awaitingReaderReply`, or a new field on the bus event the runner emits), render one line: `🎙 Interviewing reader — answer in the view dashboard: {viewUrl}`. Reuses the existing `viewUrl` prop (`Dashboard.tsx:121`).

### Recovery router interaction

`promptAgent` runs D→A/B/C on the interviewer's JSON automatically. The A-branch `nooutput && wantFile` reprompt (`src/opencode.ts:686`) says "Write the complete JSON object to `{outputFile}` now" — exactly right for the interviewer. The C-branch json-fixer rewrites `reader-profile.json`. On `StructuredRecoveryError`, let it propagate (do not catch and retry the interview from scratch — that discards the transcript); the run fails, consistent with Decision C. The R-tier (`auditWithRestart`) does **not** wrap the interviewer — it is auditor-only by design.

## Execution Checklist

- [ ] `src/schema.ts`: add `readerProfileSchema`, `learningGoalSchema`, `interviewTranscriptSchema`, `readerInterviewTurnSchema` (`{ questions: z.array(z.string()).min(1), done: z.boolean(), profile: ... .optional() }`); add `readerProfile`, `learningGoal`, `interviewTranscript` as optional fields on `researchStateSchema`.
- [ ] `.opencode/agents/reader-interviewer.md`: create the agent (auditor permission pattern + research-tool allows + capable model).
- [ ] `assets/prompts/reader-interview.md`: create the interviewer system prompt (one question default, batch independent only, `done: true` when complete, write JSON to the file).
- [ ] `src/prompt-assets.ts`: register `readerInterview` in `promptAssetFiles`.
- [ ] `src/config.ts` + `quorum.config.json`: add `readerDiscovery: { maxTurns: z.number().int().positive().default(6), enabled: z.boolean().default(true) }`.
- [ ] `src/graph.ts`: add `readerContextBlock(state)`; add `discoverReader` node (interrupt loop, kill-switch, turn cap); add `import { interrupt } from "@langchain/langgraph"`; replace `.addEdge("prepareOutputPath", "draftFullDraft")` with `.addNode("discoverReader", ...)` + `.addEdge("prepareOutputPath", "discoverReader")` + `.addEdge("discoverReader", "draftFullDraft")`; inject `readerContextBlock` into `fullDraftPrompt` only.
- [ ] `src/live-status.ts`: extend `LiveStatus` with `awaitingReaderReply?`; ensure the writer serializes it.
- [ ] `src/runner.ts`: after `graph.invoke`, detect `GraphInterrupt`; write `awaitingReaderReply` to `live-status.json`; watch for `reader-reply.json`; resume with `new Command({ resume })`.
- [ ] `src/view-server.ts`: extend `LiveStatus` interface; render the chat card in `renderRun` when `awaitingReaderReply` present; add `POST /runs/:name/reply` route that writes `reader-reply.json`.
- [ ] `src/tui/components/Dashboard.tsx`: add the one-line interview-status pointer.
- [ ] `tests/reader-discovery.test.ts`: stub the OpenCode client (reuse `tests/json-repair.test.ts:45` pattern); script interviewer turns (`{ questions, done: false }` × 3, then `{ done: true, profile }`) + 3 scripted replies; assert (a) `reader-profile.json` written with expected concepts/levels and **no `confidence` field**, (b) `state.readerProfile`/`learningGoal` set, (c) `fullDraftPrompt` output includes prereq concepts at `unknown`/`heard-of` and excludes `familiar`, (d) `interviewTranscript` has all turns. Add a topic-mode and a document-mode case. Add a kill-switch test (`enabled: false` → default profile, no interview).
- [ ] `bunx tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] Manual: run `bun run dev`, type "What is MLX?", answer the interview in the view dashboard, confirm `runs/<rid>/reader-profile.json` + calibrated draft. Repeat with a pasted document. Repeat with `readerDiscovery.enabled: false`.

## Files And Systems Likely Affected

- `src/schema.ts` — new schemas + `ResearchState` fields.
- `src/graph.ts` — `discoverReader` node, `readerContextBlock`, `fullDraftPrompt` injection, edge change, `interrupt` import.
- `src/config.ts` + `quorum.config.json` — `readerDiscovery` config.
- `src/prompt-assets.ts` — register `readerInterview`.
- `src/runner.ts` — `GraphInterrupt` detection, `live-status.json` write, `reader-reply.json` watch, `Command({ resume })` resume.
- `src/live-status.ts` — `awaitingReaderReply` on `LiveStatus`.
- `src/view-server.ts` — chat card render + `POST /runs/:name/reply` route.
- `src/tui/components/Dashboard.tsx` — interview-status pointer.
- `.opencode/agents/reader-interviewer.md` — new agent.
- `assets/prompts/reader-interview.md` — new prompt.
- `tests/reader-discovery.test.ts` — new test file.
- Run artifacts: `reader-profile.json`, `reader-reply.json` (transient), `live-status.json` (new field).

## Verification

- `bunx tsc --noEmit` → exit 0.
- `bun test` → 0 fail (incl. new `tests/reader-discovery.test.ts`).
- Manual topic-mode: `bun run dev` → "What is MLX?" → answer interview in view dashboard → `runs/<rid>/reader-profile.json` exists with on-domain concepts at `unknown`/`heard-of`; draft includes a Prerequisites section naming those concepts.
- Manual document-mode: paste a technical document → answer interview → same checks.
- Manual kill-switch: `readerDiscovery.enabled: false` → run proceeds, no interview card, draft looks like today's phantom-reader output.
- Manual interrupt round-trip: confirm the view-server chat card appears, submitting a reply advances the interview, and the graph resumes (next question appears on the next poll).
- Regression: `bun test` full suite green (recovery-router tests, schema tests, runner tests unchanged); recovery router still handles a malformed interviewer JSON via D/A/B/C (the test suite covers this implicitly since the interviewer uses `promptAgent`).

## Done Criteria

- `discoverReader` node exists, runs for both topic and document mode, produces `reader-profile.json`, sets `state.readerProfile`/`state.learningGoal`.
- The view-server hosts the chat card; `POST /runs/:name/reply` writes `reader-reply.json`; the runner resumes the graph with `Command({ resume })`.
- `fullDraftPrompt` includes `readerContextBlock`; drafts include calibrated Prerequisites.
- `readerDiscovery.enabled: false` short-circuits to a default profile.
- `bunx tsc --noEmit` clean; `bun test` green incl. new tests; manual topic + document + kill-switch checks pass.
- No `confidence` field anywhere in the schema or artifacts.

## Handoff To Next Phase

- **Next phase:** `02-thread-profile-to-auditors-rebuttals.md` (Phase 2).
- **Artifact this phase leaves:** `readerContextBlock(state)` exists and is injected into `fullDraftPrompt`; `state.readerProfile`/`state.learningGoal` are populated and persisted. Phase 2 calls `readerContextBlock` from the other prompt-contract functions.
- **What becomes unblocked:** Phase 2 (thread to auditors/rebuttals) and Phase 3 (surfacing — the profile artifact and state fields Phase 3 reads now exist). Phase 3 can run in parallel with Phase 2 (see Phase 3 brief).

## Open Questions Or Blockers

- **`Command({ resume })` exact shape — `Inferred`, to confirm in the first commit.** LangGraph 1.2.9 exports `Command` (Confirmed); the exact resume invocation (whether `new Command({ resume: value })` is passed as the `invoke` input, or via a config field) needs nailing against the SDK docs/source in Phase 1's first commit. The first checklist item should be a minimal `interrupt` + `Command({ resume })` round-trip test before building the rest of the node.
- **OpenCode session multi-turn state — `Inferred`, non-blocking.** Whether `client.session.prompt` carries conversation state across calls in one session is unverified. The node re-sends the full `interviewTranscript` each turn, so the interviewer is stateless across calls — this assumption is not load-bearing. If false, no code change is needed.
- **`GraphInterrupt` detection shape in the `graph.invoke` result — `Inferred`.** How LangGraph 1.2.9 surfaces an `interrupt` in the `invoke` return value (vs. a throw) needs confirming in the first commit. The existing design-resume path (`:763`) uses `getState` to find the checkpoint; the interrupt path may need similar handling.

## Sources

- Source plan: `docs/plan/reader-discovery/README.md` — Phase 1 section, Decisions A2/B1/C/D2, "How the interviewer outputs questions", "Where the chat lives", "The interviewer's JSON output goes through the recovery router".
- `src/graph.ts:108` (`researchToolBlock`), `:121` (`requestContextBlock` — branches on `inputMode`), `:127` (`fullDraftPrompt`), `:668-675` (auditor `promptAgent` call with `outputFile`+`schema`), edge chain near `:1899`.
- `src/opencode.ts:256` (`promptAgent` signature), `:556` (file-first read), `:686` (A-branch `nooutput && wantFile` reprompt).
- `src/runner.ts:436` (`graph.invoke` call site), `:763` (checkpoint-resume pattern to extend).
- `src/live-status.ts:51` (`createLiveStatusWriter`), `:85` (`writeFile(live-status.json)`).
- `src/view-server.ts:193` (`readLiveStatus`), `:2702` (fetch handler — first non-`GET` route here), `:2555` (background poll).
- `src/checkpointer.ts:35` (`BunSqliteSaver`).
- `node_modules/@langchain/langgraph/dist/index.d.ts` — `interrupt`, `Command` exports (v1.2.9).
- `.opencode/agents/source-auditor.md` — permission template.
- `tests/json-repair.test.ts:45` — OpenCode client stub harness pattern.
