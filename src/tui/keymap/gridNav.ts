import type { FocusRegion, LayoutDescriptor } from "../state/layout"

export type NavDirection = "h" | "j" | "k" | "l" | "tab" | "shift-tab"

const WIDE_POSITIONS: Record<FocusRegion, { row: number; col: number }> = {
  dashboard: { row: 0, col: 0 },
  "research-drafter": { row: 1, col: 0 },
  "source-auditor": { row: 1, col: 1 },
  "logic-auditor": { row: 2, col: 1 },
  "clarity-auditor": { row: 3, col: 1 },
}

const nextInOrder = (current: FocusRegion, layout: LayoutDescriptor, step: 1 | -1): FocusRegion => {
  const index = layout.order.indexOf(current)
  if (index === -1) return layout.order[0]
  return layout.order[(index + step + layout.order.length) % layout.order.length]
}

export function nextFocus(current: FocusRegion, dir: NavDirection, layout: LayoutDescriptor): FocusRegion | undefined {
  if (layout.mode === "stacked") {
    if (dir === "tab") return nextInOrder(current, layout, 1)
    if (dir === "shift-tab") return nextInOrder(current, layout, -1)
    if (dir === "j") return nextInOrder(current, layout, 1)
    if (dir === "k") return nextInOrder(current, layout, -1)
    return undefined
  }

  if (dir === "tab") return nextInOrder(current, layout, 1)
  if (dir === "shift-tab") return nextInOrder(current, layout, -1)

  const position = WIDE_POSITIONS[current]
  if (!position) return undefined

  if (dir === "j") {
    if (current === "dashboard") return "research-drafter"
    if (current === "source-auditor") return "logic-auditor"
    if (current === "logic-auditor") return "clarity-auditor"
    return undefined
  }

  if (dir === "k") {
    if (current === "research-drafter") return "dashboard"
    if (current === "source-auditor") return "dashboard"
    if (current === "logic-auditor") return "source-auditor"
    if (current === "clarity-auditor") return "logic-auditor"
    return undefined
  }

  if (dir === "l") {
    if (current === "research-drafter") return "source-auditor"
    return undefined
  }

  if (dir === "h") {
    if (position.col === 1) return "research-drafter"
    return undefined
  }

  return undefined
}
