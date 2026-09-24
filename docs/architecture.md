# Architecture

> Last updated: 2026-09-24
>
> A practical architecture guide for the research-qurom codebase: what the app does, how a run moves through the system, where each subsystem lives, and how to debug it when something goes wrong.

---

## What This Project Is

`research-qurom` is a local research-document pipeline built around a quorum of AI agents. One agent drafts a source-backed deep dive. Several auditors review it from different angles. The drafter can accept or rebut findings. The graph repeats until the draft is approved, revised, or fails by policy.

The app is intentionally file-backed and local-first. Runs produce durable artifacts under `{dataDir}/runs/`, idle runs can be moved into `{dataDir}/archive/` (and restored back), graph checkpoints are stored in SQLite, agent activity is mirrored into structured logs, and the web dashboard (plus optional TUI) read those artifacts instead of owning the pipeline.

At a high level:

- The **web dashboard** (`bun run dev`) starts runs, shows live progress, hosts the reader interview, and browses artifacts.
- The **run manager** allows one in-flight pipeline by default. When every pipeline role is Cursor cloud, `maxConcurrentRuns` can raise that cap. See [cursor-multi-run.md](./cursor-multi-run.md).
- The **runner** starts the graph, agent runtime, event bridge, telemetry, and status writers.
- The **LangGraph graph** owns the research state machine.
- The **agent runtime** dispatches prompts to providers such as OpenCode or Cursor.
- The **quorum loop** drafts, audits, rebuts, aggregates, and revises.
- The **artifact layer** writes requests, drafts, audits, findings, summaries, debug logs, and final outputs.
- The optional **design quorum** turns an approved markdown document into a reviewed self-contained HTML page.

---

## Mental Model

Think of the app as three loops layered together:

1. **Research loop**
   - Draft markdown.
   - Audit it in parallel.
   - Let the drafter accept or rebut.
   - Let auditors respond.
   - Aggregate unresolved findings.
   - Revise or finish.

2. **Structured-output recovery loop**
   - Agents are asked for JSON in several places.
   - If output is missing, malformed, truncated, or schema-invalid, the runtime tries targeted repair before failing the run.

3. **Observation loop**
   - OpenCode streams session/tool/message events.
   - The runner converts them into internal events.
   - The TUI, web dashboard, debug log, live-status file, and telemetry all consume those events.

The important boundary is that the graph owns **state and decisions**, while providers own **how an agent prompt is executed**.

---

## Main Runtime Flow

```text
PromptScreen
  -> runResearchPipeline()
    -> createEventBus()
    -> createTelemetry()
    -> createAgentRuntime()
    -> createGraph()
    -> graph.invoke()
      -> ingestRequest
      -> summarizeInputDocument
      -> prepareOutputPath
      -> discoverReaderPrompt / discoverReaderResume
      -> draftFullDraft
      -> scoreReadability / reviseReadability (readability gate)
      -> runParallelAudits
      -> reviewFindingsByDrafter
      -> runTargetedRebuttals
      -> reviewRebuttalResponses
      -> aggregateConsensus
      -> reviseDraft, or finalize
      -> optional design quorum
        -> runDesignHtml -> graphicalEnhance -> readingExperienceEnhance -> htmlReview -> finalizeDesign
```

The app supports two research inputs:

- `topic`: a free-form topic string.
- `document`: a path to a markdown/text document that becomes the source topic.

There is no hardcoded topic whitelist. The current prompts bias the system toward source-backed technical explanations, but the schema and graph accept general topics.

---

## Key Files

