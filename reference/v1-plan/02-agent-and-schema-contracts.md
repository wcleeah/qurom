# Phase 2: Agent And Schema Contracts

## Execution Snapshot

- Phase number: 2
- Source plan: `reference/v1-plan/IMPLEMENTATION_PLAN.md`, Step 4 and Step 5 (`reference/v1-plan/IMPLEMENTATION_PLAN.md:760-825`)
- Readiness status: `Ready`
- Primary deliverable: role-specific OpenCode agent definitions plus zod contracts for audits, rebuttals, and graph state
- Blocking dependencies: None
- Target measurements summary: no numeric thresholds; exit gates are schema presence and prompt contract completeness
- Next phase: `03-opencode-and-graph-core.md`

## Why This Phase Exists

This phase turns the workflow idea into enforceable contracts. The agents need explicit roles, and the orchestrator needs structured data shapes. Without those contracts, the later OpenCode adapter and LangGraph workflow will be fragile and ambiguous.

## Start Criteria

- Phase 1 scaffold files exist.
- `.opencode/agents/` exists.
- `src/schema.ts` exists and is ready to be populated.
- `quorum.config.json` exists so role names and tool preferences are fixed.

## Dependencies And How To Check Them

| Dependency | Why it matters | How to verify it | Status |
| --- | --- | --- | --- |
| Phase 1 scaffold complete | Needed so agent files and schema files have a place to live | Check for `package.json`, `quorum.config.json`, and `src/schema.ts` in repo root | Done |
| Quorum config exists | Agent names must match config | Confirm `quorum.config.json` contains `designatedDrafter` and `auditors` | Done |
| Skill verification path planned | Drafter prompt should rely on a verified skill name, not a guessed one | Check for startup verification placeholder or implementation in `src/opencode.ts` or `src/config.ts` | Done |

## Target Measurements And Gates

Entry gates:

- None beyond dependency checks

Exit gates:

- Measurement: agent role files exist
  Pass condition: `.opencode/agents/research-drafter.md`, `.opencode/agents/source-auditor.md`, `.opencode/agents/logic-auditor.md`, and `.opencode/agents/clarity-auditor.md` exist
  Measurement method: file existence check
  Current evidence: files exist under `.opencode/agents/`
  Status: `Met`

- Measurement: schema contracts exist
  Pass condition: `src/schema.ts` defines schemas for input request, audit finding, audit result, rebuttal request, rebuttal response, aggregated findings, and graph state
  Measurement method: inspect `src/schema.ts`
  Current evidence: `src/schema.ts` defines request, audit, rebuttal, aggregation, and state schemas
  Status: `Met`

## Scope

- create the four OpenCode agent definition files
- encode role prompts and tool preferences
- define zod schemas for all workflow payloads and state channels
- ensure rebuttal structures are explicit and machine-checkable

## Out Of Scope

- implementing the OpenCode SDK adapter
- implementing the LangGraph nodes and routing
- implementing Langfuse tracing
- wiring live SSE or sync-history telemetry

## Implementation Details

Agent work required by the source plan (`reference/v1-plan/IMPLEMENTATION_PLAN.md:760-784`):

- `research-drafter.md`
  - `mode: subagent`
  - pinned writing-capable model
  - explicit instruction to load `deep-dive-research`
  - permission to use research tools needed for drafting
  - explicit instruction that invalid auditor findings may be rebutted with evidence

- `source-auditor.md`
  - source quality and claim-support review
  - no direct document edits
  - targeted rebuttal response behavior

- `logic-auditor.md`
  - reasoning and contradiction review
  - no direct document edits
  - targeted rebuttal response behavior

- `clarity-auditor.md`
  - plain-language and structure review
  - no direct document edits
  - targeted rebuttal response behavior

Schema work required by the source plan (`reference/v1-plan/IMPLEMENTATION_PLAN.md:786-825`):

- `InputRequest`
- `AuditFinding`
- `AuditResult`
- `Rebuttal`
- `RebuttalResponse`
- `AggregatedFindings`
- `ResearchState`

Important contract detail:

- audits are JSON, not prose
- rebuttals are JSON, not prose
- the orchestrator will depend on exact values like `approve`, `revise`, `uphold`, `soften`, and `withdraw`

## Execution Checklist

1. Create `.opencode/agents/` if it does not already exist.
2. Add `research-drafter.md` with role purpose, skill-loading instruction, rebuttal authority, and research-tool preferences.
3. Add `source-auditor.md` with source-review scope and rebuttal response rules.
4. Add `logic-auditor.md` with reasoning-review scope and rebuttal response rules.
5. Add `clarity-auditor.md` with clarity-review scope and rebuttal response rules.
6. Implement zod schemas in `src/schema.ts` for audit findings and audit results.
7. Implement zod schemas in `src/schema.ts` for rebuttal requests and rebuttal responses.
8. Implement the `ResearchState` schema or type structure in `src/schema.ts`.
9. Verify that all agent names match the names expected in `quorum.config.json`.

## Files And Systems Likely Affected

- `.opencode/agents/research-drafter.md`
- `.opencode/agents/source-auditor.md`
- `.opencode/agents/logic-auditor.md`
- `.opencode/agents/clarity-auditor.md`
- `src/schema.ts`
- `quorum.config.json`

Systems involved:

- OpenCode agent configuration
- zod schema validation
- workflow contract design for LangGraph state and OpenCode outputs

## Verification

Commands to run:

```bash
bun run typecheck
```

Behaviors to check:

- agent filenames match the configured role names
- `src/schema.ts` exports the schema shapes the next phase needs
- rebuttal response schemas only allow `uphold`, `soften`, or `withdraw`
- the drafter prompt explicitly instructs skill loading and evidence-based rebuttal behavior

Regression checks:

- auditors do not get write authority in their role definitions unless intentionally granted
- schema names and enum values line up with the source plan's routing rules

Success signals:

- typecheck passes
- all four agent files exist
- schemas are concrete enough that another agent can implement the adapter without inventing shapes

## Done Criteria

- all four agent definition files exist
- `src/schema.ts` contains the contract set required by the source plan
- role prompts distinguish drafting, auditing, and rebuttal responsibilities clearly
- the next phase can implement SDK calls and graph routing without revisiting prompt design or payload shape design

## Handoff To Next Phase

Next phase: `03-opencode-and-graph-core.md`

This phase must deliver:

- stable role prompts and permissions
- stable schemas for every workflow payload

What becomes unblocked:

- implementing `runAgent()` around the OpenCode SDK
- implementing LangGraph state transitions that rely on audit and rebuttal payloads

What the next phase should pick up:

- connect to OpenCode
- validate agent and skill presence at startup
- implement graph nodes and routing against these schemas

## Open Questions Or Blockers

- None blocking execution.
- Model IDs and tool permissions can still be tuned later without changing the contract shapes.

## Sources

- Source plan Step 4 and Step 5: `reference/v1-plan/IMPLEMENTATION_PLAN.md:760-825`
- Source plan research-tool policy: `reference/v1-plan/IMPLEMENTATION_PLAN.md:514-520`
