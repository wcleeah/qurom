import { Database } from "bun:sqlite"
import {
  BaseCheckpointSaver,
  TASKS,
  WRITES_IDX_MAP,
  copyCheckpoint,
  getCheckpointId,
  maxChannelVersion,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint"
import type { RunnableConfig } from "@langchain/core/runnables"

type CheckpointRow = {
  thread_id: string
  checkpoint_ns: string
  checkpoint_id: string
  parent_checkpoint_id: string | null
  type: string | null
  checkpoint: Uint8Array
  metadata: Uint8Array
}

type WriteRow = {
  task_id: string
  idx: number
  channel: string
  type: string | null
  value: Uint8Array
}

export class BunSqliteSaver extends BaseCheckpointSaver {
  readonly db: Database
  readonly selectLatestStmt
  readonly selectExactStmt
  readonly selectWritesStmt
  readonly selectParentTaskWritesStmt

  constructor(path: string) {
    super()
    this.db = new Database(path, { create: true, strict: true })
    this.db.run("PRAGMA journal_mode = WAL")
    this.db.run(`
CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint BLOB NOT NULL,
  metadata BLOB NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);
CREATE TABLE IF NOT EXISTS writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  value BLOB NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);
    `)
    this.selectLatestStmt = this.db.query<CheckpointRow, [string, string]>(`
SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
FROM checkpoints
WHERE thread_id = ? AND checkpoint_ns = ?
ORDER BY checkpoint_id DESC
LIMIT 1
    `)
    this.selectExactStmt = this.db.query<CheckpointRow, [string, string, string]>(`
SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
FROM checkpoints
WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
    `)
    this.selectWritesStmt = this.db.query<WriteRow, [string, string, string]>(`
SELECT task_id, idx, channel, type, value
FROM writes
WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
ORDER BY idx ASC
    `)
    this.selectParentTaskWritesStmt = this.db.query<WriteRow, [string, string, string, string]>(`
SELECT task_id, idx, channel, type, value
FROM writes
WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ? AND channel = ?
ORDER BY idx ASC
    `)
  }

  static fromPath(path: string) {
    return new BunSqliteSaver(path)
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id
    const checkpointNamespace = config.configurable?.checkpoint_ns ?? ""

    if (!threadId) return undefined

    const checkpointId = getCheckpointId(config)
    const row = checkpointId
      ? this.selectExactStmt.get(threadId, checkpointNamespace, checkpointId)
      : this.selectLatestStmt.get(threadId, checkpointNamespace)

    if (!row) return undefined

    const resolvedConfig = checkpointId
      ? config
      : {
          configurable: {
            thread_id: row.thread_id,
            checkpoint_ns: row.checkpoint_ns,
            checkpoint_id: row.checkpoint_id,
          },
        }

    const checkpoint = await this.serde.loadsTyped(row.type ?? "json", row.checkpoint)

    if (checkpoint.v < 4 && row.parent_checkpoint_id) {
      await this.migratePendingSends(checkpoint, row.thread_id, row.checkpoint_ns, row.parent_checkpoint_id)
    }

    const pendingWrites = await Promise.all(
      this.selectWritesStmt.all(row.thread_id, row.checkpoint_ns, row.checkpoint_id).map(async (write) => {
        return [
          write.task_id,
          write.channel,
          await this.serde.loadsTyped(write.type ?? "json", write.value),
        ] as [string, string, unknown]
      }),
    )

    return {
      config: resolvedConfig,
      checkpoint,
      metadata: await this.serde.loadsTyped(row.type ?? "json", row.metadata),
      parentConfig: row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns: row.checkpoint_ns,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined,
      pendingWrites,
    }
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions) {
    const clauses = ["1 = 1"]
    const values: Array<string> = []

    if (config.configurable?.thread_id) {
      clauses.push("thread_id = ?")
      values.push(config.configurable.thread_id)
    }

    if (config.configurable?.checkpoint_ns !== undefined) {
      clauses.push("checkpoint_ns = ?")
      values.push(config.configurable.checkpoint_ns)
    }

    if (config.configurable?.checkpoint_id) {
      clauses.push("checkpoint_id = ?")
      values.push(config.configurable.checkpoint_id)
    }

    if (options?.before?.configurable?.checkpoint_id) {
      clauses.push("checkpoint_id < ?")
      values.push(options.before.configurable.checkpoint_id)
    }

    const limitClause = options?.limit ? ` LIMIT ${options.limit}` : ""
    const rows = this.db
      .query<CheckpointRow, string[]>(`
SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
FROM checkpoints
WHERE ${clauses.join(" AND ")}
ORDER BY checkpoint_id DESC${limitClause}
      `)
      .all(...values)

    for (const row of rows) {
      const metadata = await this.serde.loadsTyped(row.type ?? "json", row.metadata)

      if (options?.filter && !Object.entries(options.filter).every(([key, value]) => metadata?.[key] === value)) {
        continue
      }

      const checkpoint = await this.serde.loadsTyped(row.type ?? "json", row.checkpoint)

      if (checkpoint.v < 4 && row.parent_checkpoint_id) {
        await this.migratePendingSends(checkpoint, row.thread_id, row.checkpoint_ns, row.parent_checkpoint_id)
      }

      const pendingWrites = await Promise.all(
        this.selectWritesStmt.all(row.thread_id, row.checkpoint_ns, row.checkpoint_id).map(async (write) => {
          return [
            write.task_id,
            write.channel,
            await this.serde.loadsTyped(write.type ?? "json", write.value),
          ] as [string, string, unknown]
        }),
      )

      yield {
        config: {
          configurable: {
            thread_id: row.thread_id,
            checkpoint_ns: row.checkpoint_ns,
            checkpoint_id: row.checkpoint_id,
          },
        },
        checkpoint,
        metadata,
        parentConfig: row.parent_checkpoint_id
          ? {
              configurable: {
                thread_id: row.thread_id,
                checkpoint_ns: row.checkpoint_ns,
                checkpoint_id: row.parent_checkpoint_id,
              },
            }
          : undefined,
        pendingWrites,
      }
    }
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata) {
    const threadId = config.configurable?.thread_id
    const checkpointNamespace = config.configurable?.checkpoint_ns ?? ""
    const parentCheckpointId = config.configurable?.checkpoint_id

    if (!threadId) {
      throw new Error('Failed to put checkpoint. Missing "thread_id" in config.configurable.')
    }

    const preparedCheckpoint = copyCheckpoint(checkpoint)
    const [[checkpointType, serializedCheckpoint], [metadataType, serializedMetadata]] = await Promise.all([
      this.serde.dumpsTyped(preparedCheckpoint),
      this.serde.dumpsTyped(metadata),
    ])

    if (checkpointType !== metadataType) {
      throw new Error("Failed to serialize checkpoint and metadata to the same type.")
    }

    this.db
      .prepare(
        `
INSERT OR REPLACE INTO checkpoints (
  thread_id,
  checkpoint_ns,
  checkpoint_id,
  parent_checkpoint_id,
  type,
  checkpoint,
  metadata
) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        threadId,
        checkpointNamespace,
        checkpoint.id,
        parentCheckpointId ?? null,
        checkpointType,
        serializedCheckpoint,
        serializedMetadata,
      )

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNamespace,
        checkpoint_id: checkpoint.id,
      },
    }
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string) {
    const threadId = config.configurable?.thread_id
    const checkpointNamespace = config.configurable?.checkpoint_ns ?? ""
    const checkpointId = config.configurable?.checkpoint_id

    if (!threadId) throw new Error('Failed to put writes. Missing "thread_id" in config.configurable.')
    if (!checkpointId) throw new Error('Failed to put writes. Missing "checkpoint_id" in config.configurable.')

    const insert = this.db.prepare(
      `
INSERT OR REPLACE INTO writes (
  thread_id,
  checkpoint_ns,
  checkpoint_id,
  task_id,
  idx,
  channel,
  type,
  value
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )

    const existing = new Set(
      this.selectWritesStmt
        .all(threadId, checkpointNamespace, checkpointId)
        .map((write) => `${write.task_id},${write.idx}`),
    )

    const runTransaction = this.db.transaction((rows: Array<[number, string, string, Uint8Array]>) => {
      for (const [idx, channel, type, value] of rows) {
        insert.run(threadId, checkpointNamespace, checkpointId, taskId, idx, channel, type, value)
      }
    })

    const rows = await Promise.all(
      writes.map(async ([channel, value], idx) => {
        const writeIndex = WRITES_IDX_MAP[channel] ?? idx
        const key = `${taskId},${writeIndex}`

        if (writeIndex >= 0 && existing.has(key)) return undefined

        const [type, serializedValue] = await this.serde.dumpsTyped(value)
        return [writeIndex, channel, type, serializedValue] as [number, string, string, Uint8Array]
      }),
    )

    runTransaction(rows.filter((row): row is [number, string, string, Uint8Array] => row !== undefined))
  }

  async deleteThread(threadId: string) {
    const remove = this.db.transaction((target: string) => {
      this.db.prepare("DELETE FROM writes WHERE thread_id = ?").run(target)
      this.db.prepare("DELETE FROM checkpoints WHERE thread_id = ?").run(target)
    })

    remove(threadId)
  }

  async migratePendingSends(checkpoint: Checkpoint, threadId: string, checkpointNamespace: string, parentCheckpointId: string) {
    const pendingSends = await Promise.all(
      this.selectParentTaskWritesStmt
        .all(threadId, checkpointNamespace, parentCheckpointId, TASKS)
        .map((write) => this.serde.loadsTyped(write.type ?? "json", write.value)),
    )

    checkpoint.channel_values ??= {}
    checkpoint.channel_values[TASKS] = pendingSends
    checkpoint.channel_versions ??= {}
    checkpoint.channel_versions[TASKS] =
      Object.keys(checkpoint.channel_versions).length > 0
        ? maxChannelVersion(...Object.values(checkpoint.channel_versions))
        : this.getNextVersion(undefined)
  }
}
