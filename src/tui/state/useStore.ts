import { useSyncExternalStore } from "react"
import type { RunStore, RunStoreState } from "./runStore"

export function useStoreSelector<T>(store: RunStore, selector: (s: RunStoreState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  )
}
