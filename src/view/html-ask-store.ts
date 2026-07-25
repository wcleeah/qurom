import { nowIso, validateHtmlReaderTarget, withHtmlReaderDb } from "./html-reader-db"

export const ASK_SCOPES = ["page", "highlight", "selection"] as const
export type AskScope = (typeof ASK_SCOPES)[number]

export const ASK_THREAD_STATUSES = ["idle", "running", "stale"] as const
export type AskThreadStatus = (typeof ASK_THREAD_STATUSES)[number]

export const ASK_MESSAGE_ROLES = ["user", "assistant"] as const
export type AskMessageRole = (typeof ASK_MESSAGE_ROLES)[number]

export interface HtmlReaderAskThread {
  id: string
  runName: string
  htmlFile: string
  mdFile: string
  mdMtimeMs: number
  scope: AskScope
  highlightId: string | null
  contextQuote: string | null
  contextPrefix: string
  contextSuffix: string
  provider: string
  handleId: string | null
  status: AskThreadStatus
  createdAt: string
  updatedAt: string
  lastMessagePreview?: string | null
  firstUserPreview?: string | null
}

export interface HtmlReaderAskMessage {
  id: string
  threadId: string
  role: AskMessageRole
  content: string
  createdAt: string
}

function isAskScope(value: string): value is AskScope {
  return (ASK_SCOPES as readonly string[]).includes(value)
}

function isAskThreadStatus(value: string): value is AskThreadStatus {
  return (ASK_THREAD_STATUSES as readonly string[]).includes(value)
}

function isAskMessageRole(value: string): value is AskMessageRole {
  return (ASK_MESSAGE_ROLES as readonly string[]).includes(value)
}

type ThreadRow = {
  id: string
  run_name: string
  html_file: string
  md_file: string
  md_mtime_ms: number
  scope: string
  highlight_id: string | null
  context_quote: string | null
  context_prefix: string
  context_suffix: string
  provider: string
  handle_id: string | null
  status: string
  created_at: string
  updated_at: string
  last_message_preview?: string | null
  first_user_preview?: string | null
}

function rowToThread(row: ThreadRow): HtmlReaderAskThread {
  return {
    id: row.id,
    runName: row.run_name,
    htmlFile: row.html_file,
    mdFile: row.md_file,
    mdMtimeMs: row.md_mtime_ms,
    scope: isAskScope(row.scope) ? row.scope : "page",
    highlightId: row.highlight_id && row.highlight_id.length > 0 ? row.highlight_id : null,
    contextQuote: row.context_quote,
    contextPrefix: row.context_prefix,
    contextSuffix: row.context_suffix,
    provider: row.provider,
    handleId: row.handle_id,
    status: isAskThreadStatus(row.status) ? row.status : "idle",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessagePreview: row.last_message_preview ?? null,
    firstUserPreview: row.first_user_preview ?? null,
  }
}

function rowToMessage(row: {
  id: string
  thread_id: string
  role: string
  content: string
  created_at: string
}): HtmlReaderAskMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: isAskMessageRole(row.role) ? row.role : "user",
    content: row.content,
    createdAt: row.created_at,
  }
}

export async function listHtmlReaderAskThreads(
  runName: string,
  htmlFile: string,
): Promise<HtmlReaderAskThread[]> {
  validateHtmlReaderTarget(runName, htmlFile)
  return withHtmlReaderDb((db) => {
    const rows = db.query<ThreadRow, [string, string]    >(
      `SELECT t.id, t.run_name, t.html_file, t.md_file, t.md_mtime_ms, t.scope, t.highlight_id,
              t.context_quote, t.context_prefix, t.context_suffix,
              t.provider, t.handle_id, t.status, t.created_at, t.updated_at,
              (
                SELECT m.content FROM html_reader_ask_messages m
                WHERE m.thread_id = t.id
                ORDER BY m.created_at DESC
                LIMIT 1
              ) AS last_message_preview,
              (
                SELECT m.content FROM html_reader_ask_messages m
                WHERE m.thread_id = t.id AND m.role = 'user'
                ORDER BY m.created_at ASC
                LIMIT 1
              ) AS first_user_preview
       FROM html_reader_ask_threads t
       WHERE t.run_name = ? AND t.html_file = ?
         AND EXISTS (
           SELECT 1 FROM html_reader_ask_messages m WHERE m.thread_id = t.id
         )
       ORDER BY t.updated_at DESC`,
    ).all(runName, htmlFile)
    return rows.map(rowToThread)
  })
}

