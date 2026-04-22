import { useStore } from "zustand"
import { useShallow } from "zustand/react/shallow"
import type { RunStore, RunStoreState } from "./runStore"

export function useStoreSelector<T>(store: RunStore, selector: (s: RunStoreState) => T): T {
  return useStore(store, useShallow(selector))
}
