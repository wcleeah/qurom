# Implementation Plan: OpenCode Research Quorum Orchestrator

## Prelude: What LangGraph Is and Why It Fits Here

### What this section is answering

What is LangGraph in plain English, and why is it the right outer runtime for this build?

### Short answer

LangGraph is a low-level workflow engine for long-running LLM systems. Instead of writing one long agent prompt and hoping the model keeps the process straight, you define a state machine in code. Each node reads and writes shared state, and routing logic decides what happens next.

For this project, that matters because your problem is not "get one model to write a document." Your problem is "run a designated drafter, gather audits, handle rebuttals, track rounds, and stop correctly." That is workflow control, which is what LangGraph is built for.

### Concrete example

For the topic `How Raft leader election works`, the orchestrator needs to:

1. ingest the topic
2. ask the designated drafter for a first draft
3. fan out to several auditors
4. aggregate votes
5. let the drafter rebut invalid findings
6. route rebuttals back to the relevant auditor
7. decide whether consensus exists or another round is needed
8. save the final result and trace the whole process

That is a graph, not a single completion.

### Core LangGraph terms used in this plan

- `state`: the shared object that moves through the workflow. Here it includes the draft, audits, rebuttals, votes, round number, and final status.
- `node`: one unit of work. Example: `draftInitial`, `runParallelAudits`, or `aggregateConsensus`.
- `edge`: the path from one node to the next.
- `conditional edge`: routing logic in code. Example: if all auditors approve, go to `finalizeApprovedDraft`; otherwise go to `rebuttalOrRevision`.
- `checkpointer`: the persistence layer that stores workflow progress so a run can resume after interruption or failure.
- `thread_id`: the durable identifier for one workflow run. LangGraph uses it to look up saved state.
- `interrupt()`: a built-in pause point for human-in-the-loop approval or editing.
- `Command({ resume })`: the mechanism used to continue a paused graph.

### How it works

LangGraph gives you three things that matter here.

1. Durable execution.

If the orchestrator crashes after round 2, you do not want to re-run round 1 from scratch. LangGraph checkpointers persist state and let you continue from the saved workflow thread.

2. Explicit routing.

The decision to approve, rebut, revise, or fail should live in code, not in hidden model behavior.

3. Future human review support.

Even if v1 is fully automated, the same graph can later add `interrupt()` before publishing a final research document or before accepting a disputed auditor finding.

### Why this matters here

Without LangGraph, you can still write a loop, but you lose a lot of the machinery that makes long-running agent workflows easier to inspect, resume, and reason about. Since your system is explicitly multi-step and consensus-driven, LangGraph is a good fit.

### Risks or tradeoffs

- LangGraph is lower-level than a prebuilt agent helper, so you write more orchestration code yourself.
- That extra code is worthwhile here because your workflow is bespoke: designated drafter, quorum auditors, rebuttals, and bounded consensus.

### Sources

- LangGraph JS Overview: `https://docs.langchain.com/oss/javascript/langgraph/overview`
- LangGraph JS Persistence: `https://docs.langchain.com/oss/javascript/langgraph/persistence`
- LangGraph JS Interrupts: `https://docs.langchain.com/oss/javascript/langgraph/interrupts`

## 1. Goal

Build a small, debuggable research orchestrator that:

- accepts either a topic or a source document as input
- uses one designated OpenCode drafter agent to produce the first markdown draft
- uses a fixed quorum of OpenCode auditor agents, each on its own model, to audit the draft
- loops draft -> audit -> rebuttal/review -> revise until every auditor votes `approve` or the run hits a bounded failure condition
- records the run in Langfuse so you can inspect rounds, votes, rebuttals, revisions, and failures
- writes the final approved document to disk as markdown

The target end state is not "many agents talking freely." The target end state is one controlled loop with clear state, clear stopping rules, and clear telemetry.

Running example used throughout this plan: the user submits the topic `How Raft leader election works`, the designated drafter writes a first deep-dive draft using your `deep-dive-research` skill, three auditors critique it, the drafter accepts some findings and rebuts others, disputed findings go back to the relevant auditor, and the system stops only when all three auditors approve.

## 2. Starting Point, Driving Problem, and Finish Line

### Starting point

Confirmed:

- the current repo contains `SKILL.md`, `IMPLEMENTATION_PLAN.md`, and a local checkout of `opencode/`
- `SKILL.md` defines a strong deep-dive writing contract, including source-backed claims, a required structure, and explicit expectations for throughline, examples, and plain language (`/Users/leewingcheung/Documents/research-qurom/SKILL.md:1-238`)
- there is no research orchestrator scaffold yet: no Bun app, no orchestrator code, no repo-local OpenCode agent definitions for this quorum system, no LangGraph graph, and no Langfuse instrumentation
- you stated that the `deep-dive-research` skill already exists in your OpenCode config directory, so the plan should treat the skill as available by name rather than requiring a repo-local move
- you cloned the OpenCode source into `opencode/`, which lets us verify server and SDK behavior directly instead of relying only on docs

### Driving problem

You want a quorum of agents that can do deep research with:

- different models per agent
- one designated drafter chosen by config, not at random
- topic or document input
- a first draft constrained by your attached skill
- auditor agents that check sources, coherence, and anything worth auditing
- a voting loop that forces revision until consensus
- a rebuttal loop where the designated drafter can challenge bad auditor findings and the relevant auditor can answer that challenge until the disagreement resolves
- telemetry so you can inspect what happened

Today, none of the control flow, state, stopping conditions, disagreement handling, or observability exists. If you build this as an ad hoc swarm, the likely result is a system that is hard to debug, hard to trace, and prone to looping forever.

### Finish line

Successful end state:

- one command creates a research run from a topic or text document
- the orchestrator creates one draft, runs parallel structured audits, manages rebuttals, aggregates votes, and loops predictably
- each OpenCode worker has a fixed role and fixed model by config
- the final approved markdown document is saved to disk
- Langfuse shows one trace for the run and nested observations for every round, agent call, audit result, rebuttal, and final outcome
- OpenCode events can optionally enrich the trace with session-level progress, tool execution, permission requests, and persisted sync history