| Area | File | Purpose |
|---|---|---|
| Pipeline orchestration | `src/runner.ts` | Starts and stops a run, owns lifecycle events, cancellation, checkpoint recovery, telemetry wiring, and graph invocation. |
| Graph logic | `src/graph.ts` | LangGraph nodes, routing, prompt composition, finding aggregation, consensus, reader discovery, and research-loop state transitions. |
| State and JSON contracts | `src/schema.ts` | Zod schemas for requests, graph state, audit results, rebuttals, aggregate outcomes, confidence, and design audit output. |
| Provider abstraction | `src/agent-runtime/runtime.ts` | Role-to-provider dispatch, file inlining fallback, provider capability handling, and handle disposal. |
| Structured output | `src/agent-runtime/provider-structured-output.ts` | Provider-agnostic structured output prompting and continuation handling. |
| OpenCode integration | `src/opencode.ts` | OpenCode session prompting, JSON/file output handling, recovery router, permission reply helpers. |
| OpenCode event bridge | `src/opencode-event-bridge.ts` | Translates OpenCode SSE events into internal runner events. |
| Provider registry | `src/providers/registry.ts` | Registers providers and resolves the provider for a role. |
| OpenCode provider | `src/providers/opencode.ts` | Default provider implementation. |
| Cursor provider | `src/providers/cursor.ts` | Cursor SDK provider implementation with inline JSON support. |
| Design artifacts | `src/design-artifacts.ts` | Live `design.html` plus role-staged HTML snapshots. |
| Working draft | `src/draft-artifacts.ts` | Live `draft.md` plus round/readability snapshots. |
| Design skill | `src/frontend-design-skill.ts` | Loads Anthropic's `frontend-design` skill and inlines it on the first keepAlive prompt for the three generative design roles. |
| Output/artifacts | `src/output.ts` | Run directory creation, slug generation, approved/failed artifact writing. |
| Checkpointing | `src/checkpointer.ts` | `BunSqliteSaver`, the custom LangGraph SQLite checkpointer. |
| Debug log | `src/debug-log.ts` | Structured JSONL log writer. |
| Live status | `src/live-status.ts` | Writes the live run status consumed by the web dashboard. |
| Config | `src/config.ts` | Environment and quorum config schema. |
| Config store | `src/config-store.ts` | SQLite-backed prompt/runtime config store. |
| TUI app | `src/tui/App.tsx` | Main TUI controller. |
| TUI prompt screen | `src/tui/components/PromptScreen.tsx` | Topic/document/design input UI. |
| Web view entry | `src/view-server.ts` | Starts the dashboard server. |

---

## Configuration

Runtime configuration comes from environment variables plus `quorum.config.json`.

Important config sections:

```json
{
  "designatedDrafter": "research-drafter",
  "auditors": ["source-auditor", "logic-auditor", "clarity-auditor"],
  "summarizerAgent": "markdown-summarizer",
  "maxRounds": 10,
  "maxRebuttalTurnsPerFinding": 2,
  "recursionLimit": 160,
  "requireUnanimousApproval": true,
  "artifactDir": "runs",
  "promptAssetsDir": "assets/prompts",
  "researchTools": {
    "prefer": ["context7", "exa", "grepapp"],
    "webSearchProvider": "exa"
  },
  "readerDiscovery": {
    "enabled": true,
    "maxTurns": 6
  }
}
```

OpenCode agent files live under `.opencode/agents/` (frontmatter only: model, variant, tool/file permissions). OpenCode skills ship from `defaults/opencode/skills/` into `.opencode/skills/`. Behavioral prompts live under `defaults/prompts/` and the SQLite config store — one full file per role×task. The graph only fills template placeholders; provider-specific output wrappers are appended by code. Design quorum prompts receive the inlined `frontend-design` skill on the first keepAlive turn only.

---

## Research State

`ResearchState` is the central object passed through the graph. It contains:

- Request identity: `requestId`, `inputMode`, `topic`, `documentPath`, `documentText`.
- Run progress: `round`, `readabilityTry`, `status`, `outputPath`.
- Current content: `draft`, `inputSummary`, `artifactSummary`.
- Review state: `audits`, `unresolvedFindings`, `approvedAgents`.
- Rebuttal state: `activeRebuttals`, `rebuttalTurnCounts`, `rebuttalHistory`, `rebuttalResponseHistory`.
- Reader context: `readerProfile`, `learningGoal`, `interviewTranscript`.
- Failure and confidence: `failureReason`, `confidence`.
- Design output: `designHtml`, `designStatus`, `designRound`.

Zod validates the state at graph boundaries. A few important invariants:

- Topic mode must include a topic.
- Document mode must include a document path or text.
- `approve` audits cannot carry blocker or major findings.
- `revise` audits must include at least one finding.
- Approved aggregate outcomes cannot contain unresolved blocker or major findings.

