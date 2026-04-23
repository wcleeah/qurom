import type { RuntimeConfig } from "../../config"
import type { EventBus, RunnerEvent } from "../../runner"
import { reduce, type RunStore } from "./runStore"

export type BindBusToStoreInput = {
  bus: EventBus
  store: RunStore
  config: RuntimeConfig
  flushIntervalMs?: number
}

export type BoundBusStore = {
  unbind: () => void
  flush: () => void
  flushAndUnbind: () => void
}

const DEFAULT_FLUSH_MS = 50

export function bindBusToStore(input: BindBusToStoreInput): BoundBusStore {
  const { bus, store, config } = input
  const flushMs = input.flushIntervalMs ?? DEFAULT_FLUSH_MS

  let pending: RunnerEvent[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let flushing = false

  function flush() {
    timer = undefined
    if (flushing) {
      // Re-entrant call: defer to next tick so we never recurse via subscriber side effects.
      timer = setTimeout(flush, flushMs)
      return
    }
    if (pending.length === 0) return
    const batch = pending
    pending = []
    flushing = true
    try {
      store.setState((current) => {
        let next = current
        for (const event of batch) {
          next = reduce(next, event, config)
        }
        return next
      })
    } finally {
      flushing = false
    }
  }

  const off = bus.on((event) => {
    pending.push(event)
    if (timer === undefined) {
      timer = setTimeout(flush, flushMs)
    }
  })

  function unbind() {
    off()
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    pending = []
  }

  function flushAndUnbind() {
    flush()
    unbind()
  }

  return {
    unbind,
    flush,
    flushAndUnbind,
  }
}