Why this changes the plan:

Because the repo is greenfield, the right first build is the smallest vertically integrated slice: one external orchestrator, one OpenCode server, one durable state machine, one trace per run. Do not start with multiple autonomous agents invoking each other.

## 3. Constraints and Assumptions

### Confirmed constraints

- OpenCode provides a headless HTTP server via `opencode serve` and a JS/TS SDK for programmatic control. It also exposes sessions, messages, agents, and events. Source: OpenCode Server docs; OpenCode SDK docs.
- OpenCode agents can be defined with fixed `model`, `prompt`, `mode`, and permissions. Source: OpenCode Agents docs.
- OpenCode skills are discovered from `.opencode/skills/<name>/SKILL.md`, `.agents/skills/<name>/SKILL.md`, or global config locations. You stated that `deep-dive-research` already exists in your OpenCode config directory, so the orchestrator can assume that skill is available to agents by name. Source: OpenCode Skills docs.
- The local `opencode/` source confirms there is a real `app.skills` API in the newer SDK surface, so the orchestrator can deterministically check whether `deep-dive-research` is visible at startup. Source: `opencode/packages/opencode/src/server/instance/index.ts`, `opencode/packages/sdk/js/src/v2/gen/sdk.gen.ts`.
- OpenCode SDK supports structured JSON output from model responses via a JSON schema option shown in the SDK docs.
- The local `opencode/` source confirms the generated SDK uses `format` for structured output on prompt/message endpoints. Source: `opencode/packages/sdk/js/src/v2/gen/types.gen.ts`.
- LangGraph JS provides durable execution, persistence, checkpoints, and `thread_id`-based resume. Source: LangGraph JS overview and persistence docs.
- LangGraph JS supports `interrupt()` and `Command({ resume })` for pause and resume flows when human review is later needed. Source: LangGraph JS interrupts docs.
- Langfuse JS/TS supports manual tracing with observation types such as `agent`, `chain`, `tool`, `generation`, and `evaluator`. Source: Langfuse instrumentation and observation types docs.
- The local `opencode/` source confirms that `/event` is a real server-sent event stream backed by the project bus, and `/global/event` is a global SSE stream backed by `GlobalBus`. Source: `opencode/packages/opencode/src/server/instance/event.ts`, `opencode/packages/opencode/src/server/instance/global.ts`.
- The local `opencode/` source also confirms that sync events are persisted in the event tables and are exposed through `/sync/history` and `/sync/replay` in the v2 API. Source: `opencode/packages/opencode/src/sync/sync-event.ts`, `opencode/packages/opencode/src/server/instance/sync.ts`, `opencode/packages/sdk/js/src/v2/gen/sdk.gen.ts`.

### Inferred assumptions

- Use Bun plus TypeScript for v1. This is the smallest correct language choice because OpenCode's first-party SDK is JS/TS, LangGraph has a JS package, Langfuse has a JS/TS tracing package, and you explicitly want Bun as runtime and package manager.
- Start with one OpenCode server for all workers. Separate sessions are enough for v1 because all agents share one workspace and one tool environment.
- V1 should be a CLI-first system. Adding an HTTP API before the loop is stable adds infrastructure without changing the core problem.
- V1 should support topic input and plain text or markdown document input first. PDF and DOCX ingestion can wait until the loop is stable.

### Tooling assumptions for research

- Research-capable tools such as Context7, Exa, and Grep.app should be available to the relevant OpenCode agents through permissions and agent configuration, not copied wholesale into the skill text.
- The skill should define the research standard and decision rules. The agent prompt should define role-specific behavior and which tool families to prefer.

Why this changes the plan:

These constraints point to a simple stack: Bun + TypeScript + LangGraph + one OpenCode server + Langfuse at the orchestrator boundary, with OpenCode `/event` and `/sync/history` as optional enrichment layers. They also remove the earlier need to relocate the skill inside this repo, because you said the skill already exists in OpenCode config.

## 4. Current State

### What this section is answering

What do we actually have right now, and what is missing?

### Short answer

You already have the writing contract for the drafter and a local copy of the OpenCode implementation, but you do not yet have the system that can enforce roles, run the loop, handle rebuttals, or observe it end to end.

### Concrete example from this repo

Current repo state:

```text
research-qurom/
  IMPLEMENTATION_PLAN.md
  opencode/
  SKILL.md
```

That means you now have two useful assets:

- the deep-dive writing contract in `SKILL.md`
- a full local checkout of OpenCode source that lets us verify the server, SDK, event streams, and sync-history APIs directly

### How it works

Your current `SKILL.md` already does the hard product work for the drafter. It says the first draft must:

- make the starting confusion explicit
- keep one throughline
- use a running example
- tie claims to sources
- distinguish certainty levels
- include a final `Sources` section

That means the drafter's quality bar is already defined. The missing pieces are:

- how the drafter is chosen
- how other agents audit it
- how disagreements are rebutted and resolved
- how votes are represented
- how revisions are requested
- how convergence is enforced
- how traces are collected

### Why this matters here

The repo is not missing "more prompt ideas." It is missing the mechanism that turns one good skill into a repeatable research workflow.

### Risks or tradeoffs

- If you let the drafter and auditors all share one chat session, context will bleed between roles and audits will become less trustworthy.
- If you treat SSE as the only telemetry source, you will have a live feed but a weaker post-run reconstruction story than a system that also records Langfuse traces and, where useful, reads persisted sync history.

### Sources

- `/Users/leewingcheung/Documents/research-qurom/SKILL.md:1-238`
- `/Users/leewingcheung/Documents/research-qurom` directory listing

## 5. What Is Actually Causing the Problem

### What this section is answering

Why is this hard, even though the pieces already exist?

### Short answer