export async function getHtmlReaderAskThread(
  runName: string,
  htmlFile: string,
  threadId: string,
): Promise<HtmlReaderAskThread | null> {
  validateHtmlReaderTarget(runName, htmlFile)
  return withHtmlReaderDb((db) => {
    const row = db.query<ThreadRow, [string, string, string]>(
      `SELECT id, run_name, html_file, md_file, md_mtime_ms, scope, highlight_id,
              context_quote, context_prefix, context_suffix,
              provider, handle_id, status, created_at, updated_at
       FROM html_reader_ask_threads
       WHERE run_name = ? AND html_file = ? AND id = ?
       LIMIT 1`,
    ).get(runName, htmlFile, threadId)
    return row ? rowToThread(row) : null
  })
}

export async function createHtmlReaderAskThread(input: {
  runName: string
  htmlFile: string
  mdFile: string
  mdMtimeMs: number
  scope: AskScope
  highlightId?: string | null
  contextQuote?: string | null
  contextPrefix?: string
  contextSuffix?: string
  provider: string
  handleId?: string | null
}): Promise<HtmlReaderAskThread> {
  validateHtmlReaderTarget(input.runName, input.htmlFile)
  if (input.scope === "highlight" && !input.highlightId) {
    throw new Error("highlightId is required for highlight scope")
  }
  if (input.scope === "selection" && !input.contextQuote?.trim()) {
    throw new Error("contextQuote is required for selection scope")
  }
  const id = crypto.randomUUID()
  const now = nowIso()
  const highlightKey = input.scope === "highlight" ? (input.highlightId ?? "") : ""
  await withHtmlReaderDb((db) => {
    db.query(
      `INSERT INTO html_reader_ask_threads
       (id, run_name, html_file, md_file, md_mtime_ms, scope, highlight_id,
        context_quote, context_prefix, context_suffix, provider, handle_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)`,
    ).run(
      id,
      input.runName,
      input.htmlFile,
      input.mdFile,
      input.mdMtimeMs,
      input.scope,
      highlightKey,
      input.scope === "selection" ? input.contextQuote!.trim() : null,
      input.scope === "selection" ? (input.contextPrefix ?? "") : "",
      input.scope === "selection" ? (input.contextSuffix ?? "") : "",
      input.provider,
      input.handleId ?? null,
      now,
      now,
    )
  })
  return {
    id,
    runName: input.runName,
    htmlFile: input.htmlFile,
    mdFile: input.mdFile,
    mdMtimeMs: input.mdMtimeMs,
    scope: input.scope,
    highlightId: input.scope === "highlight" ? (input.highlightId ?? null) : null,
    contextQuote: input.scope === "selection" ? input.contextQuote!.trim() : null,
    contextPrefix: input.scope === "selection" ? (input.contextPrefix ?? "") : "",
    contextSuffix: input.scope === "selection" ? (input.contextSuffix ?? "") : "",
    provider: input.provider,
    handleId: input.handleId ?? null,
    status: "idle",
    createdAt: now,
    updatedAt: now,
  }
}

export async function updateHtmlReaderAskThread(input: {
  threadId: string
  handleId?: string | null
  status?: AskThreadStatus
  mdMtimeMs?: number
}): Promise<void> {
  const now = nowIso()
  await withHtmlReaderDb((db) => {
    const sets: string[] = ["updated_at = ?"]
    const values: Array<string | number | null> = [now]
    if (input.handleId !== undefined) {
      sets.push("handle_id = ?")
      values.push(input.handleId)
    }
    if (input.status !== undefined) {
      sets.push("status = ?")
      values.push(input.status)
    }
    if (input.mdMtimeMs !== undefined) {
      sets.push("md_mtime_ms = ?")
      values.push(input.mdMtimeMs)
    }
    values.push(input.threadId)
    db.query(`UPDATE html_reader_ask_threads SET ${sets.join(", ")} WHERE id = ?`).run(...values)
  })
}

