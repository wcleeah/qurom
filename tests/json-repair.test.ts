import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

import type { RuntimeConfig } from "../src/config"
import { auditResultSchema } from "../src/schema"

type PromptArgs = {
  sessionID: string
  agent: string
  parts: Array<{ type: string; text?: string }>
}

type PromptResult = {
  error?: unknown
  data?: {
    info: { role: "assistant"; modelID?: string; providerID?: string; variant?: string }
    parts: Array<{ type: "text"; text: string; ignored?: boolean }>
  }
}

const promptCalls: PromptArgs[] = []
const createSessionTitles: string[] = []
let promptScript: Array<(args: PromptArgs) => PromptResult | Promise<PromptResult>> = []
let onPromptSideEffect: ((args: PromptArgs) => Promise<void>) | undefined

function assistantText(text: string): PromptResult {
  return {
    data: {
      info: { role: "assistant", modelID: "test-model", providerID: "test-provider" },
      parts: [{ type: "text", text }],
    },
  }
}

function validAuditJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    vote: "approve",
    summary: "ok",
    findings: [],
    ...overrides,
  })
}

mock.module("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: () => ({
    session: {
      prompt: async (args: PromptArgs) => {
        promptCalls.push(args)
        if (onPromptSideEffect) await onPromptSideEffect(args)
        const next = promptScript.shift()
        if (!next) return assistantText("{}")
        return next(args)
      },
      create: async ({ title }: { title: string }) => {
        createSessionTitles.push(title)
        return { error: undefined, data: { id: `session-${createSessionTitles.length}` } }
      },
      abort: async () => ({ error: undefined }),
    },
  }),
}))

const { promptAgent } = await import("../src/opencode")
const { coerceJson, StructuredRecoveryError } = await import("../src/agent-runtime/structured-output")
const { auditWithRestart } = await import("../src/audit-restart")
const { recoveryDriftDetector, SystemicDriftError } = await import("../src/recovery-drift")

const testConfig: RuntimeConfig = {
  env: {
    OPENCODE_BASE_URL: "http://127.0.0.1:4096",
    OPENCODE_DIRECTORY: process.cwd(),
    QUORUM_WORKSPACE_DIRECTORY: process.cwd(),
    QUORUM_CHECKPOINT_PATH: "runs/checkpoints.sqlite",
    QUORUM_CONFIG_DB_PATH: "runs/quorum-config.sqlite",
    QUORUM_CAPTURE_OPENCODE_EVENTS: "0",
    QUORUM_CAPTURE_SYNC_HISTORY: "0",
    CURSOR_API_KEY: undefined,
    LANGFUSE_PUBLIC_KEY: undefined,
    LANGFUSE_SECRET_KEY: undefined,
    LANGFUSE_BASE_URL: undefined,
  },
  quorumConfig: {
    designatedDrafter: "research-drafter",
    auditors: ["source-auditor", "logic-auditor", "clarity-auditor"],
    summarizerAgent: "markdown-summarizer",
    maxRounds: 3,
    maxRebuttalTurnsPerFinding: 2,
    recursionLimit: 80,
    requireUnanimousApproval: true,
    artifactDir: "runs",
    promptAssetsDir: "assets/prompts",
    promptManagement: { source: "local", label: "production" },
    researchTools: { prefer: ["webfetch"], webSearchProvider: "exa" },
    auditRestart: { maxRestarts: 1 },
  },
}

let tempDir: string