The real problem is not model access. The real problem is that quorum workflows fail when control flow, audit format, rebuttal handling, and stopping conditions are implicit.

### Concrete example

Take the running example `How Raft leader election works`.

If you simply ask four agents to "collaborate," you will likely get:

- one agent rewriting structure
- one agent asking for more sources without saying which claims are unsupported
- one agent nitpicking style forever
- no clear definition of what a vote means
- no bounded condition for ending the loop
- no formal way for the drafter to challenge a bad auditor finding

That is not a quorum system. It is four unstructured opinions.

### How it works

There are six separate failure causes.

1. No external owner of the loop.

If OpenCode agents orchestrate each other directly, the stopping rule lives inside model behavior instead of code. That makes the workflow hard to reproduce and hard to trace.

2. No structured audit contract.

If auditors answer in free text, the drafter cannot reliably tell which issues are blockers, which are duplicates, and which were already fixed.

3. No guaranteed skill loading.

OpenCode skills are loaded on demand. If the drafter is not explicitly instructed to load the skill, your best writing contract becomes optional behavior.

4. No bounded convergence rule.

Unanimity is fine as a goal, but it needs hard limits such as `maxRounds` and stagnation detection. Otherwise the system can loop forever on minor wording differences.

5. No orchestration-level telemetry.

Langfuse can trace the outer workflow, but only if you wrap the orchestrator's nodes and agent calls. Otherwise you know a run failed, but not which round or which auditor blocked it.

6. No formal disagreement protocol.

Auditors are not always correct. If the drafter cannot challenge a weak or incorrect audit, the system rewards stubborn reviewers instead of accuracy.

### Why this matters here

These causes tell us where the design must be strict:

- LangGraph owns state and routing
- OpenCode workers are role-specific black boxes
- audits are JSON, not prose
- rebuttals are first-class workflow objects, not ad hoc follow-up text
- revisions are driven by normalized findings
- consensus is bounded and observable

### Risks or tradeoffs

- A stricter schema makes prompts less free-form, but that is exactly what you want for reliable auditing.
- One external orchestrator is less "agentic" than a swarm, but it is far easier to debug and verify.

### Sources

- OpenCode SDK docs
- LangGraph overview docs
- LangGraph persistence docs
- Langfuse instrumentation docs

## 6. Options Considered

### Option A: One OpenCode server per agent

What it is:

- start a separate `opencode serve` process for the drafter and for each auditor
- point the orchestrator at multiple server URLs

What it changes:

- each agent gets hard isolation for config, tools, credentials, and workspace process state

Pros:

- strongest isolation
- easiest path if agents need different environment variables or different filesystem access
- one broken agent server does not poison all workers

Cons:

- more ports, more startup cost, more lifecycle management
- more credentials and config duplication
- harder local development for a greenfield repo
- more telemetry plumbing because each worker is a separate service boundary

When it makes sense:

- different agents need different secrets or different workspaces
- you want fault isolation more than simplicity

Why it is rejected for v1:

Nothing in the current repo suggests you need hard isolation yet. This adds infrastructure before proving the loop.

### Option B: One OpenCode server, multiple named OpenCode agents, LangGraph outside it

What it is:

- run one OpenCode server
- configure multiple named agents with fixed models and permissions
- let LangGraph choose which agent to call and when

What it changes:

- roles are explicit in code and config, but workers still share one tool environment and one workspace

Pros:

- smallest correct system
- easy to debug locally
- fixed roles and models by config
- sessions give you clean conversational boundaries
- fewer moving parts than a multi-server design

Cons:

- less hard isolation than multiple servers
- careless session reuse can cause context leakage

When it makes sense:

- all agents operate on the same workspace and tool environment
- you want to ship v1 fast and keep the loop observable

Why it is accepted:

This is the best tradeoff for the repo you have now.

### Option C: Skip LangGraph and write the loop manually

What it is:

- write an imperative `while` loop in a script or service without LangGraph

What it changes:

- removes graph setup and checkpointer work

Pros:

- fastest spike
- simplest mental model for a same-day prototype

Cons:

- no built-in durable execution
- no checkpoint history
- harder to add human review later
- state transitions become ad hoc very quickly

When it makes sense:

- a throwaway proof of concept that you do not plan to keep

Why it is rejected for the main build:

The point of this system is repeatable orchestration. You want state, not just loops.

### Option D: Use OpenCode event streams as the primary telemetry system

What it is:

- subscribe to `/event` or `/global/event`
- derive run traces, timings, and post-run analytics entirely from OpenCode events

What it changes:

- moves telemetry ownership toward OpenCode internals instead of the outer orchestrator

Pros:

- captures session and part-level progress directly from the server
- includes tool-part states, permission requests, session errors, and live updates
- `/sync/history` gives a persisted event log in v2 for replay and backfill

Cons:

- event payloads are OpenCode-centric, not evaluation-centric
- no built-in notion of Langfuse observation types like `agent`, `evaluator`, or `chain`
- no built-in trace tree for your custom research workflow
- harder to compare runs, attach quality scores, or correlate business-level states like `rebuttal accepted`

When it makes sense:

- you want a live operator console for OpenCode activity
- you want to enrich orchestrator telemetry with lower-level server events

Why it is rejected as the primary telemetry system:

It is useful, but it is the wrong top-level abstraction. Langfuse should stay the system of record for workflow traces. OpenCode events should be an enrichment source.

### Why this changes the plan

Option B wins for orchestration, and Option D is accepted only as a secondary telemetry source. Build one orchestrator in LangGraph, point it at one OpenCode server, treat named OpenCode agents as workers, and use OpenCode events only to enrich Langfuse traces or to backfill post-run details.

### Sources

- OpenCode Server docs
- OpenCode SDK docs
- OpenCode Agents docs
- LangGraph overview docs
- LangGraph persistence docs

## 7. Recommended Approach

### What this section is answering

What should you actually build first?

### Short answer