---

## The Research Graph

### `ingestRequest`

Validates the incoming request and creates the initial `ResearchState`. For document mode, it reads the document text from disk when it is not already supplied.

### `summarizeInputDocument`

Only runs for document mode. It summarizes the input document so the run has a display title and short description.

### `prepareOutputPath`

Creates the run directory and writes the initial request metadata. The run directory becomes the stable home for all later artifacts.

### `discoverReaderPrompt`

Runs the optional reader interview. It asks the `reader-interviewer` agent what question to ask next, using the topic/document context plus the transcript so far.

When the interviewer returns a complete profile, the graph stores:

- The reader's learning goal.
- Concepts the reader is familiar with.
- Concepts the reader has only heard of or does not know.

### `discoverReaderResume`

Suspends the graph with LangGraph `interrupt()`. The runner detects the interrupt, writes an awaiting-reader state, polls for a reply file, then resumes the graph with `Command({ resume })`.

### `draftFullDraft`

Builds the full drafting prompt from:

- research tool hints
- request context
- reader context
- `research-drafter.draft.md`

The designated drafter writes the live working file `draft.md` on a keepAlive writing session. The graph snapshots that file to `draft-round-N.md`. Finding review and rebuttal review still mint independent one-shot sessions. The first prompt on a writing session includes research-tool hints and reader calibration. Later follow-ups on that live session omit both — they are already in history. A replacement session after death or process restart includes them again.

### `scoreReadability` / `reviseReadability`

Readability review gate (TypeSafe Jev). Scores each prose paragraph, then either continues to audits (zero hotspots, skipped, or max tries) or sends the drafter a readability review on the same writing session. The drafter edits `draft.md` in place; the graph snapshots `draft-round-N-readability-M.md` and refreshes `draft-round-N.md`. Readability hints name 1-based line ranges in that file instead of quoting the paragraph; the follow-up asks the drafter to read those spans first and edit from the bottom of the file. That follow-up omits research-tool hints and reader calibration unless the writing session was just minted. Not an auditor: no vote, no findings, no rebuttal. Jev state includes a constant `audience`: the reader is fluent but not a native English speaker. See [readability-review-plan.md](./readability-review-plan.md).

Finished runs can also request a **score-only post-run review** (`POST /api/runs/:id/readability-review`). That path does not resume the graph or rewrite `final.md`. It writes sidecar artifacts `readability-review.json`, `readability-review.jev.json`, and `readability-review-status.json` using the current quorum thresholds and model. If readability is disabled or `TYPESAFE_API_KEY` is missing, the request fails instead of writing a skipped-pass report.

### `runParallelAudits`

Runs all configured auditors in parallel. Each auditor receives the current draft, the shared audit prompt, the reader context, and a structured JSON schema.

Each finding is normalized into a deterministic ID:

```text
{requestId}:{round}:{agent}:{findingIndex}
```

### `reviewFindingsByDrafter`

The drafter reviews auditor findings and returns:

- `acceptedFindingIds`: findings it agrees with.
- `rebuttals`: findings it disputes with evidence.

The graph turns rebuttals into active rebuttal state keyed by finding.

### `runTargetedRebuttals`

Only auditors with active rebuttals are prompted. Each auditor can:

- `uphold` the finding.
- `withdraw` the finding.
- `soften` the finding with a revised severity/payload.

Responses are validated against the expected finding set.

### `reviewRebuttalResponses`

The drafter reviews upheld rebuttals. It can accept the auditor's position or issue another, narrower rebuttal until the per-finding rebuttal turn cap is reached.

### `aggregateConsensus`

Calculates the effective unresolved findings:

- Withdrawn findings are removed.
- Softened findings are kept with the updated payload.
- Upheld or unanswered findings remain.

Then it decides:

- `approved`
- `approved_with_caveats`
- `needs_revision`
- `failed_non_convergent`

The graph also computes a signature of unresolved findings to detect stagnation across rounds.

### `reviseDraft`

When consensus requires revision, the same keepAlive writing session edits `draft.md` in place from the unresolved findings. Compaction can drop inlined prompt text, and Qurom cannot choose when that happens, so findings are not left only in conversation history.

