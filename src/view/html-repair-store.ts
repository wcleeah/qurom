import { nowIso, validateHtmlReaderTarget, withHtmlReaderDb } from "./html-reader-db"

export const REPAIR_THREAD_STATUSES = ["idle", "running", "stale"] as const
export type RepairThreadStatus = (typeof REPAIR_THREAD_STATUSES)[number]

export const REPAIR_MESSAGE_ROLES = ["user", "assistant"] as const
export type RepairMessageRole = (typeof REPAIR_MESSAGE_ROLES)[number]

export interface HtmlReaderRepairThread {
  id: string
  runName: string
  htmlFile: string
  htmlMtimeMs: number
  contextQuote: string | null
  contextPrefix: string
  contextSuffix: string
  provider: string
  handleId: string | null
  status: RepairThreadStatus
  createdAt: string
  updatedAt: string
  lastMessagePreview?: string | null
  firstUserPreview?: string | null
}

export interface HtmlReaderRepairMessage {
  id: string
  threadId: string
  role: RepairMessageRole
  content: string
  createdAt: string
}

function isRepairThreadStatus(value: string): value is RepairThreadStatus {
  return (REPAIR_THREAD_STATUSES as readonly string[]).includes(value)
}

function isRepairMessageRole(value: string): value is RepairMessageRole {
  return (REPAIR_MESSAGE_ROLES as readonly string[]).includes(value)
}

type ThreadRow = {
  id: string
  run_name: string
  html_file: string
  html_mtime_ms: number
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

function rowToThread(row: ThreadRow): HtmlReaderRepairThread {
  return {
    id: row.id,
    runName: row.run_name,
    htmlFile: row.html_file,
    htmlMtimeMs: row.html_mtime_ms,
    contextQuote: row.context_quote,
    contextPrefix: row.context_prefix,
    contextSuffix: row.context_suffix,
    provider: row.provider,
    handleId: row.handle_id,
    status: isRepairThreadStatus(row.status) ? row.status : "idle",
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
}): HtmlReaderRepairMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: isRepairMessageRole(row.role) ? row.role : "user",
    content: row.content,
    createdAt: row.created_at,
  }
}

export async function listHtmlReaderRepairThreads(
  runName: string,
  htmlFile: string,
): Promise<HtmlReaderRepairThread[]> {
  validateHtmlReaderTarget(runName, htmlFile)
  return withHtmlReaderDb((db) => {
    const rows = db.query<ThreadRow, [string, string]>(
      `SELECT t.id, t.run_name, t.html_file, t.html_mtime_ms,
              t.context_quote, t.context_prefix, t.context_suffix,
              t.provider, t.handle_id, t.status, t.created_at, t.updated_at,
              (
                SELECT m.content FROM html_reader_repair_messages m
                WHERE m.thread_id = t.id
                ORDER BY m.created_at DESC
                LIMIT 1
              ) AS last_message_preview,
              (
                SELECT m.content FROM html_reader_repair_messages m
                WHERE m.thread_id = t.id AND m.role = 'user'
                ORDER BY m.created_at ASC
                LIMIT 1
              ) AS first_user_preview
       FROM html_reader_repair_threads t
       WHERE t.run_name = ? AND t.html_file = ?
         AND EXISTS (
           SELECT 1 FROM html_reader_repair_messages m WHERE m.thread_id = t.id
         )
       ORDER BY t.updated_at DESC`,
    ).all(runName, htmlFile)
    return rows.map(rowToThread)
  })
}

export async function getHtmlReaderRepairThread(
  runName: string,
  htmlFile: string,
  threadId: string,
): Promise<HtmlReaderRepairThread | null> {
  validateHtmlReaderTarget(runName, htmlFile)
  return withHtmlReaderDb((db) => {
    const row = db.query<ThreadRow, [string, string, string]>(
      `SELECT id, run_name, html_file, html_mtime_ms,
              context_quote, context_prefix, context_suffix,
              provider, handle_id, status, created_at, updated_at
       FROM html_reader_repair_threads
       WHERE run_name = ? AND html_file = ? AND id = ?
       LIMIT 1`,
    ).get(runName, htmlFile, threadId)
    return row ? rowToThread(row) : null
  })
}