Build a Bun + TypeScript CLI orchestrator that uses LangGraph as the outer state machine, one OpenCode server as the worker runtime, structured JSON audits plus structured rebuttals as the quorum contract, Langfuse as the trace layer, and OpenCode `/event` plus `/sync/history` as optional telemetry enrichment.

### Concrete example

For the request `How Raft leader election works`:

1. the orchestrator validates the input and creates a `requestId`
2. it opens one persistent drafter session on the OpenCode server
3. it prompts the `research-drafter` agent to load `deep-dive-research` and write the first draft
4. it creates fresh audit calls for `source-auditor`, `logic-auditor`, and `clarity-auditor`
5. each auditor returns JSON with `vote`, `summary`, and `findings`
6. the designated drafter reviews findings and either accepts them or issues structured rebuttals
7. only the auditors targeted by those rebuttals answer them; they can uphold, soften, or withdraw the original finding
8. the orchestrator aggregates the updated position set, decides whether consensus is complete, and if not, prompts the drafter with only the still-valid unresolved findings
9. once all votes are `approve`, it writes `runs/<requestId>/final.md`

### How it works

Use this repo shape for v1:

```text
research-qurom/
  IMPLEMENTATION_PLAN.md
  package.json
  tsconfig.json
  .gitignore
  quorum.config.json
  .env.example
  .opencode/
    agents/
      research-drafter.md
      source-auditor.md
      logic-auditor.md
      clarity-auditor.md
  src/
    index.ts
    config.ts
    schema.ts
    opencode.ts
    graph.ts
    telemetry.ts
    telemetry-enrichment.ts
    output.ts
  runs/
```

Recommended responsibilities:

- `quorum.config.json`: designated drafter, auditor list, `maxRounds`, unanimity rule, rebuttal limits, tool preferences
- `.opencode/agents/*.md`: each role's model, prompt, and permissions
- `src/schema.ts`: zod schemas for inputs, audits, rebuttals, votes, and state
- `src/opencode.ts`: all session and prompt calls to OpenCode
- `src/graph.ts`: LangGraph state, nodes, routing, and checkpointer
- `src/telemetry.ts`: Langfuse wrappers
- `src/telemetry-enrichment.ts`: optional OpenCode SSE and sync-history ingestion
- `src/output.ts`: write run artifacts and final markdown

Recommended worker roles:

- `research-drafter`: the only agent allowed to revise the draft; fixed model by config
- `source-auditor`: checks source quality, claim support, citation completeness
- `logic-auditor`: checks reasoning, contradictions, and section flow
- `clarity-auditor`: checks jargon, readability, and whether the draft matches the deep-dive contract

Recommended research-tool policy:

- give the drafter and auditors access to high-value research tools through agent permissions
- prefer `context7` for official library and framework documentation
- prefer `exa` for web search and web fetch when primary docs are needed
- prefer `grepapp` when checking real usage patterns in public GitHub repositories
- keep these preferences in the role prompts, not in the `deep-dive-research` skill itself

Why this split matters:

- the skill should describe the quality bar for research writing
- the prompt should describe how this role should operate and which tools it should reach for first

Recommended voting contract:

```json
{
  "vote": "approve | revise",
  "summary": "short plain-English assessment",
  "findings": [
    {
      "severity": "blocker | major | minor",
      "category": "sources | coherence | clarity | structure | scope",
      "issue": "what is wrong",
      "evidence": ["url, file path, or quoted section"],
      "required_fix": "what must change"
    }
  ]
}
```

Recommended rebuttal contract:

```json
{
  "targetAgent": "logic-auditor",
  "findingIssue": "The draft claims randomized election timeouts guarantee single leaders",
  "position": "rebut",
  "argument": "Randomized timeouts reduce collision probability but do not guarantee uniqueness in all network conditions.",
  "evidence": ["raft paper section link", "source code path", "quoted draft text"],
  "requestedResolution": "withdraw_or_reclassify"
}
```

Recommended auditor rebuttal response contract:

```json
{
  "targetAgent": "research-drafter",
  "findingIssue": "The draft claims randomized election timeouts guarantee single leaders",
  "decision": "uphold | soften | withdraw",
  "argument": "why the original finding still stands or why it changes",
  "updatedFinding": {
    "severity": "major",
    "category": "coherence",
    "issue": "The wording overstates what randomized timeouts guarantee",
    "evidence": ["source"]
  }
}
```

Recommended LangGraph nodes:

- `ingestRequest`
- `bootstrapRun`
- `draftInitial`
- `runParallelAudits`
- `reviewFindingsByDrafter`
- `runTargetedRebuttals`
- `aggregateConsensus`
- `reviseDraft`
- `finalizeApprovedDraft`
- `finalizeFailedRun`

Recommended Langfuse observation strategy:

- root run: `chain`
- each OpenCode drafter or auditor call: `agent`
- each audit result: `evaluator`
- each rebuttal exchange: `chain`
- aggregation and revision steps: `chain`
- input loading from disk: `tool`

Recommended telemetry layering:

- Langfuse is the primary workflow telemetry system
- OpenCode `/event` is the live, session-scoped event stream
- OpenCode `/global/event` is the cross-project live event stream
- OpenCode `/sync/history` is the persisted event log for post-run reconstruction and backfill

### OpenCode event usefulness for telemetry

The local `opencode/` source materially changes the telemetry recommendation from the earlier draft.

Confirmed from source:

- `/event` streams raw bus events for the current project instance and immediately emits `server.connected` plus heartbeats (`opencode/packages/opencode/src/server/instance/event.ts:12-88`)
- `/global/event` streams global events from `GlobalBus` and wraps them with `directory`, `project`, and `workspace` context (`opencode/packages/opencode/src/server/instance/global.ts:73-138`)
- sync events are persisted in the event tables and can be retrieved through `/sync/history` in the v2 API (`opencode/packages/opencode/src/sync/sync-event.ts:116-164`, `opencode/packages/opencode/src/server/instance/sync.ts:77-117`)
- the generated SDK exposes event subscriptions and sync-history methods in v2 (`opencode/packages/sdk/js/src/v2/gen/sdk.gen.ts:296-306`, `3316-3345`, `3020-3114`, `4294-4390`)

