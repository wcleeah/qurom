# Provider Integration Guide

Use this guide when adding or changing an agent provider under `src/providers/`.

The provider layer lets the graph ask for agent work without caring whether the work runs through OpenCode, Cursor, or another backend. A provider should translate research-qurom's runtime contract into the provider's native API, then return normalized results and events.

The most important rule: **declare only the capabilities the provider actually supports**. Most integration bugs come from overstating capabilities and making the graph/runtime believe a provider can stream events, attach files, or write JSON artifacts when it cannot.

---

## Provider Shape

Create `src/providers/<provider>.ts` and export an `AgentProvider`.

Required fields and methods:

| Member | Purpose |
|---|---|
| `id` | Stable provider id used in `quorum.config.json` and SQLite role bindings. |
| `capabilities` | Set of provider capabilities. Keep this honest and minimal. |
| `createRunHandle(input)` | Create a provider session/run handle for one logical agent run. |
| `prompt(input)` | Execute a prompt and return `ProviderPromptResult<T>`. |

Optional methods:

| Member | Use When |
|---|---|
| `prepare(input)` | The provider must start a server, sync files, warm credentials, or allocate run-level resources before graph execution. |
| `abort(config, handleId)` | The provider can cancel active work by handle/session id. |
| `createEventBridge(input)` | The provider emits streaming events that should flow into the runner event bus. |
| `validate(input)` | The provider can validate credentials, model ids, role bindings, or local prerequisites. |
| `configForm(input)` | The provider needs custom controls in the web config UI. |

After implementing the provider, register it in `src/providers/registry.ts`.

---

## Capability Semantics

Capabilities are runtime promises. If a capability is set, shared code will rely on it.

| Capability | Meaning |
|---|---|
| `plainJsonOutput` | Provider can return structured JSON inline in the model response. |
| `jsonFileOutput` | Provider can write structured JSON to the local output file requested by the app. |
| `fileAttachments` | Provider can receive local files as native prompt attachments. |
| `streamingEvents` | Provider can emit live session/message/tool events. |
| `toolEvents` | Provider event stream includes tool execution state. |
| `permissionEvents` | Provider event stream includes permission ask/reply state. |
| `providerManagedAgents` | Provider has named agent definitions or role identities outside the app. |

Do not set `jsonFileOutput` just because research-qurom wants a JSON artifact in `runs/`. Inline-only providers should return JSON inline. The app can persist parsed JSON to the artifact path after validation.

Do not set `fileAttachments` unless the provider can consume local file paths directly. If it cannot, `AgentRuntime` can inline small attached files into the prompt text as a fallback.

Do not set streaming/event capabilities unless the provider can produce real-time event data. A provider without events can still work; the runtime emits coarse lifecycle events synchronously.

---

## Prompt Execution Contract

`prompt(input)` should:

1. Send exactly the prompt text provided by the runtime, plus any provider-specific wrapper that is necessary for routing or metadata.
2. Use the run handle supplied by the runtime.
3. Respect `input.outputFile` according to capability.
4. Parse or delegate structured output handling through the shared helpers where possible.
5. Return a `ProviderPromptResult<T>` with the normalized text/structured result.
6. Surface provider failures with useful, typed or descriptive errors.

Provider-specific runtime settings belong in provider code or role bindings. App-owned task instructions belong in prompt assets and graph code.

---

## Structured Output And Artifacts

`ProviderPromptInput.outputFile` is the app's desired artifact path under `runs/`. It is not always a provider-writable file.

Split provider output from app artifact persistence:

| Provider Type | `providerOutputFile` | `artifactFile` | Behavior |
|---|---|---|---|
| File-output provider | `input.outputFile` | `input.outputFile` | Provider writes JSON directly to the artifact path. |
| Inline-only provider | unset | `input.outputFile` | Provider returns JSON inline; app validates and writes the parsed artifact after success. |

This distinction prevents stale artifact reads. Inline-only providers must never read an existing artifact file before parsing the latest model response.

For inline structured providers, prefer `runProviderStructuredPrompt()`. It:

- sends the structured prompt,
- parses inline JSON,
- returns `result.structured`,
- writes the parsed JSON to `artifactFile` only after validation succeeds.

---

## Output Instructions Are App-Owned

Do not hardcode structured JSON output instructions in prompt assets or provider agent files.

`src/graph.ts` appends provider-aware output instructions:

- `jsonFileOutput`: write JSON to the requested output file and respond with `OK`.
- Inline-only: return JSON inline and do not write an output file.

When adding a new structured JSON prompt, keep the prompt asset focused on the task behavior. Add the output contract in graph/app code so it can adapt to provider capabilities.

---

