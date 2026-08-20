# Cursor multi-run

> Last updated: 2026-08-20
>
> Feasibility notes and the current gate for running more than one research
> pipeline at a time when roles use Cursor cloud agents.

## Verdict

**Yes, for Cursor cloud only.** Isolated cloud VMs already make parallel
agents safe. The previous "one active pipeline" lock was a Qurom orchestration
choice, driven mainly by OpenCode's single `opencode serve` process and shared
workspace — not by the Cursor SDK.

The SDK still allows only **one run per agent** (`AgentBusyError` / HTTP 409).
Parallel work must use **one `Agent.create()` per role handle**, which Qurom
already does for auditors. Multi-run here means **multiple Qurom pipelines**,
each with its own set of Cursor cloud agents.

## How to enable

1. Bind every **pipeline** role to the `cursor` provider with cloud runtime
   (`/config/roles`). Viewer-only Ask/Fix roles may stay on OpenCode.
2. Set **Max concurrent runs** above `1` on `/config` (capped at 8).
3. Keep `CURSOR_API_KEY` valid. Account/plan concurrency and spend limits still
   apply on Cursor's side.

Default remains `maxConcurrentRuns: 1`. OpenCode or any local Cursor role
forces the effective cap back to 1 even if the configured value is higher.

## Why OpenCode cannot share this

| Layer | OpenCode | Cursor cloud |
|---|---|---|
| Process | One owned `opencode serve` on a fixed port | One remote VM per `Agent.create()` |
| Workspace | Shared `OPENCODE_DIRECTORY` | Empty or repo-scoped isolated disk |
| Sessions | Local session IDs on one server | Independent `bc-` agents |
| MCP | Injected into the shared server | Passed per agent at create/resume |
| Parallel auditors | Same server, separate sessions | Already separate agents |

Lifecycle reference-counting can keep one OpenCode server alive for many
callers, but two pipelines would still share MCP, files, and session space.
That is why the policy stays serial whenever any pipeline role resolves to
OpenCode.

Local Cursor (`options.runtime = "local"`) is treated the same way: it shares
this machine's working tree.

## What was already safe

These pieces are per-run or already concurrent:

- Run directories, `live-status.json`, and artifacts
- LangGraph checkpoints keyed by `thread_id` / request id
- Provider lifecycle ref-counts
- HTML Ask / Fix threads (separate Cursor agents, not the pipeline lock)
- Parallel auditors inside one pipeline

## What had to change

| Area | Change |
|---|---|
| `run-manager` | Track a map of active pipelines; reject only at the effective cap |
| `/api/status` | Keep `active` (first run) and add `actives` |
| Rerun playlist | Fill free slots instead of always waiting for idle |
| Recovery drift | Ignore cross-request restarts while two pipelines are in flight |
| Dashboard | Allow a new start when a slot is free; show every live hero |

## Remaining limits

- Cursor still returns `agent_busy` if the same agent handle is prompted twice.
  Keep-alive flows (reader interview, HTML Ask/Fix) stay one send at a time.
- Plan-level Cursor concurrency and spend are outside Qurom.
- Headless Playwright MCP on a local OpenCode server is still a single process.
  Cursor cloud agents each get their own MCP servers.
- Config SQLite is shared. Concurrent pipelines read it; they should not write
  role/prompt config mid-run.
- `maxConcurrentRuns` is a soft local cap. It does not reserve Cursor capacity.

## Recommended first setting

Start at `2` or `3` after every pipeline role is Cursor cloud. Watch spend and
Cursor 429/capacity errors before raising it.