The graph writes `unresolved-findings-round-N.json` and a stable working copy `findings.json`.

- **Attachment providers (OpenCode):** attach `findings.json`. The run directory is readable; the revise prompt tells the agent to re-read that file if the conversation was compacted.
- **Inline providers (Cursor):** do not inline the JSON. At writing-session create, Qurom mints a session capability token, stores it, and injects a remote MCP server (`/mcp/findings`) with `Authorization: Bearer <token>`. The tool `get_unresolved_findings` returns the current findings for that request. The token is connection auth, not a prompt argument, and stays valid for multiple fetches until the writing session is disposed. Cursor cloud must be able to reach the dashboard origin; set `QUORUM_MCP_BASE_URL` to a public base URL. Local Cursor can use `http://127.0.0.1:$VIEW_PORT`. The run page **Check findings MCP** button calls that same tool and compares the payload to `findings.json` / `unresolved-findings-round-N.json`.

This MCP is per writing session. It is not part of the user-managed `/config/mcp` registry.

The revision prompt is intentionally surgical: fix only what findings identify, preserve uncriticized text, and avoid mentioning the review process. Like readability, it repeats research-tool hints and reader calibration only when the writing session is new. The graph snapshots the next `draft-round-N.md`.

---

## Reader Discovery

Reader discovery is the project's human-in-the-loop step. It exists to prevent drafts from guessing the reader's background.

The prompt asks the interviewer to discover:

- The reader's learning goal.
- Which concepts matter for calibration — true priors versus topic concepts.
- How to treat each inferred gap (`must-explain`, `brief-recap`, or `can-assume`).

The resulting profile affects drafting through `readerContextBlock()`:

- Known concepts are marked as already familiar (`can-assume`).
- Unknown or weak concepts are listed as grounding/recap guidance for the throughline — not as a required `Prerequisites` section.
- The learning goal is injected so the draft can prioritize the right depth.

If the feature is disabled or the turn budget is exhausted, the graph continues without a profile.

The interviewer reuses one keepAlive session across turns. The first prompt on that session includes research-tool hints. Later follow-ups omit the hints (they are already in history) but still send the current `profileSoFar` and transcript. A freshly minted interviewer session after process restart includes the hints again.

---

## Agent Runtime And Providers

The provider layer lets the graph talk to different agent backends without hardcoding one implementation into the graph.

Provider capabilities describe what the backend can do:

| Capability | Meaning |
|---|---|
| `streamingEvents` | Provider can emit live events. |
| `toolEvents` | Provider exposes tool-call events. |
| `permissionEvents` | Provider exposes permission request/reply events. |
| `fileAttachments` | Provider supports prompt file attachments. |
| `providerManagedAgents` | Provider owns agent definitions. |
| `jsonFileOutput` | Provider can write structured JSON to files. |
| `plainJsonOutput` | Provider can return JSON inline. |

OpenCode is the default provider. Cursor is supported as an alternate provider, but with a more limited capability set. When a provider cannot attach files, the runtime inlines small file contents into the prompt with explicit tags.

Role routing is configured through `agentRuntime.roles`. If a role has no explicit provider, the runtime uses `agentRuntime.defaultProvider`.

---

## Structured Output Recovery

Many nodes require JSON from agents. The project treats malformed JSON as a recoverable operational fault.

Fault classes include:

| Fault | Meaning |
|---|---|
| `nooutput` | No usable output was produced. |
| `truncated` | JSON appears cut off. |
| `syntax` | JSON parsing failed. |
| `schema` | JSON parsed but failed Zod validation. |
| `transport` | Provider or session transport failed. |

The recovery ladder is:

```text
D: free coercion
   - strip markdown fences/tags
   - extract the first balanced JSON object/array

A/B: same-agent repair
   - ask the same agent to output only corrected JSON
   - include Zod issues for schema failures

C: json-fixer agent
   - a dedicated agent reads malformed JSON from disk
   - rewrites only the JSON artifact

R: auditor fresh-session restart
   - audit-only outer restart after recovery exhaustion
   - controlled by auditRestart.maxRestarts
```

