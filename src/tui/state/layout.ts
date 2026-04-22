export type FocusRegion = "dashboard" | "research-drafter" | "source-auditor" | "logic-auditor" | "clarity-auditor"

export type LayoutMode = "wide" | "stacked"

export type LayoutDescriptor = {
  mode: LayoutMode
  order: FocusRegion[]
}

export function computeLayout(width: number, slotOrder: FocusRegion[]): LayoutDescriptor {
  return {
    mode: width >= 100 ? "wide" : "stacked",
    order: slotOrder,
  }
}
