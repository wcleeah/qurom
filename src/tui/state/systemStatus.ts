import { useStore } from "zustand"
import { createStore, type StoreApi } from "zustand/vanilla"

export type SystemStatusEntry = {
  level: "warn" | "error"
  text: string
  ts: number
}

type SystemStatusState = {
  entries: SystemStatusEntry[]
}

export type SystemStatusStore = StoreApi<SystemStatusState>

const LIMIT = 50

export function createSystemStatusStore(): SystemStatusStore {
  return createStore<SystemStatusState>(() => ({ entries: [] }))
}

export function pushSystemStatus(store: SystemStatusStore, entry: Omit<SystemStatusEntry, "ts">) {
  store.setState((state) => {
    const next = [...state.entries, { ...entry, ts: Date.now() }]
    return {
      entries: next.length > LIMIT ? next.slice(next.length - LIMIT) : next,
    }
  })
}

export function useSystemStatusSelector<T>(store: SystemStatusStore, selector: (state: SystemStatusState) => T): T {
  return useStore(store, selector)
}