The runtime also detects dual output: when an agent both writes the output file and returns inline JSON. If the two parsed payloads differ, the debug log records `session.dual_output` and the file output wins.

---

## Event System

`src/runner.ts` defines the internal `RunnerEvent` stream. Everything user-facing is derived from it.

Important event groups:

- Lifecycle: `starting`, `running`, `complete`, `error`.
- Graph nodes: `graph.node` start/end.
- Sessions: created, status, error, metadata.
- Agent messages: text, reasoning, message starts.
- Tools: running/completed/error.
- Permissions: asked/replied.
- Design phase updates.

Consumers include:

- TUI Zustand store bindings.
- Web live-status file writer.
- Debug log writer.
- Langfuse telemetry listener.
- OpenCode event capture when enabled.

The OpenCode event bridge translates provider events into this internal event vocabulary. That keeps the UI and telemetry mostly provider-neutral.

### Token usage and prompt accounting

Each provider call records billed usage on `session-telemetry.json`. Cursor and OpenCode report four token buckets: uncached input (`tokensIn`), cache read, cache write, and output. Cost estimates already used those buckets at different rates; the stored counts used to fold cache into `tokensIn`. New runs keep the split so keepAlive follow-ups can be judged by cache hit rate, not a mashed input total. Older files without cache fields still display `tokensIn` as a combined number.

Prompt accounting is separate from billed usage. `runtime.prompt` emits `agent.prompt` (also in `debug-log.jsonl`) with the composed prompt size, attached/inlined file bytes, `keepAliveFresh`, whether standing context (research-tool hints + reader calibration) was included, and whether the `frontend-design` skill was inlined. That is the measurement for “did this follow-up omit repeated context?” Estimated prompt tokens are `chars / 4`, not a tokenizer, and are not used for cost.

---

## Persistence And Artifacts

Each run gets a directory under `runs/`.

Common artifacts:

| Artifact | Purpose |
|---|---|
| `request.json` | Original request and metadata. |
| `draft.md` | Live working article the research drafter edits through draft, readability, and revise. |
| `draft-round-N.md` | Snapshot of `draft.md` after each writing step. |
| `audit-{agent}-round-N.json` | Individual audit result. |
| `audits-round-N.json` | Combined audit result for a round. |
| `drafter-finding-review-round-N.json` | Drafter's accept/rebuttal decision. |
| `rebuttals-{agent}-round-N.json` | Rebuttals sent to each auditor. |
| `auditor-rebuttal-responses-round-N-turn-M.json` | Auditor responses. |
| `aggregated-findings-round-N.json` | Consensus output. |
| `readability-round-N-try-M.json` | In-run Jev readability report. |
| `readability-review.json` | Score-only post-run Jev review of the finished article. |
| `final.md` | Approved research document. |
| `failure.json` | Failure details. |
| `summary.json` | Run summary. |
| `debug-log.jsonl` | Structured diagnostic log. |
| `session-telemetry.json` | Per-session model, cache-split token usage, cost, and prompt-size accounting. Dashboard source of truth for run cost. |
| `session-ledger.json` | Durable provider session ids (`bc-…` / OpenCode session) keyed by role, node, and round. Used to harvest a live or finished session on resume instead of creating a new agent. |
| `reader-profile.json` | Reader discovery profile. |
| `reader-reply-turn-N.json` | Archived human replies. |
| `design.html` | Live working HTML the three generative design roles edit. |
| `design-html-<role>.html` | Snapshot of `design.html` after each design stage (`html-designer`, `graphical-enhancer`, `reading-experience-enhancer`, `html-reviewer`). Older runs may still have `design-html-interactive-enhancer.html`. |
| `design-html-round-N.html` | Legacy design quorum draft HTML. |
| `design-audit-{agent}-round-N.json` | Design audit result. |
| `final.html` | Approved HTML output. |

Checkpoint state lives in SQLite through `BunSqliteSaver`. The checkpointer stores both checkpoints and pending writes, uses WAL mode, and includes migration handling for older checkpoint formats.

---

## Design Quorum

The design quorum is a second review loop that starts after markdown approval when enabled.

Agents:

