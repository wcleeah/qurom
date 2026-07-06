import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createHighlight, setPageNotes } from "../src/view/library-notes-store.ts"
import {
  addArticleTag,
  addNoteTag,
  inheritArticleTagsToNote,
  listArticleTags,
  listNoteTags,
  normalizeTagSlug,
  propagateArticleTagsToNotes,
  removeArticleTag,
  removeNoteTag,
  replaceAgentArticleTags,
} from "../src/tags-store.ts"

let dir: string
let originalDataDir: string | undefined
let originalRunsDir: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qurom-tags-store-"))
  await mkdir(join(dir, "runs", "alpha-run"), { recursive: true })

  originalDataDir = process.env.QUORUM_DATA_DIR
  originalRunsDir = process.env.QUORUM_RUNS_DIR
  process.env.QUORUM_DATA_DIR = dir
  process.env.QUORUM_RUNS_DIR = join(dir, "runs")
})

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.QUORUM_DATA_DIR
  else process.env.QUORUM_DATA_DIR = originalDataDir
  if (originalRunsDir === undefined) delete process.env.QUORUM_RUNS_DIR
  else process.env.QUORUM_RUNS_DIR = originalRunsDir
  await rm(dir, { recursive: true, force: true })
})

describe("tags store", () => {
  test("normalizeTagSlug lowercases and hyphenates", () => {
    expect(normalizeTagSlug("Machine Learning")).toBe("machine-learning")
    expect(normalizeTagSlug("  API Design  ")).toBe("api-design")
  })

  test("replaceAgentArticleTags replaces only agent tags", async () => {
    await replaceAgentArticleTags("alpha-run", [
      { slug: "systems", label: "Systems", matchedPredefined: false },
    ])
    await addArticleTag("alpha-run", "user-pick")

    await replaceAgentArticleTags("alpha-run", [
      { slug: "distributed", label: "Distributed", matchedPredefined: false },
    ])

    const tags = await listArticleTags("alpha-run")
    expect(tags.map((tag) => tag.slug).sort()).toEqual(["distributed", "user-pick"])
    expect(tags.find((tag) => tag.slug === "distributed")?.articleSource).toBe("agent")
    expect(tags.find((tag) => tag.slug === "user-pick")?.articleSource).toBe("user")
  })

  test("removeArticleTag only removes user tags", async () => {
    await replaceAgentArticleTags("alpha-run", [
      { slug: "agent-only", label: "Agent Only", matchedPredefined: false },
    ])
    await addArticleTag("alpha-run", "manual")

    expect(await removeArticleTag("alpha-run", "agent-only")).toBe(false)
    expect(await removeArticleTag("alpha-run", "manual")).toBe(true)
    expect((await listArticleTags("alpha-run")).map((tag) => tag.slug)).toEqual(["agent-only"])
  })

  test("new notes inherit article tags on create", async () => {
    await replaceAgentArticleTags("alpha-run", [
      { slug: "systems", label: "Systems", matchedPredefined: false },
      { slug: "runtime", label: "Runtime", matchedPredefined: false },
    ])

    const highlight = await createHighlight({
      runName: "alpha-run",
      filePath: "final.html",
      color: "yellow",
      quote: "Important quote",
    })

    const highlightTags = await listNoteTags(highlight.id)
    expect(highlightTags.map((tag) => tag.slug).sort()).toEqual(["runtime", "systems"])
    expect(highlightTags.every((tag) => tag.noteSource === "propagated")).toBe(true)

    await setPageNotes("alpha-run", "final.html", "Page thoughts")
    const { getPageNoteLibraryId } = await import("../src/view/library-notes-store.ts")
    const pageNoteId = await getPageNoteLibraryId("alpha-run", "final.html")
    expect(pageNoteId).toBeTruthy()
    const pageTags = await listNoteTags(pageNoteId!)
    expect(pageTags.map((tag) => tag.slug).sort()).toEqual(["runtime", "systems"])
  })

  test("propagateArticleTagsToNotes replaces propagated tags and keeps user tags", async () => {
    const highlight = await createHighlight({
      runName: "alpha-run",
      filePath: "final.html",
      color: "yellow",
      quote: "Important quote",
    })
    await setPageNotes("alpha-run", "final.html", "Page thoughts")
    await replaceAgentArticleTags("alpha-run", [
      { slug: "systems", label: "Systems", matchedPredefined: false },
    ])
    await addNoteTag(highlight.id, "user-tag", 8)

    await propagateArticleTagsToNotes("alpha-run")

    const highlightTags = await listNoteTags(highlight.id)
    expect(highlightTags.map((tag) => tag.slug).sort()).toEqual(["systems", "user-tag"])
    expect(highlightTags.find((tag) => tag.slug === "systems")?.noteSource).toBe("propagated")
    expect(highlightTags.find((tag) => tag.slug === "user-tag")?.noteSource).toBe("user")

    await replaceAgentArticleTags("alpha-run", [
      { slug: "distributed", label: "Distributed", matchedPredefined: false },
    ])
    await propagateArticleTagsToNotes("alpha-run")

    const updated = await listNoteTags(highlight.id)
    expect(updated.map((tag) => tag.slug).sort()).toEqual(["distributed", "user-tag"])
  })

  test("removeNoteTag can target propagated tags", async () => {
    const highlight = await createHighlight({
      runName: "alpha-run",
      filePath: "final.html",
      color: "pink",
      quote: "Quote",
    })
    await addNoteTag(highlight.id, "propagated-tag", 8)
    await withPropagatedTag(highlight.id, "propagated-tag")

    expect(await removeNoteTag(highlight.id, "propagated-tag", "propagated")).toBe(true)
    expect(await listNoteTags(highlight.id)).toEqual([])
  })
})

async function withPropagatedTag(noteId: string, slug: string): Promise<void> {
  const { withHtmlReaderDb } = await import("../src/view/html-reader-db.ts")
  await withHtmlReaderDb((db) => {
    db.query(
      `UPDATE note_tags SET source = 'propagated' WHERE note_id = ? AND tag_slug = ?`,
    ).run(noteId, slug)
  })
}
