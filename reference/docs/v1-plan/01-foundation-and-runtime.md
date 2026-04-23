# Phase 1: Foundation And Runtime

## Execution Snapshot

- Phase number: 1
- Source plan: `IMPLEMENTATION_PLAN.md`, Step 1 through Step 3 (`IMPLEMENTATION_PLAN.md:674-758`)
- Readiness status: `Ready`
- Primary deliverable: a runnable Bun project scaffold with `quorum.config.json` and verified access to the `deep-dive-research` skill
- Blocking dependencies: None
- Target measurements summary: None
- Next phase: `02-agent-and-schema-contracts.md`

## Why This Phase Exists

This phase creates the minimum project surface needed for all later work. Without a Bun runtime scaffold, config file, and startup checks for the required skill, no later agent, schema, graph, or telemetry work can be implemented cleanly.

## Start Criteria

- The repo root is writable.
- Bun is installed and available in the shell.
- OpenCode CLI is installed and available in the shell.
- The implementation plan exists and is the current source of truth.

Confirmed evidence:

- `bun --version` returned `1.3.12`.
- `opencode --version` returned `1.3.13`.
- `IMPLEMENTATION_PLAN.md` exists in the repo root.

## Dependencies And How To Check Them

| Dependency | Why it matters | How to verify it | Status |
| --- | --- | --- | --- |
| Bun runtime | Required for package install and script execution | Run `bun --version` from repo root | Done |
| OpenCode CLI | Required for `opencode serve` and local smoke checks | Run `opencode --version` from repo root | Done |
| Source implementation plan | Needed to preserve sequencing and deliverables | Confirm `IMPLEMENTATION_PLAN.md` exists and matches the approved plan | Done |
| `deep-dive-research` skill availability | Required for designated drafter startup checks | In this phase, implement a startup check using the OpenCode app skills API; verification becomes an exit gate | Unknown |

## Target Measurements And Gates

Entry gates:

- None

Exit gates:

- Measurement: runtime scaffold exists
  Pass condition: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, and `quorum.config.json` exist in repo root
  Measurement method: file existence check
  Current evidence: files do not exist yet
  Status: `Not Met`

- Measurement: Bun install succeeds
  Pass condition: `bun install` completes without dependency resolution errors
  Measurement method: run `bun install`
  Current evidence: not yet executed in this repo
  Status: `Unknown`

- Measurement: skill binding check exists
  Pass condition: startup code includes an OpenCode `app.skills` check for `deep-dive-research`
  Measurement method: inspect `src/opencode.ts` or equivalent startup module once created
  Current evidence: file does not exist yet
  Status: `Not Met`

## Scope

- create the Bun project scaffold
- add runtime and TypeScript configuration
- add root config and env template files
- define `quorum.config.json`
- add the empty `src/` entry modules referenced by the source plan
- implement startup-time verification strategy for the `deep-dive-research` skill

## Out Of Scope

- writing OpenCode agent prompts
- writing zod schemas for audits and rebuttals
- implementing the OpenCode adapter
- implementing the LangGraph workflow
- implementing Langfuse tracing
- writing phase-specific tests beyond basic install sanity

## Implementation Details

This phase should create the file and runtime skeleton that later phases rely on.

Required root files from the source plan:

- `package.json`
- `tsconfig.json`
- `.gitignore`
- `quorum.config.json`
- `.env.example`

Required source files from the source plan:

- `src/index.ts`
- `src/config.ts`
- `src/schema.ts`
- `src/opencode.ts`
- `src/graph.ts`
- `src/telemetry.ts`
- `src/telemetry-enrichment.ts`
- `src/output.ts`

Runtime choices required by the source plan:

- Bun is the package manager and runtime, not npm
- TypeScript is the implementation language
- dependencies should include `@opencode-ai/sdk`, `@langchain/langgraph`, `@langchain/core`, `@langchain/langgraph-checkpoint-sqlite`, `@langfuse/tracing`, `zod`, `dotenv`, and TypeScript tooling (`IMPLEMENTATION_PLAN.md:696-711`)

Skill binding detail:

- Do not duplicate the `deep-dive-research` skill into the repo in this phase.
- Add startup logic that can call the OpenCode app skills surface and confirm `deep-dive-research` is visible before the first run starts (`IMPLEMENTATION_PLAN.md:717-729`).

Quorum config detail:

- `quorum.config.json` should at minimum include:
  - `designatedDrafter`
  - `auditors`
  - `maxRounds`
  - `maxRebuttalTurnsPerFinding`
  - `requireUnanimousApproval`
  - `artifactDir`
  - `researchTools`

## Execution Checklist

1. Create `package.json` configured for Bun scripts and TypeScript execution.
2. Create `tsconfig.json` for the planned `src/` layout.
3. Create `.gitignore` with Bun, build, env, and run-artifact ignores.
4. Create `.env.example` with placeholders for Langfuse and any OpenCode-related runtime values needed by the orchestrator.
5. Create `quorum.config.json` using the keys defined in the source plan.
6. Create the `src/` directory and the eight source files listed in the source plan.
7. Add a minimal startup module in `src/opencode.ts` or `src/config.ts` that will later perform `app.skills` verification for `deep-dive-research`.
8. Run `bun install` and resolve any dependency or module-format errors.
9. Verify that the created file layout matches the source plan before handing off to Phase 2.

## Files And Systems Likely Affected

- `package.json`
- `tsconfig.json`
- `.gitignore`
- `.env.example`
- `quorum.config.json`
- `src/index.ts`
- `src/config.ts`
- `src/schema.ts`
- `src/opencode.ts`
- `src/graph.ts`
- `src/telemetry.ts`
- `src/telemetry-enrichment.ts`
- `src/output.ts`

Systems involved:

- Bun runtime
- OpenCode SDK package surface
- local file layout for the research orchestrator

## Verification

Commands to run:

```bash
bun --version
opencode --version
bun install
```

Behaviors to check:

- Bun resolves and installs dependencies without switching to npm.
- Root scaffold files exist after creation.
- `src/` contains all files referenced by the source plan.
- `quorum.config.json` contains the designated drafter, auditor list, rebuttal cap, and research tool preferences.

Regression checks:

- No repo-local agent or schema assumptions are introduced yet.
- The phase does not invent API surfaces beyond what the source plan already calls for.

Success signals:

- a clean `bun install`
- file layout matches plan
- startup code path for skill verification is present

## Done Criteria

- all scaffold files listed in the source plan exist
- `bun install` completes successfully
- `quorum.config.json` exists with the planned keys
- the codebase has a clear place to implement OpenCode skill startup validation
- Phase 2 can begin without needing to revisit runtime setup

## Handoff To Next Phase

Next phase: `02-agent-and-schema-contracts.md`

This phase must deliver:

- a stable Bun project layout
- the root config file with quorum settings
- empty or stubbed source modules for agent, schema, graph, and telemetry work

What becomes unblocked:

- writing role-specific OpenCode agent prompts
- defining audit and rebuttal schemas
- binding agent and schema contracts to the new project scaffold

What the next phase should pick up:

- create `.opencode/agents/*.md`
- implement schema definitions in `src/schema.ts`

## Open Questions Or Blockers

- Unknown: exact environment variable names you want to standardize in `.env.example` for Langfuse and runtime configuration.
- Unknown: whether you want one dev script or separate `dev`, `typecheck`, and `start` scripts in `package.json`.

## Sources

- Source plan Step 1 through Step 3: `IMPLEMENTATION_PLAN.md:674-758`
- Verified tool availability: `bun --version`, `opencode --version`
- Repo state: `/Users/leewingcheung/Documents/research-qurom` directory listing