| Agent | Role |
|---|---|
| `html-designer` | Converts approved markdown into a self-contained HTML page. |
| `graphical-enhancer` | Adds visible comprehension figures after drafting. |
| `reading-experience-enhancer` | Improves on-screen reading ergonomics after graphical enhance. |
| `html-reviewer` | Playwright-checks the staged HTML and applies surgical layout fixes. |

The three generative design roles follow Anthropic's `frontend-design` skill (shipped at `defaults/opencode/skills/frontend-design/`, bootstrapped to `.opencode/skills/`). The skill is inlined on the first keepAlive prompt so both OpenCode and Cursor see it; follow-ups omit it. If that first prompt has not yet sent the source markdown, inline file-output providers persist `content.md` into the writing workspace before HTML work. `html-designer` chooses the visual identity; the enhancers must not re-theme. They do not run Playwright or computer-use. They share one keepAlive provider session bound to the `html-designer` runtime and edit `design.html` in place; the graph snapshots each role file. If that session dies (`error` / `cancelled`), the graph restores the last role snapshot, mints a new `html-designer` keepAlive session, and attaches the HTML (and the source markdown, which has not been prompted on the new session) as context. `html-reviewer` starts a fresh session so it can attach Playwright.

The design loop is linear:

```text
runDesignHtml
  -> graphicalEnhance
  -> readingExperienceEnhance
  -> htmlReview
  -> finalizeDesign (final.html)
```

The implementation also guards against malformed HTML:

- strips markdown fences and model preamble,
- checks for closing `</html>` and `</body>`,
- checks script tag balance,
- falls back to previous HTML when a revision is unusable.

---

## TUI And Web UI

The TUI lives under `src/tui/` and is built with OpenTUI React.

Primary screens:

- `PromptScreen`: topic/document/design input.
- `RunningScreen`: live graph and agent activity.
- `SummaryScreen`: final result and links/actions.

State is stored in Zustand and updated by event bindings from the runner event bus.

The web dashboard is separate. It reads live and historical run data from run artifacts, exposes the reader interview form, and provides richer artifact inspection than the terminal UI.

This file-mediated separation is deliberate: the runner does not need to host HTTP, and the dashboard does not need a live graph handle.

---

## Prompt Assets

Prompt assets are loaded from the SQLite config store (seeded from `defaults/prompts/`). Each asset is the full prompt for one call site, named `<role>.<task>.md` (for example `research-drafter.draft.md`, `source-auditor.audit.md`, `html-reviewer.review.md`).

Structured JSON output instructions are appended by code instead of hardcoded into prompt assets. That keeps task prompts focused on behavior and lets providers choose file output or inline JSON based on capability.

---

## Agent Definitions

OpenCode agents live under `.opencode/agents/`.

Research agents:

| Agent | Responsibility |
|---|---|
| `research-drafter` | Drafts, reviews findings, rebuts, and revises. |
| `source-auditor` | Reviews source support, citation quality, evidence quality, and source fidelity. |
| `logic-auditor` | Reviews contradictions, inference gaps, prerequisites, examples, scope, and coherence. |
| `clarity-auditor` | Reviews reader comprehension, throughline, jargon load, examples, and explanatory clarity. |
| `markdown-summarizer` | Summarizes input documents and final artifacts. |
| `reader-interviewer` | Conducts the reader discovery interview. |
| `reader-profile-repairer` | Intent-only repair of a seeded reader profile into primary + secondary goals (rerun repair mode). |
| `json-fixer` | Repairs malformed JSON artifacts. |

Design agents:

| Agent | Responsibility |
|---|---|
| `html-designer` | Produces design HTML from approved markdown. |
| `graphical-enhancer` | Adds visible comprehension figures. |
| `reading-experience-enhancer` | Improves reading progress, overflow, and mobile ergonomics. |
| `html-reviewer` | Playwright-checks HTML and applies surgical layout fixes. |

Agent files define model, variant, tool permissions, and write permissions only (no behavioral prompt body). Most agents are allowed to write only their expected artifact file under `runs/**`.

---

## Failure Handling

Failures are handled at several levels:

- Provider prompt failures can retry or surface typed errors.
- Structured JSON failures go through the recovery ladder.
- Auditor structured-output failures can trigger fresh-session restart.
- The runner attempts to recover latest checkpointed graph state.
- Failure artifacts are written when possible.
- Created OpenCode sessions are aborted during cancellation/error cleanup.
- Debug logs capture the path that led to failure.

Systemic drift detection watches for repeated auditor restarts across distinct request IDs. If the same agent repeatedly needs restart across runs, the system treats it as likely prompt/schema drift and fails loudly instead of silently burning cycles.

---

## Debugging Guide

Start with the run directory. Most answers are in `debug-log.jsonl`, `request.json`, draft files, and the round artifacts.

Useful checks:

```bash
# Pretty-print the debug log
jq . runs/<run>/debug-log.jsonl

# Recovery events
rg 'session.recovery|session.repair|audit.restart|systemic_drift' runs/<run>/debug-log.jsonl

# Pipeline lifecycle
rg 'pipeline.start|pipeline.complete|pipeline.error' runs/<run>/debug-log.jsonl

# Agent/session creation
rg 'session.created|agent.metadata' runs/<run>/debug-log.jsonl

# Tool failures
rg '"kind":"agent.tool"|tool.*error' runs/<run>/debug-log.jsonl
```

When debugging a bad final draft:

1. Read `request.json`.
2. Read the latest `draft-round-N.md`.
3. Read `audits-round-N.json`.
4. Read `aggregated-findings-round-N.json`.
5. Check whether the unresolved finding signature stagnated.
6. Check whether the revision prompt was too surgical or the finding was too broad.

When debugging malformed JSON:

1. Look for `session.recovery.classify`.
2. Check the fault type.
3. Check whether same-agent repair ran.
4. Check whether `json-fixer` ran.
5. Check for `session.dual_output`.
6. If the failure is audit-only, check for `audit.restart_from_scratch`.

When debugging reader discovery:

1. Check `reader.interview_suspend` and `reader.interview_resume`.
2. Check `reader-profile.json`.
3. Check archived `reader-reply-turn-N.json` files.
4. Confirm the graph resumed with the expected turn.

---

## What To Change For General-Topic Research

The graph already accepts arbitrary topics. The software/technical bias mostly comes from prompts and tool preferences.

The lowest-risk change is to keep specialist tools available but make the prompt contract domain-neutral:

- Keep `context7` for library/framework/API documentation.
- Keep `grepapp` for real-world code examples.
- Put general search/fetch tools first when broad topics are common.
- Make `deep-dive-contract.md` refer to primary sources, official references, standards, papers, datasets, historical records, legal texts, or expert material instead of privileging source code.

The agent hint should explain when each tool fits. Tool order matters less than tool guidance, but order can still bias the model.

---

## Maintenance Notes

- Keep graph state changes schema-first: update `src/schema.ts`, then graph nodes, then tests.
- Keep prompt behavior in prompt assets unless the behavior is provider-specific or schema-specific.
- Do not duplicate structured JSON output instructions in prompt assets; code appends them based on provider capability.
- Treat `runs/` artifacts as the source of truth for debugging.
- Avoid broad rewrites in `revise-draft.md`; the revision loop is intentionally surgical to reduce churn.
- When adding a provider, implement capabilities honestly. Incorrect capabilities cause worse failures than missing capabilities.

---

## Quick Glossary

| Term | Meaning |
|---|---|
| Drafter | Agent responsible for producing and revising the research document. |
| Auditor | Agent responsible for reviewing the draft from one scoped perspective. |
| Finding | A concrete, evidence-backed issue raised by an auditor. |
| Rebuttal | Drafter's evidence-backed disagreement with a finding. |
| Consensus | Aggregate decision over approvals and unresolved findings. |
| Run directory | The artifact directory for one research request. |
| Checkpoint | Persisted LangGraph state used for resume/recovery. |
| Provider | Backend that executes agent prompts. |
| Prompt asset | Repo-owned prompt template loaded at runtime. |
| Design quorum | Optional second loop that produces reviewed HTML from approved markdown. |

---

This document is intended as an onboarding and maintenance guide, not a generated API reference. Prefer updating it when architecture or runtime contracts change, and keep line-by-line implementation details in code comments and tests.