Comparison table:

| Capability | Langfuse | OpenCode `/event` or `/global/event` | OpenCode `/sync/history` | Gap / Recommendation |
| --- | --- | --- | --- | --- |
| Root workflow trace | Native trace tree with nested observations | No workflow tree, only event stream | No workflow tree, only persisted event list | Langfuse should be primary |
| Custom business states like `rebuttal accepted` | Native, easy to model as spans/metadata | Only if you emit your own app logs or derive it externally | Only if you persist and derive it externally | Put these in Langfuse directly |
| Live assistant progress | Possible if you instrument streaming yourself | Yes: `message.updated`, `message.part.updated`, `session.status`, `permission.asked`, `session.error` | Not live; post-run only | Use `/event` as live enrichment |
| Tool lifecycle visibility | Only if you instrument each call yourself | Yes: tool parts include pending/running/completed/error and timings in the SDK event types | Yes, indirectly through persisted sync events and part updates | OpenCode events are strong here |
| Token and cost tracking | Native on `generation` observations | Present on assistant message info and step-finish parts | Present if included in persisted events | Langfuse is better for analytics and dashboards |
| Quality evaluation metadata | Native `evaluator` spans and scores | Not a first-class concept | Not a first-class concept | Keep audit scores/findings in Langfuse |
| Cross-run comparison | Native trace filtering and evaluation workflows | Weak; event stream is per runtime feed | Possible but manual | Langfuse should own this |
| Post-run reconstruction | Good if you logged enough trace detail | Weak if you missed the stream | Stronger: persisted sync event history with seq numbers | Use `/sync/history` for backfill or debugging |
| Session-scoped debugging | Possible, but only what you recorded | Strong: session and part events are explicit | Stronger for historical replay | OpenCode is strong here |
| Vendor-neutral observability | Yes | No, OpenCode-specific | No, OpenCode-specific | Langfuse should remain the top layer |

Bottom line:

- OpenCode events are useful for telemetry
- they are not a replacement for Langfuse
- use Langfuse for the orchestrator's trace of the research workflow
- optionally enrich traces with OpenCode `/event` during runs and `/sync/history` after runs

Recommended persistence strategy:

- use a LangGraph checkpointer from day one
- for local v1, use SQLite rather than in-memory persistence so the run can survive process restarts
- leave Postgres for phase 2, once you prove that the loop is worth hardening

### Why this matters here

This design keeps each concern in the right place:

- OpenCode handles agent execution
- LangGraph handles state and looping
- Langfuse handles observability
- OpenCode events provide optional low-level telemetry enrichment
- your skill handles draft quality

### Risks or tradeoffs

- SQLite adds one dependency, but it buys you real recovery and replay in local development.
- Fresh auditor calls cost more than reusing a long auditor conversation, but they reduce context contamination.
- Keeping the orchestrator outside OpenCode means more code on your side, but much less hidden behavior.

### Sources

- OpenCode Server docs
- OpenCode SDK docs
- OpenCode Agents docs
- OpenCode Skills docs
- LangGraph JS overview docs
- LangGraph JS persistence docs
- Langfuse instrumentation docs
- Langfuse observation types docs

## 8. Step-by-Step Implementation Plan

### Required work

#### Step 1: Create the repo scaffold with Bun

Add these files first:

- `package.json`
- `tsconfig.json`
- `.gitignore`
- `quorum.config.json`
- `.env.example`
- `src/index.ts`
- `src/config.ts`
- `src/schema.ts`
- `src/opencode.ts`
- `src/graph.ts`
- `src/telemetry.ts`
- `src/telemetry-enrichment.ts`
- `src/output.ts`
- `.opencode/agents/research-drafter.md`
- `.opencode/agents/source-auditor.md`
- `.opencode/agents/logic-auditor.md`
- `.opencode/agents/clarity-auditor.md`

Dependencies for v1:

- `@opencode-ai/sdk`
- `@langchain/langgraph`
- `@langchain/core`
- `@langchain/langgraph-checkpoint-sqlite`
- `@langfuse/tracing`
- `zod`
- `dotenv`
- `typescript`
- `tsx` or Bun's direct TS execution only if needed by your chosen script layout

Runtime and package manager:

- use Bun for install, scripts, and local execution
- examples in this plan should use `bun install` and `bun run`, not npm

Why this step comes first:

You need the minimal runtime and config surface before you can prove the loop.

#### Step 2: Bind the existing `deep-dive-research` skill by name

Because you said the skill is already present in the OpenCode config directory, do not duplicate it in this repo unless you later want project-local overrides.

Instead:

- reference the skill by name in the drafter prompt: `deep-dive-research`
- use the OpenCode `app.skills` API at startup to verify the skill is visible
- fail fast if the skill is not visible to the configured drafter role

Why this step comes now:

The drafter's quality contract is still the most valuable asset in the system, but it already exists. The implementation work here is binding, not relocation.

#### Step 3: Define the quorum config

Create `quorum.config.json` with values like these:

```json
{
  "designatedDrafter": "research-drafter",
  "auditors": [
    "source-auditor",
    "logic-auditor",
    "clarity-auditor"
  ],
  "maxRounds": 4,
  "maxRebuttalTurnsPerFinding": 2,
  "requireUnanimousApproval": true,
  "artifactDir": "runs",
  "researchTools": {
    "prefer": ["context7", "exa", "grepapp"],
    "webSearchProvider": "exa"
  }
}
```

Keep orchestration config here, not inside code. The designated drafter rule belongs in data, because you explicitly said it must be chosen by config.

Why this step matters:

This is the line between agent behavior and workflow behavior.

#### Step 4: Define the OpenCode agents

