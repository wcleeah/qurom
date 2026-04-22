import type { RuntimeConfig } from "../../config"
import type { EventBus, RunnerEvent } from "../../runner"
import { reduce, type RunStore } from "./runStore"

export type BindBusToStoreInput = {
  bus: EventBus
  store: RunStore
  config: RuntimeConfig
  flushIntervalMs?: number
}

const DEFAULT_FLUSH_MS = 50

export function bindBusToStore(input: BindBusToStoreInput): () => void {
  const { bus, store, config } = input
  const flushMs = input.flushIntervalMs ?? DEFAULT_FLUSH_MS

  let pending: RunnerEvent[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  function flush() {
    timer = undefined
    if (pending.length === 0) return
    const batch = pending
    pending = []
    let next = store.get()
    for (const event of batch) {
      next = reduce(next, event, config)
    }
    store.set(next)
  }

  const off = bus.on((event) => {
    pending.push(event)
    if (timer === undefined) {
      timer = setTimeout(flush, flushMs)
    }
  })

  return () => {
    off()
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    pending = []
  }
}
