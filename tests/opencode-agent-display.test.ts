import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  readOpencodeAgentForConfigRoles,
  renderOpencodeAgentReadonly,
} from "../src/view/opencode-agent-display"
import { listDefaultsOpencodeAgents } from "../src/defaults-store"
import { configuredAgentRoles, READER_PROFILE_REPAIRER_ROLE } from "../src/role-registry"
import { prepareTestDataDir, testRuntimeConfig } from "./test-env"

describe("reader-profile-repairer on config surfaces", () => {
  let dir = ""

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "qurom-agent-display-"))
    await prepareTestDataDir(dir)
  })

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = ""
  })

  test("configuredAgentRoles includes the repairer", () => {
    const config = testRuntimeConfig({ dataDir: join(dir, "data"), workspaceDir: dir })
    expect(configuredAgentRoles(config)).toContain(READER_PROFILE_REPAIRER_ROLE)
  })

  test("shipped defaults include the repairer agent def", async () => {
    const agents = await listDefaultsOpencodeAgents(dir)
    const repairer = agents.find((agent) => agent.role === READER_PROFILE_REPAIRER_ROLE)
    expect(repairer).toBeDefined()
    expect(repairer?.content).toContain("Repairs reader-profile intent into primary + secondaryGoals")
  })

  test("Roles config falls back to shipped agent def when .opencode copy is missing", async () => {
    const view = await readOpencodeAgentForConfigRoles(dir, READER_PROFILE_REPAIRER_ROLE)
    expect(view.content).toContain("Repairs reader-profile intent into primary + secondaryGoals")
    expect(view.relativePath).toBe(`.opencode/agents/${READER_PROFILE_REPAIRER_ROLE}.md`)
    expect(view.sourceNote).toContain(`defaults/opencode/agents/${READER_PROFILE_REPAIRER_ROLE}.md`)

    const html = renderOpencodeAgentReadonly(view)
    expect(html).toContain("config-readonly-agent")
    expect(html).toContain("Repairs reader-profile intent")
    expect(html).toContain(`.opencode/agents/${READER_PROFILE_REPAIRER_ROLE}.md`)
  })

  test("Roles config prefers the active .opencode agent file when present", async () => {
    const agentsDir = join(dir, ".opencode", "agents")
    await mkdir(agentsDir, { recursive: true })
    await writeFile(
      join(agentsDir, `${READER_PROFILE_REPAIRER_ROLE}.md`),
      "---\ndescription: Active copy\nmode: subagent\n---\n",
      "utf8",
    )

    const view = await readOpencodeAgentForConfigRoles(dir, READER_PROFILE_REPAIRER_ROLE)
    expect(view.content).toContain("Active copy")
    expect(view.sourceNote).toBeUndefined()
    expect(renderOpencodeAgentReadonly(view)).toContain(`.opencode/agents/${READER_PROFILE_REPAIRER_ROLE}.md`)
  })

  test("non-interactive bootstrap seeds missing agent files without overwriting locals", async () => {
    const { resolveOpencodeBootstrap } = await import("../src/opencode-bootstrap")
    const agentsDir = join(dir, ".opencode", "agents")
    await mkdir(agentsDir, { recursive: true })
    await writeFile(join(agentsDir, "research-drafter.md"), "---\ndescription: local\n---\n", "utf8")

    const prev = process.env.QUORUM_OPENCODE_BOOTSTRAP
    delete process.env.QUORUM_OPENCODE_BOOTSTRAP
    try {
      await resolveOpencodeBootstrap({ interactive: false, workspaceDir: dir })
    } finally {
      if (prev === undefined) delete process.env.QUORUM_OPENCODE_BOOTSTRAP
      else process.env.QUORUM_OPENCODE_BOOTSTRAP = prev
    }

    const repairer = await Bun.file(join(agentsDir, `${READER_PROFILE_REPAIRER_ROLE}.md`)).text()
    expect(repairer).toContain("Repairs reader-profile intent into primary + secondaryGoals")
    expect(await Bun.file(join(agentsDir, "research-drafter.md")).text()).toContain("description: local")
  })
})
