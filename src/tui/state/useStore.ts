import { useStore } from "zustand"
import type { RunStore, RunStoreState } from "./runStore"

export function useStoreSelector<T>(store: RunStore, selector: (s: RunStoreState) => T): T {
  return useStore(store, selector)
}