export async function resetHtmlReaderAskThread(threadId: string): Promise<void> {
  const now = nowIso()
  await withHtmlReaderDb((db) => {
    db.query("DELETE FROM html_reader_ask_messages WHERE thread_id = ?").run(threadId)
    db.query(
      `UPDATE html_reader_ask_threads
       SET handle_id = NULL, status = 'idle', updated_at = ?
       WHERE id = ?`,
    ).run(now, threadId)
  })
}

export async function deleteHtmlReaderAskThread(
  runName: string,
  htmlFile: string,
  threadId: string,
): Promise<boolean> {
  validateHtmlReaderTarget(runName, htmlFile)
  return withHtmlReaderDb((db) => {
    db.query("DELETE FROM html_reader_ask_messages WHERE thread_id = ?").run(threadId)
    const result = db.query(
      "DELETE FROM html_reader_ask_threads WHERE run_name = ? AND html_file = ? AND id = ?",
    ).run(runName, htmlFile, threadId)
    return result.changes > 0
  })
}

export async function deleteEmptyHtmlReaderAskThread(
  runName: string,
  htmlFile: string,
  threadId: string,
): Promise<boolean> {
  const count = await countHtmlReaderAskMessages(threadId)
  if (count > 0) return false
  return deleteHtmlReaderAskThread(runName, htmlFile, threadId)
}

export async function purgeEmptyHtmlReaderAskThreads(runName: string, htmlFile: string): Promise<number> {
  validateHtmlReaderTarget(runName, htmlFile)
  return withHtmlReaderDb((db) => {
    const orphans = db.query<{ id: string }, [string, string]>(
      `SELECT t.id
       FROM html_reader_ask_threads t
       WHERE t.run_name = ? AND t.html_file = ?
         AND NOT EXISTS (
           SELECT 1 FROM html_reader_ask_messages m WHERE m.thread_id = t.id
         )`,
    ).all(runName, htmlFile)
    for (const row of orphans) {
      db.query("DELETE FROM html_reader_ask_threads WHERE id = ?").run(row.id)
    }
    return orphans.length
  })
}

export async function listHtmlReaderAskMessages(threadId: string): Promise<HtmlReaderAskMessage[]> {
  return withHtmlReaderDb((db) => {
    const rows = db.query<
      { id: string; thread_id: string; role: string; content: string; created_at: string },
      [string]
    >(
      `SELECT id, thread_id, role, content, created_at
       FROM html_reader_ask_messages
       WHERE thread_id = ?
       ORDER BY created_at ASC`,
    ).all(threadId)
    return rows.map(rowToMessage)
  })
}

export async function appendHtmlReaderAskMessage(input: {
  threadId: string
  role: AskMessageRole
  content: string
}): Promise<HtmlReaderAskMessage> {
  const content = input.content.trim()
  if (!content) {
    throw new Error("Message content is required")
  }
  const id = crypto.randomUUID()
  const createdAt = nowIso()
  await withHtmlReaderDb((db) => {
    db.query(
      "INSERT INTO html_reader_ask_messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, input.threadId, input.role, content, createdAt)
    db.query("UPDATE html_reader_ask_threads SET updated_at = ? WHERE id = ?").run(createdAt, input.threadId)
  })
  return { id, threadId: input.threadId, role: input.role, content, createdAt }
}

export async function countHtmlReaderAskMessages(threadId: string): Promise<number> {
  return withHtmlReaderDb((db) => {
    const row = db.query<{ count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM html_reader_ask_messages WHERE thread_id = ?",
    ).get(threadId)
    return row?.count ?? 0
  })
}
