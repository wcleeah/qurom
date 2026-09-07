import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyRoleBindingSnapshot,
  canonicalRoleBindingJson,
  deleteRoleBindingSnapshot,
  ensureConfigInitialized,
  getConfigStore,
  listRoleBindingSnapshots,
  loadRoleBindingsFromStore,
  overwriteRoleBindingSnapshot,
  renameRoleBindingSnapshot,
  saveRoleBindingSnapshot,
  updateRoleBinding,
} from "../src/config-store"
import { handleConfigPost, renderConfigRoles } from "../src/view/config"
import { renderConfigDefaultsBindings } from "../src/view/config-defaults"
import { prepareTestDataDir, testRuntimeEnv } from "./test-env"

let dir: string
let dataDir: string
const savedEnv: Record<string, string | undefined> = {}

function env() {
  return testRuntimeEnv({ dataDir, workspaceDir: dir })
}

function bindViewEnv() {
  const runtimeEnv = env()
  for (const key of [
    "OPENCODE_DIRECTORY",
    "QUORUM_WORKSPACE_DIRECTORY",
    "QUORUM_DATA_DIR",
    "QUORUM_CONFIG_DB_PATH",
    "QUORUM_CHECKPOINT_PATH",
    "QUORUM_RUNS_DIR",
  ] as const) {
    savedEnv[key] = process.env[key]
  }
  process.env.OPENCODE_DIRECTORY = dir
  process.env.QUORUM_WORKSPACE_DIRECTORY = dir
  process.env.QUORUM_DATA_DIR = dataDir
  process.env.QUORUM_CONFIG_DB_PATH = runtimeEnv.QUORUM_CONFIG_DB_PATH
  process.env.QUORUM_CHECKPOINT_PATH = runtimeEnv.QUORUM_CHECKPOINT_PATH
  process.env.QUORUM_RUNS_DIR = runtimeEnv.QUORUM_RUNS_DIR
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-binding-snapshots-"))
  dataDir = await prepareTestDataDir(dir)
  bindViewEnv()
  await ensureConfigInitialized(env())
})

afterEach(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(dir, { recursive: true, force: true })
})

async function postRoles(path: string, body?: Record<string, string>) {
  return handleConfigPost(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body ? new URLSearchParams(body).toString() : "",
    }),
    path,
  )
}

