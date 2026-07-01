# Provider Integration Guide

Use this checklist when adding a new agent provider under `src/providers/`.

## 1. Implement The Provider

Create `src/providers/<provider>.ts` and export an `AgentProvider`.

Required methods:
- `id`: stable provider id used in `quorum.config.json` / SQLite role bindings.
- `capabilities`: declare what the provider can actually do.
- `createRunHandle(input)`: create a provider session/run handle.
- `prompt(input)`: execute a prompt and return `ProviderPromptResult<T>`.

Optional methods:
- `prepare(input)`: start servers, sync files, or allocate provider resources before a run.
- `abort(config, handleId)`: cancel/dispose active work.
- `createEventBridge(input)`: stream provider events into the runner event bus.
- `validate(input)`: validate credentials, models, and configured roles.
- `configForm(input)`: describe `/config/roles` form controls for this provider.

Register the provider in `src/providers/registry.ts`.

## 2. Be Precise About Capabilities

Set only capabilities the provider truly supports:

- `plainJsonOutput`: provider can return structured JSON inline.
- `jsonFileOutput`: provider can write/read JSON files in the local `runs/` directory.
- `fileAttachments`: provider can receive files from local paths.
- `streamingEvents`, `toolEvents`, `permissionEvents`: provider emits live events directly.
- `providerManagedAgents`: provider has named/provider-side agent definitions.

Do not set `jsonFileOutput` just because the app wants a JSON artifact. Inline-only providers should return JSON inline; the app can persist the parsed result afterward.

## 3. Keep Provider Output And App Artifacts Separate

`ProviderPromptInput.outputFile` is the app's desired artifact path under `runs/`.

For structured output helpers, split it by capability:

- Providers with `jsonFileOutput`: pass `providerOutputFile: input.outputFile` and `artifactFile: input.outputFile`.
- Inline-only providers: pass `artifactFile: input.outputFile` and leave `providerOutputFile` unset.

This avoids stale artifact reads. Inline-only providers must never read an existing artifact file before parsing the latest model response.

Use `runProviderStructuredPrompt()` for inline structured providers. It parses inline JSON, returns `result.structured`, and writes parsed inline JSON to `artifactFile` after success.

## 4. Prompt Output Instructions Are App-Owned

Do not hardcode structured JSON output instructions in prompt assets.

`src/graph.ts` injects provider-aware output instructions:

- `jsonFileOutput`: "write JSON to this file, respond OK".
- Inline-only: "return JSON inline, do not write a file".

If you add a new structured JSON prompt, keep the asset focused on task behavior and have graph/app code append the output contract.

## 5. Handle Lifecycles Deliberately

`AgentRunHandle.dispose` is called after each prompt unless `handle.keepAlive` is true.

Use default one-shot handles for draft/audit/review work. Use `keepAlive` only for multi-turn flows that must keep the same provider conversation across graph interrupts, currently `reader-interviewer`.

If a provider exposes durable remote sessions, either:
- keep the handle alive until the flow completes, or
- explicitly resume/re-hydrate the provider session before prompting.

Do not cache only a provider session id unless `prompt()` can rehydrate it.

## 6. Configuration UI

If provider roles need custom controls in `bun run view`:

- Implement `configForm()` in the provider.
- Return model options and parameter controls when available.
- Keep provider runtime settings separate from app-owned prompt/role instructions.

OpenCode is special: its model/tool permissions are file-backed in `.opencode/agents/*.md`, so the UI shows those files read-only and asks users to edit them directly.

## 7. Tests To Update

Add or update focused tests:

- `tests/providers.test.ts`: registry and prerequisite behavior.
- `tests/provider-forms.test.ts`: config UI controls.
- Provider-specific test file, e.g. `tests/cursor-provider.test.ts`.
- `tests/agent-runtime.test.ts`: lifecycle/event behavior if changed.
- `tests/graph.test.ts` / `tests/reader-discovery.test.ts`: prompt construction and multi-turn flows.

Always run:

```bash
bun run typecheck
bun test tests/<provider-test>.test.ts
```

Run broader tests when touching shared runtime or graph behavior.