## File Attachments

The graph may attach draft markdown, findings JSON, rebuttal JSON, or other run artifacts.

Provider behavior should follow capability:

- With `fileAttachments`, pass local file paths using the provider's native attachment API.
- Without `fileAttachments`, rely on `AgentRuntime` to inline supported files into the prompt.

If a provider has low prompt-size limits, add explicit tests around attachment inlining and failure behavior. Do not silently drop attached files.

---

## Session Lifecycle

`AgentRunHandle.dispose` is called after each prompt unless `handle.keepAlive` is true.

Default to one-shot handles for:

- drafting,
- auditing,
- finding review,
- rebuttal response,
- revision,
- design audit work.

Use `keepAlive` only for flows that must preserve a provider conversation across graph interrupts. Today that means `reader-interviewer`.

If a provider exposes durable remote sessions, choose one of these designs:

- keep the handle alive until the multi-turn flow completes, or
- make `prompt()` explicitly resume/re-hydrate the provider session before sending the next prompt.

Do not cache only a provider session id unless `prompt()` can reliably rehydrate that session.

---

## Events And Bridges

If the provider supports streaming events, implement `createEventBridge(input)`.

The bridge should translate provider events into `RunnerEvent` shapes rather than leaking provider-native payloads through the UI layer.

Common event mappings:

| Provider Event | Runner Event |
|---|---|
| Session created | `session.created` |
| Session status changed | `session.status` |
| Session failed | `session.error` |
| Assistant message started | `agent.message.start` |
| Text delta or final text | `agent.message.text` |
| Reasoning delta | `agent.reasoning` |
| Tool call started/updated/finished | `agent.tool` |
| Permission requested | `agent.permission` |
| Permission answered | `agent.permission.replied` |

If the provider cannot stream, do not fake fine-grained events. The runtime can still emit enough lifecycle status for the TUI and logs.

---

## Validation And Configuration UI

Implement `validate()` when the provider has prerequisites that can fail before a run starts:

- missing API keys,
- unreachable local server,
- invalid model id,
- unsupported role configuration,
- missing provider-side agent definitions.

Implement `configForm()` when roles need provider-specific settings in `bun run view`.

Good config forms:

- expose model choices when available,
- expose only runtime settings the provider owns,
- keep prompt and role instruction text out of provider settings,
- return clear warnings when credentials are missing.

OpenCode is special: its model, tool permissions, and role instructions are file-backed in `.opencode/agents/*.md`. The config UI shows those files as read-only and directs users to edit them directly.

---

## Provider Registration

Provider registration belongs in `src/providers/registry.ts`.

Make sure registration supports:

- lookup by stable provider id,
- role-to-provider resolution through `agentRuntime.roles`,
- fallback to `agentRuntime.defaultProvider`,
- prerequisite validation for all configured providers.

Keep provider ids stable. Changing an id breaks existing config rows and `quorum.config.json` role bindings.

---

## Testing Checklist

Add focused tests for the behavior you changed.

| Test Area | Files |
|---|---|
| Provider registry and prerequisites | `tests/providers.test.ts` |
| Config UI form rendering | `tests/provider-forms.test.ts` |
| Provider implementation | `tests/<provider>-provider.test.ts` |
| Runtime lifecycle and file inlining | `tests/agent-runtime.test.ts` |
| Prompt construction and provider output modes | `tests/graph.test.ts` |
| Multi-turn keep-alive flows | `tests/reader-discovery.test.ts` |

At minimum run:

```bash
bun run typecheck
bun test tests/<provider-test>.test.ts
```

Run broader tests when touching shared runtime, graph behavior, structured output handling, or event bridge behavior:

```bash
bun test ./tests
```

---

## Common Mistakes

- Setting `jsonFileOutput` for an inline-only provider.
- Reading `input.outputFile` before the current model response has been parsed.
- Dropping file attachments when the provider does not support native attachments.
- Putting JSON output instructions in prompt assets instead of graph/app code.
- Caching remote session ids without rehydration support.
- Emitting provider-native event payloads directly into UI-facing code.
- Treating model configuration as prompt/role instruction configuration.
- Forgetting to register the provider in `src/providers/registry.ts`.

---

## Review Questions

Before merging a provider change, answer these:

1. Are the declared capabilities exactly what the provider supports?
2. Does structured output work for both success and malformed-output paths?
3. Are app artifacts written only after successful validation?
4. Are attachments preserved or explicitly rejected?
5. Does cancellation call the provider's abort path when available?
6. Are sessions disposed, kept alive, or rehydrated deliberately?
7. Does the config UI expose only provider-owned settings?
8. Do tests cover the provider's output mode and lifecycle behavior?
