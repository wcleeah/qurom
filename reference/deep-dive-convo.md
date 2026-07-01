# research-qurom: Comprehensive Deep Dive

> **Last updated:** 2026-07-01
>
> A self-contained document covering the architecture, data flow, agent loop, provider system, recovery machinery, TUI/UI design, and all major subsystems of the **research-qurom** project.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [The Quorum Agent Loop](#3-the-quorum-agent-loop)
4. [State Schema & Graph](#4-state-schema--graph)
5. [Agent Runtime & Provider System](#5-agent-runtime--provider-system)
6. [Structured Output Recovery Router](#6-structured-output-recovery-router)
7. [Reader Discovery (Human-in-the-Loop)](#7-reader-discovery-human-in-the-loop)
8. [Event System & Telemetry](#8-event-system--telemetry)
9. [The Design Quorum](#9-the-design-quorum)
10. [Checkpointing & Persistence](#10-checkpointing--persistence)
11. [TUI Application](#11-tui-application)
12. [Web View Server](#12-web-view-server)
13. [Prompt Asset Management](#13-prompt-asset-management)
14. [Configuration System](#14-configuration-system)
15. [Key Files & Their Roles](#15-key-files--their-roles)
16. [Lifecycle of a Run](#16-lifecycle-of-a-run)
17. [Agent Definitions](#17-agent-definitions)
18. [Recovery & Drift Detection](#18-recovery--drift-detection)

---

## 1. Project Overview

**research-qurom** is an automated research document generation system powered by a quorum of AI agents. It orchestrates a **designated drafter** and **three parallel auditors** through a structured review loop to produce high-quality, peer-reviewed research documents on any given topic.

### Core Value Proposition

- **Multi-agent quorum**: One agent drafts, three agents audit from different perspectives (sources, logic, clarity).
- **Rebuttal protocol**: The drafter can rebut findings; auditors can uphold/soften/withdraw; the drafter can re-rebut.
- **Reader discovery**: An optional human-in-the-loop interview phase learns the reader's background and adapts the document's prerequisites and depth.
- **Design quorum**: An approved research document can be turned into a self-contained HTML page by a second quorum of design-specialist agents.
- **Structured output recovery**: A sophisticated multi-tier recovery router ensures agents produce valid JSON even when they initially fail.
- **Telemetry**: Full Langfuse OpenTelemetry instrumentation captures every agent call, tool use, and pipeline event.
- **Checkpointing**: LangGraph state is persisted to SQLite via a custom `BunSqliteSaver`, enabling resume from any point.

### Tech Stack

| Layer | Technology |
|---|---|
| Runtime | **Bun** (JavaScript runtime, package manager, test runner, SQLite driver) |
| Language | **TypeScript** (strict mode, ESM) |
| State machine | **LangChain LangGraph** (`@langchain/langgraph`) |
| Checkpointing | **bun:sqlite** + `@langchain/langgraph-checkpoint` |
| Agent runtime | **OpenCode** (`@opencode-ai/sdk/v2`) — spawns agent sessions |
| TUI framework | **OpenTUI React** (`@opentui/react`) — terminal UI |
| Web server | **Bun.serve** — real-time dashboard |
| Observability | **Langfuse** (OpenTelemetry, `@langfuse/tracing`) |
| Schema validation | **Zod** — all agent inputs/outputs, config, and state |
| State management | **Zustand** — TUI state bindings |
| Node bundling | **Bun** built-in bundler |
| UI rendering | **React** (DOM-less, for terminal rendering via OpenTUI) |

---

## 2. Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│                     research-qurom                        │
│                                                           │
│  ┌──────────┐    ┌──────────────────┐    ┌─────────────┐ │
│  │   TUI     │◄──►│   Event Bus      │◄──►│  OpenCode   │ │
│  │ (opentui) │    │  (zustand store) │    │  Event      │ │
│  └──────────┘    └────────┬─────────┘    │  Bridge     │ │
│                           │               └──────┬──────┘ │
│                           │                      │        │
│  ┌────────────────────────▼──────────────────────▼──────┐ │
│  │              LangGraph State Machine                   │ │
│  │                                                       │ │
│  │  discoverReader → draftFullDraft → runParallelAudits  │ │
│  │       → reviewFindings → runTargetedRebuttals          │ │
│  │       → reviewRebuttals → aggregateConsensus          │ │
│  │       → reviseDraft → ... (loop)                      │ │
│  └──────────────────────┬───────────────────────────────┘ │
│                         │                                  │
│  ┌──────────────────────▼───────────────────────────────┐ │
│  │              Agent Runtime Layer                       │ │
│  │                                                       │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │ │
│  │  │ OpenCode  │  │  Cursor  │  │  Structured      │   │ │
│  │  │ Provider  │  │ Provider │  │  Output Recovery │   │ │
│  │  └──────────┘  └──────────┘  │  Router           │   │ │
│  │                              │  (D→A/B/C→R)      │   │ │
│  │                              └──────────────────┘   │ │
│  └──────────────────────┬───────────────────────────────┘ │
│                         │                                  │
│  ┌──────────────────────▼───────────────────────────────┐ │
│  │  Persistence Layer                                     │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │ │
│  │  │ Checkpoints  │  │ Debug Logs   │  │ Run        │  │ │
│  │  │ (SQLite)     │  │ (JSONL)      │  │ Artifacts  │  │ │
│  │  └──────────────┘  └──────────────┘  └────────────┘  │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Quality of Life                                       │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │ │
│  │  │ Langfuse     │  │ View Server  │  │ Design     │  │ │
│  │  │ Telemetry    │  │ (Web Dash)   │  │ Quorum     │  │ │
│  │  └──────────────┘  └──────────────┘  └────────────┘  │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

---

## 3. The Quorum Agent Loop

### 3.1 Overview

The core agent loop is defined as a LangGraph `StateGraph` in `src/graph.ts`. The graph has the following node states and transitions:

```
discoverReaderPrompt
    │
    ▼
discoverReaderResume ───► (routeAfterReaderPrompt)
    │
    ▼
draftFullDraft
    │
    ▼
runParallelAudits
    │
    ▼
reviewFindingsByDrafter
    │
    ├──► (no rebuttals) ──► aggregateConsensus
    │
    └──► (rebuttals exist) ──► runTargetedRebuttals
                                    │
                                    ▼
                              reviewRebuttalResponses
                                    │
                                    ├──► (rebuttals settled) ──► aggregateConsensus
                                    │
                                    └──► (rebuttals disputed) ──► runTargetedRebuttals (loop)
                                                            │
                                                            ▼
                                                    aggregateConsensus
                                                            │
                                          ┌─────────────────┼────────────────┐
                                          ▼                 ▼                ▼
                                     approved         needs_revision     failed
                                                            │
                                                            ▼
                                                      reviseDraft
                                                            │
                                                            ▼
                                                      runParallelAudits (loop)
```

### 3.2 Node Details

#### `discoverReaderPrompt`
- **Status**: `drafting`
- **Purpose**: Conducts an adaptive interview with the human user to discover their background and learning goals.
- **Behavior**: On first entry (or when the last transcript entry is a reader reply), it prompts a `reader-interviewer` agent to generate follow-up questions. 
- The agent receives the full transcript and returns either:
  - A set of questions for the next turn (interview continues)
  - A complete profile with `learningGoal` and `concepts[]` (interview done)
- A reusable session handle is cached per `requestId` so the same conversation persists across turns.
- Kill-switch: `readerDiscovery.enabled = false` skips the interview entirely.

#### `discoverReaderResume`
- **Status**: `drafting` (via interrupt)
- **Purpose**: Suspends the graph with `interrupt()` to await human input.
- **Behavior**: Called when the last transcript entry is an interviewer question. The graph suspends; the runner polls for a `reader-reply.json` file written by the view server (or TUI). On resume, the reader's reply is appended to the transcript.

#### `draftFullDraft`
- **Status**: `drafting → auditing`
- **Purpose**: The designated drafter writes the complete research document.
- **Prompt composition**:
  1. `deepDiveContract` — the system-level contract for deep dive documents
  2. `researchToolHint` — preferred tools for evidence gathering
  3. `requestContextBlock` — the topic or document
  4. `readerContextBlock` — reader profile (familiar/unknown concepts, learning goal)
  5. `draftFullDraft` — the drafting instruction template
- **Output**: Writes `draft-round-{round}.md` to the run directory.

#### `runParallelAudits`
- **Status**: `auditing → reviewing_findings`
- **Purpose**: All configured auditors review the draft **in parallel** via `Promise.all`.
- **Each auditor receives**:
  - The draft markdown as an attached file
  - The audit prompt template (with `deltaContext` for revision rounds)
  - A JSON schema for structured output (vote + findings)
- **Audit restart**: On structured output failure, `auditWithRestart` tears down the session and restarts on a fresh OpenCode session (up to `auditRestart.maxRestarts` times).
- **Finding IDs**: Each finding gets a deterministic ID: `{requestId}:{round}:{agent}:{findingIndex}`.
- **Schema validation**: The audit result is validated with Zod `superRefine`:
  - `approve` vote cannot have blocker or major findings
  - `revise` vote must have at least one finding

#### `reviewFindingsByDrafter`
- **Status**: `reviewing_findings → awaiting_auditor_rebuttal | aggregating`
- **Purpose**: The drafter reviews all auditor findings and decides which to accept and which to rebut.
- **Prompt**: Receives the draft + audits file and returns:
  - `acceptedFindingIds[]` — findings the drafter agrees with
  - `rebuttals[]` — findings the drafter disputes (includes position, argument, evidence, and requested resolution)
- **Rebuttal state**: Active rebuttals are built per-finding; turn counts are incremented. If any rebuttal is still eligible for response, status goes to `awaiting_auditor_rebuttal`.
- **Cap detection**: Findings that have hit `maxRebuttalTurnsPerFinding` cannot be rebutted.

#### `runTargetedRebuttals`
- **Status**: `awaiting_auditor_rebuttal → reviewing_rebuttal_responses`
- **Purpose**: Each auditor who has active rebuttals against their finding receives the rebuttal and responds.
- **Behavior**: Rebuttals are grouped by target agent. Each agent runs in parallel. The agent receives the draft, the rebuttal JSON, and returns:
  - `uphold` — stands by the finding
  - `withdraw` — retracts the finding
  - `soften` — downgrades the finding severity with an updated finding payload
- **Validation**: Every expected finding must have a response; missing responses throw an error.

#### `reviewRebuttalResponses`
- **Status**: `reviewing_rebuttal_responses → aggregating | awaiting_auditor_rebuttal`
- **Purpose**: The drafter reviews auditor responses to their rebuttals. Only disputed findings (where the auditor chose `uphold`) are considered.
- **Decision**: For each disputed finding, the drafter can either accept the auditor's position (add to `acceptedFindingIds`) or issue one more rebuttal with stronger evidence.
- **Cap**: Findings at the max rebuttal turn limit cannot be re-rebutted.

#### `aggregateConsensus`
- **Status**: `aggregating → approved | revising | failed`
- **Purpose**: Aggregates all findings, rebuttals, and responses to determine the final outcome.
- **Algorithm**:
  1. For each finding, look up the effective latest response (from response history)
  2. `withdraw` → finding removed; `soften` → finding kept with updated severity; `uphold` or no response → finding kept as-is
  3. Deduplicate findings by `findingId`
  4. Sign the unresolved set for stagnation detection
  5. Evaluate approval conditions:
     - **Unanimous mode** (`requireUnanimousApproval: true`): All auditors must approve (or have only minor findings) and no blockers/majors
     - **Non-unanimous mode**: Zero unresolved findings
  6. Outcomes: `approved`, `approved_with_caveats` (minor issues remain), `needs_revision`, `failed_non_convergent` (stagnated or max rounds)
- **Stagnation**: If the unresolved findings signature hasn't changed between rounds, the run fails.

#### `reviseDraft`
- **Status**: `revising → drafting` (next round)
- **Purpose**: The drafter revises the draft based on unresolved findings.
- **Prompt**: Same as initial draft but with `reviseDraft` instruction template.
- **Round increment**: `state.round++`, status goes back to `auditing`.

### 3.3 Round Configuration

```json
{
  "maxRounds": 10,
  "maxRebuttalTurnsPerFinding": 2,
  "recursionLimit": 80,
  "requireUnanimousApproval": true
}
```

---

## 4. State Schema & Graph

### 4.1 Research State (`src/schema.ts`)

The entire graph state is defined and validated by Zod schemas. The main state object is `ResearchState`:

```typescript
type ResearchState = {
  requestId: string;
  inputMode: "topic" | "document";
  topic?: string;
  documentPath?: string;
  documentText?: string;
  inputSummary?: RunDisplaySummary;  // from summarizeInputDocument
  artifactSummary?: RunDisplaySummary; // from summarizeMarkdown (post-run)
  round: number;                       // current revision round
  draft: string;                       // current draft markdown
  audits: AuditResultRecord[];         // all audit results for current round
  activeRebuttals: Record<string, ActiveRebuttal>;
  currentRebuttalResponsesByFinding: Record<string, RebuttalResponseRecord>;
  rebuttalTurnCounts: Record<string, number>;
  rebuttalHistory: RebuttalHistoryEntry[];
  rebuttalResponseHistory: RebuttalResponseHistoryEntry[];
  unresolvedFindings: AggregatedFinding[];
  lastUnresolvedSignature?: string;   // stagnation detection
  approvedAgents: string[];
  status: ResearchStatus;             // drafting | auditing | reviewing_findings | awaiting_auditor_rebuttal | reviewing_rebuttal_responses | aggregating | revising | approved | failed
  failureReason?: FailureReason;
  outputPath?: string;
  readerProfile?: ReaderProfile;       // from reader discovery
  learningGoal?: string;               // from reader discovery
  interviewTranscript?: InterviewEntry[];
  confidence?: Confidence;             // section-level confidence scores
  designHtml?: string;                 // output from design quorum
  designStatus?: DesignStatus;         // pending | running | approved | failed
  designRound?: number;
};
```

### 4.2 Audit Finding Categories

Findings are classified by:
- **Severity**: `blocker` | `major` | `minor`
- **Category**: `sources` | `coherence` | `clarity` | `structure` | `scope` | `throughline`

### 4.3 Design Finding Categories

Design audit findings use:
- **Severity**: `blocker` | `major` | `minor`
- **Category**: `visual` | `structure` | `accessibility` | `self-containedness` | `interactivity` | `security`

### 4.4 State Transitions via `superRefine`

Key validation rules enforced by Zod `superRefine`:
- **`auditResultSchema`**: `approve` vote cannot have blocker/major findings; `revise` must have ≥1 finding
- **`aggregatedFindingsSchema`**: Approved outcomes cannot have blocker/major unresolved findings; revision outcomes must have unresolved findings
- **`researchStateSchema`**: Topic mode requires a topic; document mode requires path/text; drafting must start at round 0

---

## 5. Agent Runtime & Provider System

### 5.1 Provider Architecture (`src/providers/`)

The provider system abstracts over different AI agent backends. Each provider implements the `AgentProvider` interface:

```typescript
interface AgentProvider {
  id: AgentProviderId;
  capabilities: ReadonlySet<ProviderCapability>;
  prepare?: (input) => Promise<ProviderRuntimeInfo>;
  createRunHandle: (input) => Promise<AgentRunHandle>;
  prompt: <T>(input) => Promise<ProviderPromptResult<T>>;
  abort?: (config, handleId) => Promise<void>;
  createEventBridge?: (input) => Bridge;
  validate?: (input) => Promise<ProviderValidationResult>;
  configForm?: (input) => Promise<ProviderConfigFormDescriptor>;
}
```

#### Capabilities

Each provider declares a set of capabilities:

| Capability | Description |
|---|---|
| `streamingEvents` | Provider emits real-time streaming events for tool calls, reasoning, etc. |
| `toolEvents` | Provider supports tool execution events |
| `permissionEvents` | Provider supports permission request events |
| `fileAttachments` | Provider natively supports file attachments in prompts |
| `providerManagedAgents` | Provider manages its own agent definitions |
| `jsonFileOutput` | Provider can write structured JSON to files on disk |
| `plainJsonOutput` | Provider can return JSON inline in responses |

#### Available Providers

**1. OpenCode Provider** (`src/providers/opencode.ts`)
- Default provider
- Capabilities: `streamingEvents`, `toolEvents`, `permissionEvents`, `fileAttachments`, `providerManagedAgents`, `jsonFileOutput`, `plainJsonOutput`
- Sessions are managed by the OpenCode server
- Produces streaming events for the event bridge

**2. Cursor Provider** (`src/providers/cursor.ts`)
- Alternative provider for Cursor cloud agents
- Capabilities: `plainJsonOutput` (more limited)
- No streaming events — status is emitted synchronously
- Does not support file attachments — files are inlined into the prompt
- No provider-managed agents

### 5.2 Agent Runtime (`src/agent-runtime/runtime.ts`)

The `AgentRuntime` is the central abstraction that wraps provider selection and prompt execution:

```typescript
type AgentRuntime = {
  createHandle: (role, title, parentId?) => Promise<AgentRunHandle>;
  prompt: <T>(input: RuntimePromptInput<T>) => Promise<ProviderPromptResult<T>>;
  abort: (handle) => Promise<void>;
  providerForRole: (role) => AgentProvider;
};
```

**Key behaviors**:
- Resolves the appropriate provider for each role based on `agentRuntime.roles[role].provider` or `agentRuntime.defaultProvider`
- If a provider doesn't support `fileAttachments`, it inlines attached files (up to 1 MB) into the prompt text using `<attached_file>` tags
- If a provider doesn't support `streamingEvents`, it emits lifecycle events synchronously (`session.created`, `session.status`, `session.error`)
- Handles `keepAlive` flag for persistent sessions (used by reader-interviewer)
- Always calls `handle.dispose()` after prompt (unless `keepAlive`)

### 5.3 Provider Routing

Role-to-provider mapping is configured in `agentRuntime.roles`:

```json
{
  "agentRuntime": {
    "defaultProvider": "opencode",
    "roles": {
      "research-drafter": { "provider": "opencode", "model": "claude-sonnet-4-20250514" },
      "source-auditor": { "provider": "cursor", "model": "gpt-4o" }
    }
  }
}
```

Each role can specify its own provider, model, and variant. The `providerForRole()` function in `registry.ts` resolves the correct provider for any role lookup.

---

## 6. Structured Output Recovery Router

### 6.1 Overview

Located in `src/agent-runtime/structured-output.ts`, the recovery router is a sophisticated multi-tier system that handles agent failures to produce valid structured output. It is embedded inside `promptAgent()` in `src/opencode.ts`.

### 6.2 Fault Classification

When structured output fails, the error is classified into one of these fault types:

| Fault | Meaning | Example |
|---|---|---|
| `nooutput` | Agent produced no usable bytes | Empty response, file missing, unreadable |
| `truncated` | JSON cut off before closing | Mid-generation truncation |
| `syntax` | Strict JSON parsing fails | Unescaped quotes, trailing commas, malformed |
| `schema` | JSON parsed but fails Zod validation | Wrong enum values, missing required fields |
| `transport` | Provider transport/runtime error | OpenCode server error, network failure |

### 6.3 Recovery Ladder (D → A/B/C → R)

The recovery router follows this ladder:

```
┌─ Tier D (Free) ──────────────────────────────┐
│  coerceJson() — strips fences/tags, extracts   │
│  first balanced JSON block, retries parse      │
└───────────────────────────────────────────────┘
        │
        ▼ (if still fails)
┌─ Tier A/B (Same Agent, In-Session) ──────────┐
│  Budget: 2 attempts                            │
│  A (nooutput/truncated): generic repair prompt │
│  B (schema): repair prompt with <zod_issues>   │
│     detailing exactly which fields failed      │
└───────────────────────────────────────────────┘
        │
        ▼ (if still fails, syntax + outputFile)
┌─ Tier C (json-fixer Agent, Fresh Session) ────┐
│  Budget: 2 attempts                            │
│  A dedicated "json-fixer" agent on disk reads  │
│  the malformed file, fixes JSON syntax, and    │
│  rewrites it. Responds with OK.                │
└───────────────────────────────────────────────┘
        │
        ▼ (if all budgets exhausted)
┌─ Tier R (Auditor-Only Fresh-Session Restart) ─┐
│  auditWithRestart() tears down the session     │
│  and re-runs the identical prompt on a brand-  │
│  new OpenCode session. Up to maxRestarts.      │
│  Kill-switch: maxRestarts=0 disables Tier R.  │
└───────────────────────────────────────────────┘
        │
        ▼ (if all restarts fail)
┌─ Run Failure ───────────────────────────────┐
│  Typed StructuredRecoveryError is thrown,    │
│  pipeline handles it in the catch block.     │
└──────────────────────────────────────────────┘
```

### 6.4 Key Utilities

**`coerceJson(text)`**: Free pre-clean that:
1. Strips wrapping ```json fences
2. Strips <json> or <output> XML tags
3. Extracts the first balanced `{...}` or `[...]` block (with string-aware bracket matching)

**`hasBalancedJsonClose(text)`**: Checks if the JSON payload has a structurally balanced close, used to detect truncation.

**`buildStructuredRepairPrompt()`**: Generates a repair prompt that includes:
- The required JSON schema
- Previous erroneous response
- Specific Zod issues (for schema faults) or generic parse errors

**`buildFileRepairPrompt()`**: Generates a repair prompt for the `json-fixer` agent that tells it to read the malformed file, fix JSON syntax, and rewrite it.

### 6.5 Dual-Output Detection

When an agent writes to both the output file AND returns inline JSON, the system detects divergence. If the two outputs parse to distinct values, a `session.dual_output` debug event is emitted. The file output takes precedence.

---

## 7. Reader Discovery (Human-in-the-Loop)

### 7.1 Overview

The reader discovery system (`discoverReaderPrompt` and `discoverReaderResume` nodes in `src/graph.ts`) conducts an adaptive interview with the human user to understand their background and learning goals before drafting begins.

### 7.2 Interview Flow

1. **Interviewer Agent** starts with the topic and asks tailored questions
2. **Human replies** via the TUI or view-server web form
3. **Loop continues** for up to `maxTurns` (default: 6)
4. **Profile produced** when done:
   - `learningGoal`: what the reader wants to accomplish
   - `concepts[]`: array of `{ concept, level: "familiar" | "heard-of" | "unknown", evidence }`

### 7.3 Session Management

A single OpenCode session is reused across all interview turns (via `keepAlive` flag). This preserves conversation context. The session handle is cached in `readerInterviewerSessions` map and disposed when the interview completes, fails, or budget is exhausted.

### 7.4 Interrupt-Based Architecture

The graph uses LangGraph's `interrupt()` function to suspend execution while waiting for human input:

1. `discoverReaderPrompt` generates questions and writes them to the transcript
2. The graph routes to `discoverReaderResume`, which calls `interrupt(questions)` 
3. The runner detects the interrupt via `graph.getState().tasks[].interrupts`
4. The runner polls for `reader-reply.json` in the run directory
5. When found, the runner calls `Command({ resume: replyText })` to resume
6. The node appends the reply and routes back to `discoverReaderPrompt` for the next turn

### 7.5 Reply File Protocol

The view-server writes `reader-reply.json` with either:
- JSON: `{ "reply": "user text" }`
- Raw text (fallback)

After reading, the file is renamed to `reader-reply-turn-{N}.json` to preserve the reply trail.

### 7.6 Profile Usage

Once complete, the profile is used in the drafting prompt:
- `learningGoal` is injected as context
- `familiar` concepts noted as known
- `heard-of` and `unknown` concepts generate a **Prerequisites section** that covers them
- If no profile is produced (kill-switch or budget exhausted), the drafter uses a default "competent practitioner" assumption

---

## 8. Event System & Telemetry

### 8.1 Event Bus (`src/runner.ts`)

The central event system uses a publish-subscribe pattern:

```typescript
type EventBus = {
  emit: (event: RunnerEvent) => void;
  on: (listener: RunnerEventListener) => () => void;  // returns unsubscribe
  off: (listener: RunnerEventListener) => void;
};
```

### 8.2 Event Types

| Event Kind | Phase | Description |
|---|---|---|
| `lifecycle` | `starting` / `running` / `complete` / `error` | Pipeline lifecycle |
| `graph.node` | `start` / `end` | Graph node execution |
| `session.created` | — | New agent session opened |
| `session.status` | — | Session status change |
| `session.error` | — | Session error |
| `agent.metadata` | — | Model/variant info for an agent |
| `agent.message.start` | — | Assistant message started |
| `agent.message.text` | — | Text part delta (streaming) |
| `agent.reasoning` | — | Reasoning part delta (streaming) |
| `agent.tool` | `running` / `completed` / `error` | Tool execution event |
| `agent.permission` | — | Permission request from agent |
| `agent.permission.replied` | — | Permission reply result |
| `result` | — | Final run result |
| `design.phase` | — | Design quorum phase |

### 8.3 Event Consumers

1. **TUI Store Binding** (`src/tui/state/eventBindings.ts`): Maps events to Zustand store updates
2. **Telemetry Listener** (`attachTelemetryListener` in `runner.ts`): Creates Langfuse trace observations from tool events
3. **Live Status Writer** (`src/live-status.ts`): Writes real-time status to a JSON file for the view-server
4. **Debug Log** (`createDebugLog`): Writes structured JSONL events to `debug-log.jsonl`

### 8.4 OpenCode Event Bridge (`src/opencode-event-bridge.ts`)

The bridge subscribes to the OpenCode server's event stream and translates SDK events into the internal `RunnerEvent` format:

- `session.idle` → triggers artifact persistence
- `session.status` → forwarded with retry info
- `session.error` → forwarded with name/message
- `permission.asked` → `agent.permission` event (deduplicated by ID)
- `permission.replied` → `agent.permission.replied`
- `message.updated` (assistant) → `agent.message.start`
- `message.part.delta` → `agent.reasoning` or `agent.message.text` (with flush logic)
- `message.part.updated` (reasoning/text/tool) → completion events

Key streaming features:
- **Reasoning/text buffering**: Delta chunks are accumulated and flushed when they hit sentence boundaries or 220-character thresholds
- **Tool deduplication**: Tool events are deduplicated by state key to avoid duplicate emissions
- **Artifact capture**: When `QUORUM_CAPTURE_OPENCODE_EVENTS=1`, all raw events are saved to `opencode-events.json`

### 8.5 Langfuse Telemetry (`src/telemetry.ts`)

Full OpenTelemetry integration via `@langfuse/tracing`:

- **Trace**: One trace per run, created when the pipeline starts
- **Root observation**: Wraps the entire graph invocation
- **Agent observations**: Each agent call creates an `Agent` span
- **Generation observations**: Each prompt to the LLM creates a `Generation` child span
- **Tool observations**: Each tool execution creates a `Tool` span (via `attachTelemetryListener`)
- **Chain observations**: Rebuttal batches create `Chain` spans

Telemetry is optional — it's enabled only when `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set.

---

## 9. The Design Quorum

### 9.1 Overview

When `designQuorum.enabled` is `true`, an approved research run can be turned into a single self-contained HTML document by a second quorum loop (`src/design-quorum.ts`).

### 9.2 Design Agents

| Agent | Role |
|---|---|
| `html-designer` | Drafts the HTML document from the approved markdown |
| `visual-layout-auditor` | Reviews visual design, layout, typography, color scheme |
| `technical-html-auditor` | Reviews HTML structure, semantics, self-containedness |
| `script-security-auditor` | Reviews inline scripts for XSS, CSP, security issues |
| `interactive-enhancer` | Final pass adding lightweight interactivity |

### 9.3 Design Loop

```
designHtml (round 0)
    │
    ▼
runDesignAudits (parallel)
    │
    ▼
aggregateDesignConsensus
    │
    ├── approved ──► final.html
    ├── approved_with_caveats ──► final.html (minor issues only)
    ├── needs_revision ──► reviseDesignHtml → loop
    └── failed_non_convergent ──► best-effort HTML saved
```

### 9.4 HTML Integrity

The system validates HTML structural completeness:
- Checks for closing `</html>` and `</body>` tags
- Verifies balanced `<script>` / `</script>` pairs
- Strips LLM preamble (thinking text before `<!DOCTYPE` or `<html>`)
- Strips markdown code fences wrapping the HTML
- On truncation, falls back to the previous round's HTML

---

## 10. Checkpointing & Persistence

### 10.1 Custom SQLite Checkpointer (`src/checkpointer.ts`)

Implements `BaseCheckpointSaver` from `@langchain/langgraph-checkpoint` using **bun:sqlite`**:

- **Two tables**: `checkpoints` (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint blob, metadata blob) and `writes` (pending writes with task_id, idx, channel)
- **WAL mode**: Enabled for concurrent read performance
- **Version migration**: Handles checkpoint format migration (v < 4 → v4 pending sends)
- **Deduplication**: `putWrites` skips existing writes to handle replay

### 10.2 Run Artifacts (`src/output.ts`)

Each run produces a directory at `runs/{slug}-{requestId}/`:

| Artifact | Description |
|---|---|
| `request.json` | Initial request metadata |
| `draft-round-{N}.md` | Each draft revision |
| `audits-round-{N}.json` | All audit records for a round |
| `audit-{agent}-round-{N}.json` | Individual audit results |
| `aggregated-findings-round-{N}.json` | Consensus results |
| `drafter-finding-review-round-{N}.json` | Drafter's review of findings |
| `auditor-rebuttal-responses-round-{N}-turn-{M}.json` | Auditor rebuttal responses |
| `drafter-rebuttal-review-round-{N}.json` | Drafter's rebuttal review |
| `rebuttals-{agent}-round-{N}.json` | Tempered rebuttal data sent to auditors |
| `disputed-round-{N}.json` | Disputed findings for re-review |
| `final.md` | Approved final draft |
| `failure.json` | Failure metadata |
| `summary.json` | Run summary |
| `debug-log.jsonl` | Structured debug events |
| `design-html-round-{N}.html` | Design quorum drafts |
| `design-audit-{agent}-round-{N}.json` | Design audit results |
| `final.html` | Approved design HTML |
| `reader-profile.json` | Reader discovery profile |
| `reader-reply-turn-{N}.json` | Reader interview replies |

### 10.3 Slug Generation

Run directory names are human-readable slugs:
- Topics: first ~32 chars lowercase hyphenated
- Documents: first meaningful line from the document
- UUID appended for uniqueness

---

## 11. TUI Application

### 11.1 Overview

The terminal UI (`src/tui/`) is built on **OpenTUI React** (`@opentui/react`), a React-based terminal UI framework. It provides three screens:

### 11.2 Screen Flow

```
┌─ Prompt Screen ─────────────────────────┐
│  Text input for topic or document path   │
│  Tab toggles mode (topic ↔ document)     │
│  Enter starts the run                    │
│  Ctrl-C quits                            │
└──────────────────────────────────────────┘
         │
         ▼ (on run start)
┌─ Running Screen ────────────────────────┐
│  Per-agent panels showing:               │
│  - Current graph node and round          │
│  - Elapsed time                          │
│  - Active agents with tool names         │
│  - Live tool calls, reasoning, text      │
│  View-server URL for full detail         │
│  Ctrl-C cancels                          │
└──────────────────────────────────────────┘
         │
         ▼ (on complete/error)
┌─ Summary Screen ────────────────────────┐
│  Final verdict, summary, and stats       │
│  Options to view details or rerun        │
│  Design quorum kickoff (if enabled)      │
└──────────────────────────────────────────┘
```

### 11.3 State Management

Uses **Zustand** for state management with two stores:

1. **`RunStore`** (`state/runStore`): Tracks all run events — lifecycle, graph nodes, agent sessions, tools, permissions, messages, results
2. **`SystemStatusStore`** (`state/systemStatus`): Tracks system-level state (provider readiness, connection status)

`bindBusToStore()` connects the event bus to the Zustand store, translating every `RunnerEvent` into store updates.

### 11.4 Key UI Components

| Component | File | Purpose |
|---|---|---|
| `PromptScreen` | `components/PromptScreen.tsx` | Topic/document input |
| `Dashboard` | `components/Dashboard.tsx` | Main run visualization |
| `RunningScreen` | `components/RunningScreen.tsx` | Live agent activity panels |
| `SummaryScreen` | `components/SummaryScreen.tsx` | Post-run results |
| `SystemStatusSurface` | `components/SystemStatusSurface.tsx` | Provider/connection status |

### 11.5 Entry Points

- **`bun run dev`**: Launches `src/tui/index.tsx` — the full TUI application
- **`bun run view`**: Launches the standalone web view server
- **`bun run design <run-dir>`**: Re-runs the design quorum for an existing approved run

---

## 12. Web View Server

The view server (`src/view/server/`) provides a real-time web dashboard for observing and interacting with runs. It:

- Serves run details at `http://localhost:3000/runs/{requestId}`
- Shows the reader interview form (human-in-the-loop)
- Provides full transcript of agent activity
- Displays artifacts, drafts, audit results, and findings
- Enables design quorum kickoff from the web UI

The view server is started separately via `bun run view`.

---

## 13. Prompt Asset Management

### 13.1 Asset Loading (`src/prompt-assets.ts`)

Prompt templates are loaded from the filesystem in `assets/prompts/` or from a SQLite config store. The `PromptBundle` encapsulates all assets:

```typescript
type PromptBundle = {
  source: "sqlite" | "local";
  label: string;
  dir: string;
  assets: Record<PromptAssetKey, string>;
};
```

### 13.2 Prompt Asset Files

| Asset Key | Purpose |
|---|---|
| `deepDiveContract` | System-level contract for deep dive documents |
| `draftFullDraft` | Instruction template for initial draft |
| `reviseDraft` | Instruction template for revision rounds |
| `audit` | Audit instruction template (with `{deltaContext}` and `{readerContext}`) |
| `reviewFindings` | Drafter review of auditor findings |
| `rebuttal` | Auditor rebuttal response |
| `reviewRebuttalResponses` | Drafter review of rebuttal responses |
| `readerInterview` | Reader discovery interview prompt |
| `designHtml` | Initial HTML design prompt |
| `auditDesign` | Design audit prompt |
| `auditScriptSecurity` | Script-specific security audit prompt |
| `reviseDesign` | Design revision prompt |

### 13.3 Asset Resolution

Loading order:
1. Try SQLite config store (`loadPromptAssetsFromStore`)
2. Fall back to filesystem (`assets/prompts/` directory)

The `promptManagement.label` field tracks which prompt version was used for a given run.

---

## 14. Configuration System

### 14.1 Configuration Sources

Configuration is loaded from:
1. **Environment variables** (loaded via `dotenv` from `.env`)
2. **`quorum.config.json`** (quorum-specific settings)
3. **SQLite config store** (dynamic config stored in `runs/quorum-config.sqlite`)

### 14.2 Key Configuration Sections

```typescript
type RuntimeConfig = {
  env: {
    OPENCODE_BASE_URL: string;          // http://127.0.0.1:4096
    OPENCODE_DIRECTORY: string;         // workspace root
    QUORUM_WORKSPACE_DIRECTORY: string;
    QUORUM_CHECKPOINT_PATH: string;     // runs/checkpoints.sqlite
    QUORUM_CONFIG_DB_PATH: string;      // runs/quorum-config.sqlite
    QUORUM_CAPTURE_OPENCODE_EVENTS: "0" | "1";
    QUORUM_CAPTURE_SYNC_HISTORY: "0" | "1";
    CURSOR_API_KEY?: string;
    LANGFUSE_PUBLIC_KEY?: string;
    LANGFUSE_SECRET_KEY?: string;
    LANGFUSE_BASE_URL?: string;
  };
  quorumConfig: {
    designatedDrafter: string;
    auditors: string[];
    summarizerAgent: string;
    maxRounds: number;
    maxRebuttalTurnsPerFinding: number;
    recursionLimit: number;
    requireUnanimousApproval: boolean;
    artifactDir: string;
    promptAssetsDir: string;
    promptManagement: { source: "local" | "langfuse"; label: string };
    researchTools: { prefer: string[]; webSearchProvider: string };
    designQuorum?: { enabled: boolean; designatedDesigner: string; auditors: string[]; maxRounds: number };
    auditRestart: { maxRestarts: number };
    readerDiscovery: { maxTurns: number; enabled: boolean };
    agentRuntime: { defaultProvider: string; roles: Record<string, { provider?: string; model?: string; variant?: string }> };
  };
};
```

---

## 15. Key Files & Their Roles

### Core Pipeline

| File | Role |
|---|---|
| `src/runner.ts` | Pipeline orchestration — creates graph, manages lifecycle, handles errors/recovery |
| `src/graph.ts` | LangGraph state graph — all nodes, routing, prompt composition, consensus |
| `src/schema.ts` | All Zod schemas — research state, audit results, rebuttals, findings, design |
| `src/config.ts` | Configuration loading and validation |
| `src/design-quorum.ts` | Design quorum loop — drafting, auditing, consensus, revision |

### Agent Communication

| File | Role |
|---|---|
| `src/opencode.ts` | Direct OpenCode SDK integration — session creation, prompting, permission replies |
| `src/opencode-event-bridge.ts` | OpenCode event stream → internal event bus bridge |
| `src/agent-runtime/runtime.ts` | Agent runtime — provider resolution, prompt dispatch, file inlining |
| `src/agent-runtime/structured-output.ts` | Structured output recovery — fault classification, repair prompts, JSON coercion |
| `src/providers/registry.ts` | Provider registry — lookup by ID, role-to-provider resolution |
| `src/providers/opencode.ts` | OpenCode provider implementation |
| `src/providers/cursor.ts` | Cursor provider implementation |
| `src/providers/types.ts` | Provider interface types |

### Persistence & Output

| File | Role |
|---|---|
| `src/checkpointer.ts` | `BunSqliteSaver` — custom LangGraph checkpoint saver using bun:sqlite |
| `src/output.ts` | Run directory management, artifact writing, slug generation |
| `src/debug-log.ts` | Structured JSONL debug logging |
| `src/live-status.ts` | Real-time status file for the web view server |
| `src/config-store.ts` | SQLite-backed config store for prompts and runtime settings |
| `src/summarizer.ts` | Input document and artifact summarization |

### Observability

| File | Role |
|---|---|
| `src/telemetry.ts` | Langfuse OpenTelemetry integration — trace creation, observation lifecycle |
| `src/audit-restart.ts` | Fresh-session restart wrapper for structured output failures |

### UI

| File | Role |
|---|---|
| `src/tui/App.tsx` | Main application controller — screen management, run coordination |
| `src/tui/index.tsx` | Entry point — TUI bootstrap |
| `src/tui/components/Dashboard.tsx` | Main run visualization |
| `src/tui/components/PromptScreen.tsx` | Topic/document input |
| `src/tui/components/RunningScreen.tsx` | Live agent activity panels |
| `src/tui/components/SummaryScreen.tsx` | Post-run results |
| `src/tui/state/runStore.ts` | Zustand store for run events |
| `src/tui/state/eventBindings.ts` | Event bus → store bindings |
| `src/view-server.ts` | Web view server entry |

### Debug & Recovery

| File | Role |
|---|---|
| `src/recovery-drift.ts` | Systemic drift detection — same agent started across distinct runs |
| `src/opencode.ts` (dual-output detection) | Detects divergent file vs inline output |

---

## 16. Lifecycle of a Run

### Phase 1: Startup

1. **TUI boots** → loads config, validates provider prerequisites (`validateProviderPrerequisites`)
2. **Prompt screen** → user enters topic (or document path)
3. **Run starts** → `runResearchPipeline()` is called
   - Creates event bus
   - Creates Zustand store
   - Binds store to bus
   - Creates Langfuse telemetry run
   - Starts OpenCode event bridge
   - Creates agent runtime

### Phase 2: Graph Init

4. **`ingestRequest`** → validates input, creates initial state
5. **`summarizeInputDocument`** → if document mode, summarizes the source
6. **`prepareOutputPath`** → creates run directory, writes `request.json`

### Phase 3: Reader Discovery (optional)

7. **`discoverReaderPrompt`** → interviewer agent asks questions
8. **`discoverReaderResume`** → human replies via interrupt/resume
9. Loop until profile complete or budget exhausted

### Phase 4: Drafting

10. **`draftFullDraft`** → drafter writes `draft-round-0.md`
11. Status → `auditing`

### Phase 5: Auditing & Rebuttal

12. **`runParallelAudits`** → all auditors review in parallel
13. **`reviewFindingsByDrafter`** → drafter accepts/rebuts findings
14. **`runTargetedRebuttals`** → auditors respond to rebuttals
15. **`reviewRebuttalResponses`** → drafter reviews responses
16. Loop step 14-15 until all settled

### Phase 6: Consensus

17. **`aggregateConsensus`** → determines outcome
18. If `needs_revision`: drafter revises, go to Phase 5
19. If `approved`: go to Phase 7
20. If `failed`: go to Phase 8

### Phase 7: Approval

21. Write `final.md`, `summary.json`
22. Run artifact summarization (`summarizeMarkdown`)
23. If design quorum enabled → Phase 7b

### Phase 7b: Design Quorum

24. `designHtml` → initial HTML from markdown
25. `runDesignAudits` → parallel design review
26. `aggregateDesignConsensus` → outcome
27. `reviseDesignHtml` → revision loop
28. Write `final.html`

### Phase 8: Finalization

29. Write run summary to state
30. End telemetry trace with metadata
31. Emit `lifecycle:complete` event
32. Cleanup: dispose sessions, stop bridge, close debug log

### Phase 9: Recovery (on failure)

33. Checkpoint recovery → extract latest state
34. Write failure artifacts (`latest-draft.md`, `failure.json`)
35. Abort all OpenCode sessions
36. Emit `lifecycle:error` event

---

## 17. Agent Definitions

Agents are defined in `.opencode/agents/` and loaded by the OpenCode server. Each agent has a unique name and configuration.

### Research Quorum Agents

| Agent Name | Role |
|---|---|
| `research-drafter` | Writes the initial draft and all revisions; reviews findings and rebuttals |
| `source-auditor` | Audits source quality, citation accuracy, evidence breadth |
| `logic-auditor` | Audits argument structure, reasoning, logical flow |
| `clarity-auditor` | Audits clarity, readability, appropriate depth for the reader |
| `markdown-summarizer` | Summarizes input documents and final artifacts (post-run) |

### Design Quorum Agents

| Agent Name | Role |
|---|---|
| `html-designer` | Converts approved markdown into self-contained HTML |
| `visual-layout-auditor` | Reviews visual design, layout, typography, color scheme |
| `technical-html-auditor` | Reviews HTML structure, accessibility, self-containedness |
| `script-security-auditor` | Reviews inline scripts for XSS, CSP, security issues |
| `interactive-enhancer` | Final pass adding lightweight interactivity |

### Support Agents

| Agent Name | Role |
|---|---|
| `reader-interviewer` | Conducts the adaptive reader discovery interview |
| `json-fixer` | Recovers malformed JSON in the structured output recovery router |

---

## 18. Recovery & Drift Detection

### 18.1 Structured Recovery Error

The `StructuredRecoveryError` class (`src/agent-runtime/structured-output.ts`) is the standard typed error for all structured output failures. It carries `fault`, `attempts`, and `lastError` for diagnostic use.

### 18.2 Audit Restart (`src/audit-restart.ts`)

When the in-session recovery router exhausts its budget and throws `StructuredRecoveryError`, `auditWithRestart()` tears down the failing session and re-runs the identical audit on a brand-new OpenCode session.

- **Kill-switch**: `auditRestart.maxRestarts = 0` disables fresh-session restarts entirely
- **Drift detection**: The `RecoveryDriftDetector` (`src/recovery-drift.ts`) tracks restart attempts per agent. If the same agent is restarted across two distinct `requestId`s, systemic drift is suspected and the run fails loudly with `SystemicDriftError` instead of silently looping.

### 18.3 Recovery Event Log

Every recovery action emits a structured debug event to `debug-log.jsonl`:

| Event | Meaning |
|---|---|
| `session.recovery.classify` | Fault classified with remaining budgets |
| `session.recovery.reprompt` | Same-agent in-session reprompt |
| `session.repair.json_fixer` | `json-fixer` agent invoked |
| `audit.restart_from_scratch` | Fresh-session audit restart |
| `session.dual_output` | File vs inline JSON divergence |
| `session.prompt` | Raw prompt sent to agent |
| `session.empty_response` | Agent returned empty text (with continue attempt tracking) |
| `session.transport_retry` | Transport-level retry |
| `recovery.systemic_drift` | Same agent restarted across distinct runs |
| `pipeline.start` / `pipeline.complete` / `pipeline.error` | Pipeline lifecycle |
| `reader.interview_suspend` / `reader.interview_resume` | Reader discovery HITL |

### 18.4 Permission Handling

The system can handle agent permission requests (file access, shell commands) via:
1. **OpenCode bridge**: Forwards `permission.asked` and `permission.replied` events
2. **Auto-reply**: The bridge can automatically reply to permission requests (configured via OpenCode's always-allowed patterns)
3. **Manual reply**: The `replyToPermission()` function in `src/opencode.ts` supports manual intervention

---

## Appendix: Debugging Quick Reference

### Common Debug Commands

```bash
# View a specific run's structured debug log
cat runs/my-topic-*/debug-log.jsonl | jq .

# Check recovery events only
grep recovery runs/my-topic-*/debug-log.jsonl | jq .

# Find all agent sessions created
grep 'session.created' runs/my-topic-*/debug-log.jsonl | jq .

# Check if pipeline crashed
grep 'pipeline.error' runs/my-topic-*/debug-log.jsonl | jq .

# View the checkpoint database
bun -e "
  const db = new Bun.Sqlite('runs/checkpoints.sqlite');
  console.log(db.query('SELECT thread_id, checkpoint_id, parent_checkpoint_id FROM checkpoints ORDER BY checkpoint_id DESC LIMIT 10').all());
"

# List all run directories
ls -la runs/ | grep -E '^d'
```

### Common Debug Log Queries

```bash
# Find all structured recovery attempts in a run
grep 'session.recovery.classify' debug-log.jsonl | jq -c '{type, fault, attempt, budgetSameAgentLeft, budgetJsonFixerLeft}'

# Check for truncated JSON
grep 'truncated' debug-log.jsonl | jq .

# Find transport errors
grep 'transport' debug-log.jsonl | jq .

# View pipeline timing
grep 'pipeline' debug-log.jsonl | jq -c '{type, ts, status: .round, outputPath}'
```

---

> **End of document.**
>
> This document captures the complete state of the research-qurom project as of July 2026.
> It is intended to serve as both an architectural reference and an onboarding guide for
> developers working on any part of the system.