describe("role binding snapshots", () => {
  test("empty Roles page offers save-current and does not touch defaults", async () => {
    const html = await renderConfigRoles().then((response) => response.text())
    expect(html).toContain("Binding snapshots")
    expect(html).toContain("No snapshots. Save the current bindings to switch back later.")
    expect(html).toContain('action="/config/roles/snapshots"')
    expect(html).toContain("data-snapshot-form")
    expect(html).toContain("qurom:cancel-autosave")

    const defaultsHtml = await renderConfigDefaultsBindings().then((response) => response.text())
    expect(defaultsHtml).not.toContain("Binding snapshots")
    expect(defaultsHtml).not.toContain("/config/roles/snapshots")
  })

  test("save, apply, overwrite, rename, and delete snapshots on the active profile", async () => {
    const original = (await loadRoleBindingsFromStore(env()))["source-auditor"]
    expect(original).toBeDefined()

    await saveRoleBindingSnapshot(env(), "  cheap mix  ")
    let snapshots = await listRoleBindingSnapshots(env())
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({
      name: "cheap mix",
      matchesLive: true,
      isLastUsed: true,
    })
    expect(snapshots[0].roleCount).toBeGreaterThan(1)

    await updateRoleBinding(env(), "source-auditor", {
      provider: "cursor",
      model: "composer-2.5",
      options: { runtime: "cloud" },
    })
    snapshots = await listRoleBindingSnapshots(env())
    expect(snapshots[0]?.matchesLive).toBe(false)
    expect(snapshots[0]?.isLastUsed).toBe(true)

    const htmlModified = await renderConfigRoles().then((response) => response.text())
    expect(htmlModified).toContain("cheap mix")
    expect(htmlModified).toContain("Modified from snapshot")
    expect(htmlModified).toContain(`action="/config/roles/snapshots/${snapshots[0].id}/apply"`)

    await applyRoleBindingSnapshot(env(), snapshots[0].id)
    expect(canonicalRoleBindingJson((await loadRoleBindingsFromStore(env()))["source-auditor"]))
      .toBe(canonicalRoleBindingJson(original))
    snapshots = await listRoleBindingSnapshots(env())
    expect(snapshots[0]?.matchesLive).toBe(true)

    await updateRoleBinding(env(), "source-auditor", {
      provider: "cursor",
      model: "grok-4.6",
      options: {},
    })
    await overwriteRoleBindingSnapshot(env(), snapshots[0].id)
    await updateRoleBinding(env(), "source-auditor", {
      provider: "opencode",
      providerAgent: "source-auditor",
      options: {},
    })
    await applyRoleBindingSnapshot(env(), snapshots[0].id)
    expect((await loadRoleBindingsFromStore(env()))["source-auditor"]).toMatchObject({
      provider: "cursor",
      model: "grok-4.6",
    })

    await renameRoleBindingSnapshot(env(), snapshots[0].id, "quality mix")
    snapshots = await listRoleBindingSnapshots(env())
    expect(snapshots[0]?.name).toBe("quality mix")

    await deleteRoleBindingSnapshot(env(), snapshots[0].id)
    expect(await listRoleBindingSnapshots(env())).toEqual([])
  })

  test("apply upserts snapshot roles and leaves extra live roles alone", async () => {
    await saveRoleBindingSnapshot(env(), "base")
    const snapshot = (await listRoleBindingSnapshots(env()))[0]
    await updateRoleBinding(env(), "extra-test-role", {
      provider: "cursor",
      model: "composer-2.5",
      options: { runtime: "cloud" },
    })
    await updateRoleBinding(env(), "source-auditor", {
      provider: "cursor",
      model: "composer-2.5",
      options: {},
    })

    await applyRoleBindingSnapshot(env(), snapshot.id)
    const bindings = await loadRoleBindingsFromStore(env())
    expect(bindings["extra-test-role"]).toMatchObject({
      provider: "cursor",
      model: "composer-2.5",
    })
    expect(bindings["source-auditor"]?.provider).not.toBe("cursor")
  })

  test("rejects empty, duplicate, and oversized snapshot names", async () => {
    await expect(saveRoleBindingSnapshot(env(), "   ")).rejects.toThrow("Snapshot name is required")
    await saveRoleBindingSnapshot(env(), "cheap mix")
    await expect(saveRoleBindingSnapshot(env(), "cheap mix")).rejects.toThrow('A snapshot named "cheap mix" already exists')
    await expect(saveRoleBindingSnapshot(env(), "x".repeat(81))).rejects.toThrow("80 characters or fewer")
  })

  test("view routes save and apply snapshots without writing a snapshots role", async () => {
    const save = await postRoles("/config/roles/snapshots", { name: "cheap mix" })
    expect(save?.status).toBe(303)
    expect(save?.headers.get("Location")).toBe("/config/roles")

    const snapshots = await listRoleBindingSnapshots(env())
    expect(snapshots[0]?.name).toBe("cheap mix")
    expect((await loadRoleBindingsFromStore(env())).snapshots).toBeUndefined()

    await updateRoleBinding(env(), "source-auditor", {
      provider: "cursor",
      model: "composer-2.5",
      options: {},
    })
    const apply = await postRoles(`/config/roles/snapshots/${snapshots[0].id}/apply`)
    expect(apply?.status).toBe(303)
    expect((await loadRoleBindingsFromStore(env()))["source-auditor"]?.provider).not.toBe("cursor")

    const html = await renderConfigRoles().then((response) => response.text())
    expect(html).toContain("Matches")
    expect(html).toContain("data-snapshot-form")
    expect(html).toContain(`data-snapshot-id="${snapshots[0].id}"`)
    expect(html).toContain('data-snapshot-chip="matches"')

    const autosave = await handleConfigPost(
      new Request("http://localhost/config/roles/source-auditor", {
        method: "POST",
        headers: { accept: "application/json" },
        body: new URLSearchParams({
          provider: "cursor",
          model: "composer-2.5",
        }),
      }),
      "/config/roles/source-auditor",
    )
    expect(await autosave?.json()).toEqual({
      ok: true,
      lastUsedSnapshot: { id: snapshots[0].id, matchesLive: false },
    })

    const duplicate = await postRoles("/config/roles/snapshots", { name: "cheap mix" })
    expect(duplicate?.status).toBe(200)
    expect(await duplicate?.text()).toContain("already exists")

    const store = getConfigStore(env())
    const snapshotTable = store.db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'role_binding_presets'")
      .get()
    store.close()
    expect(snapshotTable?.name).toBe("role_binding_presets")
  })
})