export async function createHtmlReaderRepairThread(input: {
  runName: string
  htmlFile: string
  htmlMtimeMs: number
  contextQuote?: string | null
  contextPrefix?: string
  contextSuffix?: string
  provider: string
  handleId?: string | null
}): Promise<HtmlReaderRepairThread> {
  validateHtmlReaderTarget(input.runName, input.htmlFile)
  const id = crypto.randomUUID()
  const now = nowIso()
  const quote = input.contextQuote?.trim() || null
  await withHtmlReaderDb((db) => {
    db.query(
      `INSERT INTO html_reader_repair_threads
       (id, run_name, html_file, html_mtime_ms, context_quote, context_prefix, context_suffix,
        provider, handle_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)`,
    ).run(
      id,
      input.runName,
      input.htmlFile,
      input.htmlMtimeMs,
      quote,
      quote ? (input.contextPrefix ?? "") : "",
      quote ? (input.contextSuffix ?? "") : "",
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
    htmlMtimeMs: input.htmlMtimeMs,
    contextQuote: quote,
    contextPrefix: quote ? (input.contextPrefix ?? "") : "",
    contextSuffix: quote ? (input.contextSuffix ?? "") : "",
    provider: input.provider,
    handleId: input.handleId ?? null,
    status: "idle",
    createdAt: now,
    updatedAt: now,
  }
}

export async function updateHtmlReaderRepairThread(input: {
  threadId: string
  handleId?: string | null
  status?: RepairThreadStatus
  htmlMtimeMs?: number
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
    if (input.htmlMtimeMs !== undefined) {
      sets.push("html_mtime_ms = ?")
      values.push(input.htmlMtimeMs)
    }
    values.push(input.threadId)
    db.query(`UPDATE html_reader_repair_threads SET ${sets.join(", ")} WHERE id = ?`).run(...values)
  })
}

export async function resetHtmlReaderRepairThread(threadId: string): Promise<void> {
  const now = nowIso()
  await withHtmlReaderDb((db) => {
    db.query("DELETE FROM html_reader_repair_messages WHERE thread_id = ?").run(threadId)
    db.query(
      `UPDATE html_reader_repair_threads
       SET handle_id = NULL, status = 'idle', updated_at = ?
       WHERE id = ?`,
    ).run(now, threadId)
  })
}

export async function deleteHtmlReaderRepairThread(
  runName: string,
  htmlFile: string,
  threadId: string,
): Promise<boolean> {
  validateHtmlReaderTarget(runName, htmlFile)
  return withHtmlReaderDb((db) => {
    db.query("DELETE FROM html_reader_repair_messages WHERE thread_id = ?").run(threadId)
    const result = db.query(
      "DELETE FROM html_reader_repair_threads WHERE run_name = ? AND html_file = ? AND id = ?",
    ).run(runName, htmlFile, threadId)
    return result.changes > 0
  })
}

export async function deleteEmptyHtmlReaderRepairThread(
  runName: string,
  htmlFile: string,
  threadId: string,
): Promise<boolean> {
  const count = await countHtmlReaderRepairMessages(threadId)
  if (count > 0) return false
  return deleteHtmlReaderRepairThread(runName, htmlFile, threadId)
}

export async function purgeEmptyHtmlReaderRepairThreads(runName: string, htmlFile: string): Promise<number> {
  validateHtmlReaderTarget(runName, htmlFile)
  return withHtmlReaderDb((db) => {
    const orphans = db.query<{ id: string }, [string, string]>(
      `SELECT t.id
       FROM html_reader_repair_threads t
       WHERE t.run_name = ? AND t.html_file = ?
         AND NOT EXISTS (
           SELECT 1 FROM html_reader_repair_messages m WHERE m.thread_id = t.id
         )`,
    ).all(runName, htmlFile)
    for (const row of orphans) {
      db.query("DELETE FROM html_reader_repair_threads WHERE id = ?").run(row.id)
    }
    return orphans.length
  })
}

export async function listHtmlReaderRepairMessages(threadId: string): Promise<HtmlReaderRepairMessage[]> {
  return withHtmlReaderDb((db) => {
    const rows = db.query<
      { id: string; thread_id: string; role: string; content: string; created_at: string },
      [string]
    >(
      `SELECT id, thread_id, role, content, created_at
       FROM html_reader_repair_messages
       WHERE thread_id = ?
       ORDER BY created_at ASC`,
    ).all(threadId)
    return rows.map(rowToMessage)
  })
}

export async function appendHtmlReaderRepairMessage(input: {
  threadId: string
  role: RepairMessageRole
  content: string
}): Promise<HtmlReaderRepairMessage> {
  const content = input.content.trim()
  if (!content) {
    throw new Error("Message content is required")
  }
  const id = crypto.randomUUID()
  const createdAt = nowIso()
  await withHtmlReaderDb((db) => {
    db.query(
      "INSERT INTO html_reader_repair_messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, input.threadId, input.role, content, createdAt)
    db.query("UPDATE html_reader_repair_threads SET updated_at = ? WHERE id = ?").run(createdAt, input.threadId)
  })
  return { id, threadId: input.threadId, role: input.role, content, createdAt }
}

export async function countHtmlReaderRepairMessages(threadId: string): Promise<number> {
  return withHtmlReaderDb((db) => {
    const row = db.query<{ count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM html_reader_repair_messages WHERE thread_id = ?",
    ).get(threadId)
    return row?.count ?? 0
  })
}