Create one markdown file per role in `.opencode/agents/`.

`research-drafter.md` should:

- set `mode: subagent`
- pin a writing-capable model
- explicitly instruct the agent to load `deep-dive-research`
- allow only the skills and tools needed for research and drafting
- instruct the agent that it may rebut incorrect auditor findings with evidence instead of blindly accepting them

Each auditor should:

- set `mode: subagent`
- pin its own model
- deny edits if the role is audit-only
- return findings, not rewrites
- answer rebuttals narrowly and either uphold, soften, or withdraw findings

Do not let auditors revise the draft directly. Only the designated drafter should write revisions.

Why this step matters:

Role separation is how you keep a quorum loop from turning into a swarm.

#### Step 5: Define schemas before prompts

In `src/schema.ts`, define zod schemas for:

- input request
- audit finding
- audit result
- rebuttal request
- rebuttal response
- aggregated findings
- graph state

The draft itself can stay plain markdown, but audits and rebuttals should be schema-validated JSON.

Recommended state shape:

```ts
type ResearchState = {
  requestId: string
  inputMode: "topic" | "document"
  topic?: string
  documentPath?: string
  documentText?: string
  round: number
  draft: string
  audits: AuditResult[]
  rebuttals: Rebuttal[]
  rebuttal_responses: RebuttalResponse[]
  unresolvedFindings: AuditFinding[]
  approvedAgents: string[]
  status: "drafting" | "auditing" | "rebutting" | "revising" | "approved" | "failed"
  rootSessionId?: string
  drafterSessionId?: string
  outputPath?: string
}
```

Why this step matters:

If the schema is loose, the loop will be loose.

#### Step 6: Implement the OpenCode adapter

In `src/opencode.ts`, add a thin wrapper around the SDK that does only six things:

- connect to an existing server or start one
- list agents on startup and fail fast if a configured role is missing
- list skills on startup and fail fast if `deep-dive-research` is missing
- create sessions
- send prompts to a named agent
- request structured output for audits and rebuttals

Design one wrapper like this:

```ts
runAgent({
  sessionId,
  agent,
  parts,
  schema,
}): Promise<{ text?: string; json?: unknown }>
```

Use a persistent drafter session for the whole run. For auditors, use fresh calls per audit round. For rebuttals, send a fresh, targeted call only to the auditor whose finding is disputed.

Why this step matters:

One adapter function gives you a clean seam if the SDK changes or if you later swap from one server to many.

#### Step 7: Implement the LangGraph workflow

In `src/graph.ts`, implement these nodes in order.

`ingestRequest`

- validate `topic` xor `documentPath`
- load document text if a file path is provided
- normalize input into graph state

`bootstrapRun`

- create `requestId`
- open OpenCode sessions
- create run artifact directory

`draftInitial`

- prompt the designated drafter
- instruct it to load `deep-dive-research`
- require the draft to include a `Sources` section

`runParallelAudits`

- call all auditor agents concurrently with `Promise.all`
- require structured JSON output
- store every audit result in state

`reviewFindingsByDrafter`

- ask the designated drafter to review all findings
- require it to return two buckets:
  - accepted findings
  - rebuttals with evidence

`runTargetedRebuttals`

- group rebuttals by target auditor
- send only the relevant disputed findings back to those auditors
- require each auditor to answer with `uphold`, `soften`, or `withdraw`

`aggregateConsensus`

- separate `approve` from `revise`
- dedupe findings by `category + issue`
- apply rebuttal responses before deciding what remains unresolved
- sort by severity
- compute one of three outcomes:
  - `approved`
  - `needs_revision`
  - `failed_non_convergent`

`reviseDraft`

- pass only unresolved findings to the drafter
- preserve the previous draft as an artifact
- increment `round`

`finalizeApprovedDraft`

- write `runs/<requestId>/final.md`
- write `runs/<requestId>/summary.json`

`finalizeFailedRun`

- write the latest draft
- write all unresolved findings and rebuttal outcomes
- mark the run as failed rather than looping forever

Routing rules:

- after `draftInitial`, go to `runParallelAudits`
- after `runParallelAudits`, go to `reviewFindingsByDrafter`
- if the drafter issued rebuttals, go to `runTargetedRebuttals`
- then go to `aggregateConsensus`
- after `aggregateConsensus`, route to `finalizeApprovedDraft` if every auditor voted `approve`
- otherwise route to `reviseDraft` if `round < maxRounds` and the findings changed
- otherwise route to `finalizeFailedRun`

Use a SQLite checkpointer so each run has a real `thread_id` and can be resumed or inspected.

Why this step matters:

This is the smallest graph that still gives you durable state, bounded loops, and clean routing.

#### Step 8: Add Langfuse instrumentation

In `src/telemetry.ts`, wrap the workflow like this:

- root observation for the whole run
- nested observation per graph node
- nested `agent` observation per OpenCode call
- nested `evaluator` observation per audit result
- nested `chain` observation per rebuttal exchange

Record metadata on each observation:

- `requestId`
- `round`
- `agentName`
- `sessionId`
- `status`
- `vote`
- `model` if known from config
- `findingIssue` for rebuttal spans
- `rebuttalDecision` where applicable

Do not wait for full internal OpenCode telemetry before shipping v1. Start by tracing the orchestration boundary. Then optionally enrich those traces with OpenCode `/event` live data and `/sync/history` post-run data.

Why this step matters:

You need to answer questions like "which auditor blocked round 3?" and "which rebuttal changed the final consensus?" without reading raw logs.

#### Step 9: Add optional OpenCode telemetry enrichment

In `src/telemetry-enrichment.ts`, add two optional capabilities behind config flags.

1. Live SSE enrichment.

- subscribe to `client.event.subscribe()` during a run
- optionally subscribe to `client.global.event()` for cross-instance monitoring
- filter for the run's session IDs
- capture useful events like:
  - `message.updated`
  - `message.part.updated`
  - `session.status`
  - `session.error`
  - `permission.asked`