beforeEach(async () => {
  promptCalls.length = 0
  createSessionTitles.length = 0
  promptScript = []
  onPromptSideEffect = undefined
  recoveryDriftDetector.resetForTests()
  tempDir = await mkdtemp(join(tmpdir(), "json-repair-"))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function agentsUsed() {
  return promptCalls.map((c) => c.agent)
}

function debugLogCapture() {
  const entries: Array<{ type: string; data?: Record<string, unknown> }> = []
  return {
    log: {
      write(type: string, data?: Record<string, unknown>) {
        entries.push({ type, data })
      },
      close: async () => {},
    },
    entries,
  }
}

describe("coerceJson", () => {
  test("bare object → unchanged", () => {
    const raw = '{"vote":"approve","summary":"x","findings":[]}'
    expect(coerceJson(raw)).toBe(raw)
  })

  test("fenced json block → inner object", () => {
    const inner = '{"vote":"approve","summary":"x","findings":[]}'
    expect(coerceJson(`\`\`\`json\n${inner}\n\`\`\``)).toBe(inner)
  })

  test('010a399c regression: prose-prefixed JSON coerces', () => {
    const text =
      'I reviewed the draft.\n```json\n{"vote":"approve","summary":"x","findings":[]}\n```'
    const coerced = coerceJson(text)
    expect(JSON.parse(coerced)).toEqual({ vote: "approve", summary: "x", findings: [] })
  })

  test("trailing prose after } → trimmed", () => {
    const inner = '{"a":1}'
    expect(coerceJson(`${inner}\n\nSome trailing note.`)).toBe(inner)
  })

  test("nested braces inside strings → not miscounted", () => {
    const raw = '{"note":"brace { inside string } ok","n":1}'
    expect(coerceJson(raw)).toBe(raw)
  })

  test("<json> tag-wrapped → inner", () => {
    const inner = '{"vote":"revise","summary":"x","findings":[]}'
    expect(coerceJson(`<json>\n${inner}\n</json>`)).toBe(inner)
  })

  test("backticks inside a legitimate string value → not stripped", () => {
    const raw = '{"note":"use `code` inline","n":1}'
    expect(coerceJson(raw)).toBe(raw)
  })
})

describe("RecoveryRouter matrix", () => {
  test("initial structured file prompt is not wrapped with a second output contract", async () => {
    const outputFile = join(tempDir, "audit.json")
    const runtimePrompt = [
      "Review the draft.",
      "",
      "## Output instructions",
      `Write JSON to the output file \`${outputFile}\` matching this schema:`,
      "{}",
      "Respond with only `OK` when the file is written.",
      "Do not include the JSON in your response.",
    ].join("\n")
    promptScript = [async () => assistantText(validAuditJson())]

    await promptAgent({
      config: testConfig,
      sessionID: "s1",
      agent: "source-auditor",
      prompt: runtimePrompt,
      schema: auditResultSchema,
      outputFile,
    })

    const sent = promptCalls[0]?.parts[0]?.text ?? ""
    expect(sent).toBe(runtimePrompt)
    expect(sent.match(/## Output instructions/g)?.length).toBe(1)
    expect(sent).not.toContain("Output requirements:")
    expect(sent).not.toContain("<required_json_schema>")
  })

  test("nooutput → A reprompt same-agent → valid", async () => {
    promptScript.push(
      () => assistantText(""),
      () => assistantText(validAuditJson()),
    )
    const result = await promptAgent({
      config: testConfig,
      sessionID: "s-1",
      agent: "source-auditor",
      prompt: "audit",
      schema: auditResultSchema,
    })
    expect(result.structured?.vote).toBe("approve")
    expect(agentsUsed().every((a) => a === "source-auditor")).toBe(true)
  })

  test("truncated → A continue → valid", async () => {
    promptScript.push(
      () => assistantText('{"vote":"approve","summary":"x","findings":['),
      () => assistantText(validAuditJson()),
    )
    const result = await promptAgent({
      config: testConfig,
      sessionID: "s-1",
      agent: "source-auditor",
      prompt: "audit",
      schema: auditResultSchema,
    })
    expect(result.structured?.vote).toBe("approve")
  })

  test("fence-only → D resolves free with one prompt call", async () => {
    promptScript.push(() =>
      assistantText(`\`\`\`json\n${validAuditJson()}\n\`\`\``),
    )
    await promptAgent({
      config: testConfig,
      sessionID: "s-1",
      agent: "source-auditor",
      prompt: "audit",
      schema: auditResultSchema,
    })
    expect(promptCalls).toHaveLength(1)
    expect(agentsUsed()).not.toContain("json-fixer")
  })

  test("unescaped quotes → C json-fixer → valid", async () => {
    const outputFile = join(tempDir, "audit.json")
    await mkdir(tempDir, { recursive: true })
    await writeFile(
      outputFile,
      '{"vote": "approve", "summary": "bad \\x escape", "findings": []}',
      "utf8",
    )
    onPromptSideEffect = async (args) => {
      if (args.agent === "json-fixer") {
        await writeFile(outputFile, validAuditJson(), "utf8")
      }
    }
    promptScript.push(
      () => assistantText(""),
      () => assistantText("fixed on disk"),
    )
    const result = await promptAgent({
      config: testConfig,
      sessionID: "s-1",
      agent: "source-auditor",
      prompt: "audit",
      schema: auditResultSchema,
      outputFile,
    })
    expect(result.structured?.vote).toBe("approve")
    expect(agentsUsed()).toContain("json-fixer")
  })

  test("enum drift → B same-agent with zod issues; json-fixer never called", async () => {
    promptScript.push(
      () =>
        assistantText(
          JSON.stringify({
            vote: "approve",
            summary: "ok",
            findings: [
              {
                severity: "critical",
                category: "clarity",
                issue: "bad",
                evidence: ["x"],
                required_fix: "fix",
              },
            ],
          }),
        ),
      () => assistantText(validAuditJson()),
    )
    await promptAgent({
      config: testConfig,
      sessionID: "s-1",
      agent: "source-auditor",
      prompt: "audit",
      schema: auditResultSchema,
    })
    expect(agentsUsed()).not.toContain("json-fixer")
    const repairPrompt = promptCalls[1]?.parts[0]?.text ?? ""
    expect(repairPrompt).toContain("<zod_issues>")
  })

  test("approve-with-findings superRefine → B reprompt", async () => {
    promptScript.push(
      () =>
        assistantText(
          JSON.stringify({
            vote: "approve",
            summary: "ok",
            findings: [
              {
                severity: "blocker",
                category: "clarity",
                issue: "bad",
                evidence: ["x"],
                required_fix: "fix",
              },
            ],
          }),
        ),
      () => assistantText(validAuditJson()),
    )
    const result = await promptAgent({
      config: testConfig,
      sessionID: "s-1",
      agent: "source-auditor",
      prompt: "audit",
      schema: auditResultSchema,
    })
    expect(result.structured?.vote).toBe("approve")
    expect(agentsUsed()).not.toContain("json-fixer")
  })

  test("budget exhausted → StructuredRecoveryError with fault preserved", async () => {
    promptScript.push(() => assistantText("not json at all"))
    const capture = debugLogCapture()
    await expect(
      promptAgent({
        config: testConfig,
        sessionID: "s-1",
        agent: "source-auditor",
        prompt: "audit",
        schema: auditResultSchema,
        telemetry: { name: "test", debugLog: capture.log },
      }),
    ).rejects.toMatchObject({ name: "StructuredRecoveryError" })
    expect(capture.entries.some((e) => e.type === "session.recovery.classify")).toBe(true)
  })
})

describe("transport retry", () => {
  test("response.error once → second call ok", async () => {
    promptScript.push(
      () => ({ error: { message: "transient" } }),
      () => assistantText(validAuditJson()),
    )
    const result = await promptAgent({
      config: testConfig,
      sessionID: "s-1",
      agent: "source-auditor",
      prompt: "audit",
      schema: auditResultSchema,
    })
    expect(result.structured?.vote).toBe("approve")
    expect(promptCalls).toHaveLength(2)
  })

  test("empty inline + Continue returns error → transport fault", async () => {
    promptScript.push(
      () => assistantText(""),
      () => ({ error: { message: "continue failed" } }),
    )
    await expect(
      promptAgent({
        config: testConfig,
        sessionID: "s-1",
        agent: "source-auditor",
        prompt: "audit",
        schema: z.object({ ok: z.literal(true) }),
      }),
    ).rejects.toMatchObject({ name: "StructuredRecoveryError", fault: "transport" })
  })
})

describe("auditWithRestart (Phase 3.5)", () => {
  test("StructuredRecoveryError once → valid on attempt 2", async () => {
    const sessions: string[] = ["first"]
    let attempt = 0
    const result = await auditWithRestart({
      maxRestarts: 1,
      agent: "source-auditor",
      round: 0,
      requestId: "req-1",
      titleBase: "audit:req-1:source-auditor:round:0",
      firstSessionID: "first",
      createSession: async () => {
        const id = `restart-${sessions.length}`
        sessions.push(id)
        return { id }
      },
      onSessionCreated: () => {},
      runAttempt: async () => {
        attempt += 1
        if (attempt === 1) throw new StructuredRecoveryError("schema", 2, new Error("bad"))
        return { vote: "approve" }
      },
    })
    expect(result).toEqual({ vote: "approve" })
    expect(sessions).toEqual(["first", "restart-1"])
  })

  test("plain Error propagates unchanged with one session", async () => {
    let createCount = 0
    await expect(
      auditWithRestart({
        maxRestarts: 1,
        agent: "source-auditor",
        round: 0,
        requestId: "req-1",
        titleBase: "audit",
        firstSessionID: "first",
        createSession: async () => {
          createCount += 1
          return { id: "restart" }
        },
        onSessionCreated: () => {},
        runAttempt: async () => {
          throw new Error("programmer bug")
        },
      }),
    ).rejects.toThrow("programmer bug")
    expect(createCount).toBe(0)
  })

  test("always StructuredRecoveryError with maxRestarts 1 → two sessions then throw", async () => {
    const sessions: string[] = ["first"]
    await expect(
      auditWithRestart({
        maxRestarts: 1,
        agent: "source-auditor",
        round: 0,
        requestId: "req-1",
        titleBase: "audit",
        firstSessionID: "first",
        createSession: async () => {
          const id = `restart-${sessions.length}`
          sessions.push(id)
          return { id }
        },
        onSessionCreated: () => {},
        runAttempt: async () => {
          throw new StructuredRecoveryError("syntax", 3, new Error("bad"))
        },
      }),
    ).rejects.toBeInstanceOf(StructuredRecoveryError)
    expect(sessions).toHaveLength(2)
  })

  test("maxRestarts 0 kill-switch → no restart session", async () => {
    let createCount = 0
    const capture = debugLogCapture()
    await expect(
      auditWithRestart({
        maxRestarts: 0,
        agent: "source-auditor",
        round: 0,
        requestId: "req-1",
        titleBase: "audit",
        firstSessionID: "first",
        createSession: async () => {
          createCount += 1
          return { id: "restart" }
        },
        onSessionCreated: () => {},
        runAttempt: async () => {
          throw new StructuredRecoveryError("schema", 2, new Error("bad"))
        },
        debugLog: capture.log,
      }),
    ).rejects.toBeInstanceOf(StructuredRecoveryError)
    expect(createCount).toBe(0)
    expect(capture.entries.some((e) => e.type === "audit.restart_from_scratch")).toBe(false)
  })
})

describe("persistence (Phase 4)", () => {
  test("inline-valid with outputFile persists before returning", async () => {
    const outputFile = join(tempDir, "audit.json")
    await mkdir(tempDir, { recursive: true })
    promptScript.push(() => assistantText(validAuditJson()))
    const result = await promptAgent({
      config: testConfig,
      sessionID: "s-1",
      agent: "source-auditor",
      prompt: "audit",
      schema: auditResultSchema,
      outputFile,
    })
    expect(result.structured?.vote).toBe("approve")
    expect(await Bun.file(outputFile).exists()).toBe(true)
    expect(JSON.parse(await Bun.file(outputFile).text())).toEqual(result.structured)
  })

  test("persist failure escalates instead of phantom success", async () => {
    const outputFile = "/dev/null/cannot-write-here/audit.json"
    promptScript.push(() => assistantText(validAuditJson()))
    await expect(
      promptAgent({
        config: testConfig,
        sessionID: "s-1",
        agent: "source-auditor",
        prompt: "audit",
        schema: auditResultSchema,
        outputFile,
      }),
    ).rejects.toBeInstanceOf(StructuredRecoveryError)
    expect(await Bun.file(outputFile).exists()).toBe(false)
  })

  test("inline + different valid file → session.dual_output; file preferred", async () => {
    const outputFile = join(tempDir, "audit.json")
    await mkdir(tempDir, { recursive: true })
    const fileStruct = { vote: "approve", summary: "from-file", findings: [] }
    await writeFile(outputFile, JSON.stringify(fileStruct, null, 2), "utf8")
    promptScript.push(() => assistantText(validAuditJson({ summary: "from-inline" })))
    const capture = debugLogCapture()
    const result = await promptAgent({
      config: testConfig,
      sessionID: "s-1",
      agent: "source-auditor",
      prompt: "audit",
      schema: auditResultSchema,
      outputFile,
      telemetry: { name: "test", debugLog: capture.log },
    })
    expect(result.structured?.summary).toBe("from-file")
    const dual = capture.entries.find((e) => e.type === "session.dual_output")
    expect(dual).toBeDefined()
    expect(dual?.data?.diverged).toBe(true)
  })

  test("session.dual_output carries requestId/round from telemetry.metadata", async () => {
    const outputFile = join(tempDir, "audit.json")
    await mkdir(tempDir, { recursive: true })
    const fileStruct = { vote: "approve", summary: "from-file", findings: [] }
    await writeFile(outputFile, JSON.stringify(fileStruct, null, 2), "utf8")
    promptScript.push(() => assistantText(validAuditJson({ summary: "from-inline" })))
    const capture = debugLogCapture()
    await promptAgent({
      config: testConfig,
      sessionID: "s-1",
      agent: "source-auditor",
      prompt: "audit",
      schema: auditResultSchema,
      outputFile,
      telemetry: { name: "test", debugLog: capture.log, metadata: { requestId: "req-42", round: 2 } },
    }).catch(() => undefined)
    const dual = capture.entries.find((e) => e.type === "session.dual_output")
    expect(dual?.data?.requestId).toBe("req-42")
    expect(dual?.data?.round).toBe(2)
  })

  test("malformed file + valid inline → no session.dual_output (not a divergence)", async () => {
    const outputFile = join(tempDir, "audit.json")
    await mkdir(tempDir, { recursive: true })
    // A broken file is a different failure mode (router handles it), not a
    // dual-output divergence — must not noise session.dual_output. Recovery
    // may succeed or throw; the invariant under test is only the event absence.
    await writeFile(outputFile, "{ not valid json ", "utf8")
    promptScript.push(() => assistantText(validAuditJson()))
    const capture = debugLogCapture()
    await promptAgent({
      config: testConfig,
      sessionID: "s-1",
      agent: "source-auditor",
      prompt: "audit",
      schema: auditResultSchema,
      outputFile,
      telemetry: { name: "test", debugLog: capture.log },
    }).catch(() => undefined)
    expect(capture.entries.some((e) => e.type === "session.dual_output")).toBe(false)
  })
})

describe("non-structured path", () => {
  test("returns text with zero recovery events", async () => {
    promptScript.push(() => assistantText("plain markdown draft"))
    const capture = debugLogCapture()
    const result = await promptAgent({
      config: testConfig,
      sessionID: "s-1",
      agent: "research-drafter",
      prompt: "write",
      telemetry: { name: "test", debugLog: capture.log },
    })
    expect(result.text).toBe("plain markdown draft")
    expect(result.structured).toBeUndefined()
    expect(capture.entries.some((e) => e.type.startsWith("session.recovery."))).toBe(false)
  })
})

describe("structured happy path", () => {
  test("first-try valid structured output emits zero recovery events", async () => {
    promptScript.push(() => assistantText(validAuditJson()))
    const capture = debugLogCapture()
    const result = await promptAgent({
      config: testConfig,
      sessionID: "s-1",
      agent: "source-auditor",
      prompt: "audit",
      schema: auditResultSchema,
      telemetry: { name: "test", debugLog: capture.log },
    })
    expect(result.structured?.vote).toBe("approve")
    expect(capture.entries.some((e) => e.type.startsWith("session.recovery."))).toBe(false)
    expect(capture.entries.some((e) => e.type === "session.repair.json_fixer")).toBe(false)
    expect(capture.entries.some((e) => e.type === "session.dual_output")).toBe(false)
  })
})

describe("recovery drift (Phase 6)", () => {
  test("same agent restarted across two distinct requestIds → systemic drift", async () => {
    const capture = debugLogCapture()
    const base = {
      maxRestarts: 1,
      agent: "source-auditor",
      round: 0,
      titleBase: "audit",
      firstSessionID: "first",
      createSession: async () => ({ id: "restart" }),
      onSessionCreated: () => {},
      runAttempt: async () => {
        throw new StructuredRecoveryError("schema", 2, new Error("bad"))
      },
      debugLog: capture.log,
    }

    await expect(auditWithRestart({ ...base, requestId: "req-1" })).rejects.toBeInstanceOf(StructuredRecoveryError)
    await expect(auditWithRestart({ ...base, requestId: "req-2" })).rejects.toBeInstanceOf(SystemicDriftError)
    expect(capture.entries.some((e) => e.type === "recovery.systemic_drift")).toBe(true)
  })

  test("same requestId restart twice does not trigger drift", async () => {
    const capture = debugLogCapture()
    let attempt = 0
    await expect(
      auditWithRestart({
        maxRestarts: 1,
        agent: "source-auditor",
        round: 0,
        requestId: "req-1",
        titleBase: "audit",
        firstSessionID: "first",
        createSession: async () => ({ id: "restart" }),
        onSessionCreated: () => {},
        debugLog: capture.log,
        runAttempt: async () => {
          attempt += 1
          if (attempt <= 2) throw new StructuredRecoveryError("schema", 2, new Error("bad"))
          return { ok: true }
        },
      }),
    ).rejects.toBeInstanceOf(StructuredRecoveryError)
    expect(capture.entries.some((e) => e.type === "recovery.systemic_drift")).toBe(false)
  })
})
