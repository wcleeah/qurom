import { appendFile } from "node:fs/promises"
import { join } from "node:path"

export interface DebugLog {
  write(type: string, data?: Record<string, unknown>): void
  close(): Promise<void>
}

const encoder = new TextEncoder()

export function createDebugLog(runDir: string): DebugLog {
  const path = join(runDir, "debug-log.jsonl")
  const queue: Uint8Array[] = []
  let writing = false
  let closed = false
  let writer: Promise<void> = Promise.resolve()

  async function flush() {
    if (queue.length === 0) return
    const batch = queue.splice(0, queue.length)
    try {
      const combined = new Uint8Array(batch.reduce((sum, b) => sum + b.length, 0))
      let offset = 0
      for (const b of batch) {
        combined.set(b, offset)
        offset += b.length
      }
      await appendFile(path, combined)
    } catch {
      // Silently drop — never crash the pipeline
    }
  }

  function drain() {
    if (writing || closed) return
    writing = true
    writer = writer.then(() => {
      writing = false
      return flush()
    })
  }

  return {
    write(type: string, data?: Record<string, unknown>) {
      if (closed) return
      const entry: Record<string, unknown> = {
        ts: new Date().toISOString(),
        type,
      }
      if (data) {
        // Inline common fields: omit undefined, truncate long strings
        for (const [k, v] of Object.entries(data)) {
          if (v === undefined) continue
          if (typeof v === "string" && v.length > 4000) {
            entry[k] = v.slice(0, 4000) + `… (${v.length} total chars)`
          } else {
            entry[k] = v
          }
        }
      }
      try {
        const line = JSON.stringify(entry) + "\n"
        queue.push(encoder.encode(line))
      } catch {
        // Circular or unserializable value — stringify safely
        try {
          const safe = JSON.stringify({ ts: entry.ts, type, _error: "unserializable" }) + "\n"
          queue.push(encoder.encode(safe))
        } catch {
          // Give up
        }
      }
      drain()
    },

    async close() {
      closed = true
      await writer // wait for pending writes
      await flush()
    },
  }
}
