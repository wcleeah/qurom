import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createAgentRuntime } from "../src/agent-runtime/runtime"
import {
  prependFrontendDesignSkill,
  readFrontendDesignSkill,
  usesFrontendDesignSkill,
} from "../src/frontend-design-skill"
import { applyOpencodeSkillsBootstrap } from "../src/opencode-bootstrap"
import type { AgentProvider } from "../src/providers/types"
import { DESIGN_QUORUM_ROLES } from "../src/role-registry"
import { listDefaultsOpencodeAgents, listDefaultsPrompts } from "../src/defaults-store"
import { prepareTestDataDir, testRuntimeConfig } from "./test-env"

describe("frontend-design skill", () => {
  let dir = ""

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "qurom-frontend-design-"))
    await prepareTestDataDir(dir)
  })

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = ""
  })

  test("is limited to design quorum roles", () => {
    expect(DESIGN_QUORUM_ROLES).toEqual([
      "html-designer",
      "graphical-enhancer",
      "reading-experience-enhancer",
    ])
    for (const role of DESIGN_QUORUM_ROLES) {
      expect(usesFrontendDesignSkill(role)).toBe(true)
    }
    expect(usesFrontendDesignSkill("html-repair")).toBe(false)
    expect(usesFrontendDesignSkill("research-drafter")).toBe(false)
  })

  test("ships Anthropic skill text and license", async () => {
    const skill = await readFrontendDesignSkill(dir)
    expect(skill).toContain("name: frontend-design")
    expect(skill).toContain("# Frontend Design")
    expect(skill).toContain("Work in two passes")

    const license = await Bun.file(join(dir, "defaults", "opencode", "skills", "frontend-design", "LICENSE.txt")).text()
    expect(license).toContain("Apache License")
  })

  test("inlines the skill around the task prompt", async () => {
    const wrapped = await prependFrontendDesignSkill("Design this page.", dir)
    expect(wrapped.startsWith("The `frontend-design` skill is included below.")).toBe(true)
    expect(wrapped).toContain("<frontend_design_skill>")
    expect(wrapped).toContain("name: frontend-design")
    expect(wrapped).toContain("</frontend_design_skill>")
    expect(wrapped.endsWith("Design this page.")).toBe(true)
  })

  test("bootstrap seeds missing skill files without overwriting locals", async () => {
    const skillsDir = join(dir, ".opencode", "skills", "frontend-design")
    await mkdir(skillsDir, { recursive: true })
    await writeFile(join(skillsDir, "SKILL.md"), "---\nname: frontend-design\n---\nlocal\n", "utf8")

    await applyOpencodeSkillsBootstrap("seed", dir)
    expect(await Bun.file(join(skillsDir, "SKILL.md")).text()).toContain("local")
    expect(await Bun.file(join(skillsDir, "LICENSE.txt")).exists()).toBe(true)

    await applyOpencodeSkillsBootstrap("overwrite", dir)
    const overwritten = await Bun.file(join(skillsDir, "SKILL.md")).text()
    expect(overwritten).toContain("# Frontend Design")
    expect(overwritten).not.toContain("local")
  })

  test("design agents allow only frontend-design; other shipped agents still deny skills", async () => {
    const agents = await listDefaultsOpencodeAgents(dir)
    const byRole = Object.fromEntries(agents.map((agent) => [agent.role, agent.content]))

    for (const role of DESIGN_QUORUM_ROLES) {
      expect(byRole[role]).toContain("frontend-design: allow")
      expect(byRole[role]).toContain("\"*\": deny")
    }
    expect(byRole["html-repair"]).toContain("skill: deny")
    expect(byRole["research-drafter"]).toContain("skill: deny")
  })

  test("design prompts require the skill and no longer pin a grey SaaS palette", async () => {
    const prompts = await listDefaultsPrompts(dir)
    const byKey = Object.fromEntries(prompts.map((prompt) => [prompt.key, prompt.content]))

    expect(byKey.htmlDesignerDesign).toContain("## frontend-design")
    expect(byKey.htmlDesignerDesign).toContain("Taste is yours")
    expect(byKey.htmlDesignerDesign).not.toContain("Neutral minimal")
    expect(byKey.htmlDesignerDesign).not.toContain("--grey-50")

    expect(byKey.graphicalEnhancerEnhance).toContain("Do not re-theme")
    expect(byKey.graphicalEnhancerEnhance).toContain("## frontend-design")
    expect(byKey.readingExperienceEnhancerEnhance).toContain("Do not re-theme")
    expect(byKey.readingExperienceEnhancerEnhance).toContain("## frontend-design")
  })

  test("runtime inlines the skill for design roles only", async () => {
    let designerPrompt = ""
    let drafterPrompt = ""
    const provider: AgentProvider = {
      id: "fake",
      capabilities: new Set(["plainTextOutput", "plainJsonOutput"]),
      async createRunHandle(input) {
        return { id: `handle:${input.role}`, providerId: "fake", role: input.role, title: input.title }
      },
      async prompt(input) {
        if (input.role === "html-designer") designerPrompt = input.prompt
        if (input.role === "research-drafter") drafterPrompt = input.prompt
        return { text: "ok" }
      },
    }
    const runtime = createAgentRuntime(
      testRuntimeConfig({ dataDir: join(dir, "data"), workspaceDir: dir }),
      undefined,
      { providerForRole: () => provider },
    )

    const designer = await runtime.createHandle("html-designer", "design")
    await runtime.prompt({ role: "html-designer", handle: designer, prompt: "Convert the draft." })
    const drafter = await runtime.createHandle("research-drafter", "draft")
    await runtime.prompt({ role: "research-drafter", handle: drafter, prompt: "Write the draft." })

    expect(designerPrompt).toContain("<frontend_design_skill>")
    expect(designerPrompt).toContain("Convert the draft.")
    expect(drafterPrompt).toBe("Write the draft.")
  })

  test("defaults skill directory is a real OpenCode skill package", async () => {
    const names = await readdir(join(dir, "defaults", "opencode", "skills", "frontend-design"))
    expect(names).toContain("SKILL.md")
    expect(names).toContain("LICENSE.txt")
    expect(names).toContain("NOTICE")
  })
})