2. Post-run sync backfill.

- call the v2 SDK `client.sync.history.list()` for the run's session IDs
- persist those events as a raw artifact for later debugging

Keep this layer optional. It should enrich traces and debugging artifacts, not decide workflow state.

#### Step 10: Add a CLI entrypoint

In `src/index.ts`, support both:

- `--topic "..."`
- `--file path/to/doc.md`

Start with a CLI because it proves the loop without forcing you to design an API before the loop is stable.

Expected commands:

```bash
opencode serve --port 4096
bun install
bun run dev -- --topic "How Raft leader election works"
```

Why this step matters:

It gives you the fastest path from empty repo to first successful run.

#### Step 11: Add tests for the non-LLM logic

Test these pieces without live models:

- schema validation
- vote aggregation
- finding deduplication
- rebuttal routing
- rebuttal application to unresolved findings
- stagnation detection
- route selection between `approve`, `revise`, and `fail`

Mock the OpenCode adapter in tests. Do not make live model calls your only correctness check.

Why this step matters:

The expensive part of the system is model behavior. The part you can make deterministic is the orchestration logic.

### Optional work after v1

- add an HTTP API after the CLI loop is stable
- add PDF and DOCX ingestion
- move from SQLite to Postgres when you need multiple concurrent users or hosted deployment
- use `interrupt()` for manual human approval before publishing the final draft
- build a live operator console backed by OpenCode `/event`
- use `/sync/history` to generate richer run artifacts or replay timelines
- split to multiple OpenCode servers only if you later need hard isolation

## 9. Risks and Failure Modes

### Risk 1: The skill is not actually used

Failure mode:

- the drafter writes a generic answer instead of following the deep-dive contract

Mitigation:

- explicitly instruct the drafter prompt to load the skill before drafting
- reject drafts that do not contain the required sections from the contract
- verify the configured research agent can access `deep-dive-research` during startup

### Risk 2: Auditors do not return consistent structure

Failure mode:

- one auditor returns prose instead of JSON, making aggregation brittle

Mitigation:

- use OpenCode structured output with a JSON schema for audits
- fail the audit call if schema validation does not pass
- retry once with the validation error included

### Risk 3: Rebuttals never converge

Failure mode:

- the drafter and one auditor keep arguing about the same finding forever

Mitigation:

- set `maxRebuttalTurnsPerFinding`
- require every rebuttal to include evidence
- require every auditor rebuttal response to end in `uphold`, `soften`, or `withdraw`
- after the rebuttal cap is reached, freeze the finding in its latest valid form and continue the round

### Risk 4: Unanimity never converges

Failure mode:

- one auditor keeps raising new minor concerns forever

Mitigation:

- set `maxRounds`
- ignore already-resolved findings
- detect stagnation by hashing the normalized unresolved findings list each round
- fail closed with `needs_manual_review` instead of looping forever

### Risk 5: Session context leaks between roles

Failure mode:

- auditors start defending earlier opinions instead of judging the current draft

Mitigation:

- keep one persistent session only for the drafter
- make auditor calls fresh each round
- keep roles in separate OpenCode agents

### Risk 6: Langfuse trace depth is shallower than expected

Failure mode:

- you can see that a run failed, but not every internal OpenCode tool call

Mitigation:

- treat orchestration-level tracing as the v1 success criterion
- capture agent name, round, vote, rebuttal, and revision inputs at the orchestrator boundary
- add `/event` and `/sync/history` enrichment only after the core loop is working

### Risk 7: OpenCode event shapes drift between SDK generations

Failure mode:

- code written against one generated SDK event type does not match a newer version or the live runtime shape

Mitigation:

- prefer the v2 SDK for new work
- keep event parsing isolated in `src/telemetry-enrichment.ts`
- treat raw events as best-effort enrichment, not as the authoritative workflow state

### Risk 8: The SDK structured-output field name differs from docs

Failure mode:

- the code passes `format` when the installed SDK expects `outputFormat`, or the reverse

Mitigation:

- use `format`, which the local generated SDK types confirm
- keep the structured-output call isolated inside `src/opencode.ts`

### Risk 9: Document input grows too large

Failure mode:

- a large document overwhelms the draft prompt and the auditors

Mitigation:

- limit v1 document input to plain text or markdown
- reject or pre-trim oversized files
- add document chunking as a later feature, not part of the first build

## 10. Verification Plan

### Environment verification

1. Start the OpenCode server:

```bash
opencode serve --port 4096
```

2. Verify the server is healthy:

```bash
curl http://127.0.0.1:4096/global/health
```

Success criteria:

- server responds with `healthy: true`

### Config verification

1. Verify the configured agents appear via the SDK or server API.
2. Verify the designated drafter from `quorum.config.json` exists.
3. Verify the skill list contains `deep-dive-research`.

Success criteria:

- `research-drafter`, `source-auditor`, `logic-auditor`, and `clarity-auditor` are all visible
- `deep-dive-research` is visible through the app skills surface

### Research-tool verification

1. Verify the research agents can use the intended tools.
2. Run small smoke tasks for:
   - Context7 docs lookup
   - Exa web search
   - Grep.app code search

Success criteria:

- each tool is available to the relevant agent role
- the prompts do not need to restate tool mechanics because the tool surfaces already exist

### Structured-output verification

1. Run one audit call against a tiny sample draft.
2. Validate that the JSON matches the schema.
3. Run one rebuttal round-trip and validate both the rebuttal request and rebuttal response schemas.

Success criteria:

- every audit result parses without fallback string parsing
- every rebuttal response parses without fallback string parsing

### Workflow verification

Run the orchestrator on the same topic each time:

```bash
bun run dev -- --topic "How Raft leader election works"
```

Check these behaviors:

- round 1 draft is produced
- all auditor calls complete
- at least one rebuttal can happen
- at least one revision loop can happen
- the run terminates either in `approved` or bounded `failed`
- `runs/<requestId>/final.md` exists for approved runs
- `runs/<requestId>/summary.json` records rounds, votes, rebuttals, and findings

Success criteria:

- no infinite loops
- no role confusion
- no missing audit or rebuttal schemas

### Telemetry verification

Check Langfuse for one complete trace per run.

Success criteria:

- root observation exists
- each round is visible
- each OpenCode agent call is visible
- each auditor vote is visible
- each rebuttal exchange is visible
- final status is visible

### OpenCode event verification

1. Subscribe to the project event stream during one run.
2. Confirm you receive:
   - `message.updated`
   - `message.part.updated`
   - `session.status`
   - `session.error` when applicable
   - `permission.asked` when applicable
3. After the run, call `/sync/history` through the v2 SDK and confirm persisted events exist for the session.

Success criteria:

- the live event stream contains useful session-scoped progress data
- persisted sync history is available for post-run reconstruction

### Regression checks

Before calling v1 complete, add automated tests for:

- vote aggregation
- stagnation detection
- route selection
- config validation

Success criteria:

- a schema or routing regression fails locally without needing a live model run

## 11. Rollback or Recovery Plan

Because the repo is greenfield, rollback here means reducing complexity without losing interfaces or artifacts.

### If LangGraph becomes the blocker

Fallback:

- keep `src/opencode.ts`, `src/schema.ts`, and `src/telemetry.ts`
- replace `src/graph.ts` temporarily with an imperative loop that uses the same state shape

Why this is safe:

- the worker contract and audit schema stay the same
- you can reintroduce LangGraph later without rewriting prompts or adapters

### If SQLite persistence becomes annoying in local development

Fallback:

- switch the checkpointer to in-memory for short local spikes
- keep SQLite as the target for the first real v1 release

Why this is safe:

- the `thread_id`-based workflow stays the same
- only the persistence backend changes

### If one OpenCode server causes session contamination

Fallback:

- keep the same `runAgent()` adapter interface
- move one or more roles to separate OpenCode server instances

Why this is safe:

- the orchestrator keeps calling named workers through the same wrapper
- only the routing inside `src/opencode.ts` changes

### If Langfuse tracing is noisy or incomplete

Fallback:

- keep tracing only at the root run and per-agent-call level
- disable deeper nested spans until the core flow is stable

Why this is safe:

- observability depth changes, but business logic does not

### If OpenCode event enrichment is noisy or brittle

Fallback:

- disable `src/telemetry-enrichment.ts`
- keep Langfuse as the only telemetry layer

Why this is safe:

- workflow correctness stays in LangGraph state and Langfuse spans
- only extra observability depth is removed

### Artifact recovery

Always preserve:

- each round's draft
- each round's audits
- each round's rebuttals and rebuttal responses
- final approved draft or failure summary

This matters because even if the run fails to converge, you still want the latest useful draft and the audit trail that explains why.

## 12. Sources

Local repo sources:

- `/Users/leewingcheung/Documents/research-qurom/SKILL.md:1-238`
- `/Users/leewingcheung/Documents/research-qurom` directory listing showing the repo contains `IMPLEMENTATION_PLAN.md`, `SKILL.md`, and `opencode/`
- `opencode/packages/opencode/src/server/instance/event.ts:12-88`
- `opencode/packages/opencode/src/server/instance/global.ts:73-138`
- `opencode/packages/opencode/src/sync/sync-event.ts:116-164`
- `opencode/packages/opencode/src/server/instance/sync.ts:21-117`
- `opencode/packages/opencode/src/session/message-v2.ts:460-509`
- `opencode/packages/opencode/src/permission/permission.ts:75-87`
- `opencode/packages/opencode/src/v2/session-event.ts:92-447`
- `opencode/packages/opencode/src/server/instance/index.ts` for `app.skills`
- `opencode/packages/sdk/js/package.json:11-18`
- `opencode/packages/sdk/js/src/v2/client.ts:46-88`
- `opencode/packages/sdk/js/src/v2/gen/sdk.gen.ts:296-306`
- `opencode/packages/sdk/js/src/v2/gen/sdk.gen.ts:487-505`
- `opencode/packages/sdk/js/src/v2/gen/sdk.gen.ts:3020-3114`
- `opencode/packages/sdk/js/src/v2/gen/sdk.gen.ts:3316-3345`
- `opencode/packages/sdk/js/src/v2/gen/sdk.gen.ts:4294-4390`
- `opencode/packages/sdk/js/src/v2/gen/types.gen.ts:100-219`
- `opencode/packages/sdk/js/src/v2/gen/types.gen.ts:4528-4584`
- `opencode/packages/sdk/js/src/gen/types.gen.ts:237-305`
- `opencode/packages/sdk/js/src/gen/types.gen.ts:406-521`

Primary documentation sources:

- OpenCode Server: `https://opencode.ai/docs/server/`
- OpenCode SDK: `https://opencode.ai/docs/sdk/`
- OpenCode Agents: `https://opencode.ai/docs/agents/`
- OpenCode Skills: `https://opencode.ai/docs/skills/`
- LangGraph JS Overview: `https://docs.langchain.com/oss/javascript/langgraph/overview`
- LangGraph JS Persistence: `https://docs.langchain.com/oss/javascript/langgraph/persistence`
- LangGraph JS Interrupts: `https://docs.langchain.com/oss/javascript/langgraph/interrupts`
- Langfuse Instrumentation: `https://langfuse.com/docs/observability/sdk/python/instrumentation`
- Langfuse Observation Types: `https://langfuse.com/docs/observability/features/observation-types`

Notes on certainty:

- Confirmed claims in this plan come from the docs and local repo state above.
- Inferred claims are design recommendations made from that current state.
- The earlier uncertainty around OpenCode event usefulness and the structured-output field name has been resolved by inspecting the local `opencode/` source. The remaining design choices here are about architecture tradeoffs, not missing evidence.
