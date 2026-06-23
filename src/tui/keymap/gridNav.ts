import type { FocusRegion, LayoutDescriptor } from "../state/layout"

export type NavDirection = "h" | "j" | "k" | "l" | "tab" | "shift-tab"

const nextInOrder = (current: FocusRegion, layout: LayoutDescriptor, step: 1 | -1): FocusRegion => {
  const index = layout.order.indexOf(current)
  if (index === -1) return layout.order[0]
  return layout.order[(index + step + layout.order.length) % layout.order.length]
}

/** Find the region at a specific position in wide mode. */
function regionAt(layout: LayoutDescriptor, row: number, col: number): FocusRegion | undefined {
  for (const [region, pos] of Object.entries(layout.positions)) {
    if (pos.row === row && pos.col === col) return region
  }
  return undefined
}

/** Walk upward from (row, col), then try col 0 at same row as fallback. */
function regionAbove(layout: LayoutDescriptor, row: number, col: number): FocusRegion | undefined {
  for (let r = row - 1; r >= 0; r--) {
    const found = regionAt(layout, r, col)
    if (found) return found
  }
  // Fallback: try col 0 at the starting row (e.g. source-auditor k → dashboard)
  if (col !== 0) return regionAt(layout, row - 1, 0)
  return undefined
}

/** Walk downward from (row, col). */
function regionBelow(layout: LayoutDescriptor, row: number, col: number): FocusRegion | undefined {
  // Scan up to a reasonable max to avoid infinite loop
  for (let r = row + 1; r < 10; r++) {
    const found = regionAt(layout, r, col)
    if (found) return found
  }
  return undefined
}

export function nextFocus(current: FocusRegion, dir: NavDirection, layout: LayoutDescriptor): FocusRegion | undefined {
  if (layout.mode === "stacked") {
    if (dir === "tab") return nextInOrder(current, layout, 1)
    if (dir === "shift-tab") return nextInOrder(current, layout, -1)
    if (dir === "j") return nextInOrder(current, layout, 1)
    if (dir === "k") return nextInOrder(current, layout, -1)
    return undefined
  }

  // Wide mode
  if (dir === "tab") return nextInOrder(current, layout, 1)
  if (dir === "shift-tab") return nextInOrder(current, layout, -1)

  const position = layout.positions[current]
  if (!position) return undefined

  if (dir === "j") return regionBelow(layout, position.row, position.col)
  if (dir === "k") return regionAbove(layout, position.row, position.col)

  if (dir === "l") {
    // From left column, go to region in right column at same row
    if (position.col === 0) return regionAt(layout, position.row, 1)
    return undefined
  }

  if (dir === "h") {
    // From right column, go to left-column region at same row, or walk upward
    if (position.col === 1) {
      for (let r = position.row; r >= 0; r--) {
        const found = regionAt(layout, r, 0)
        if (found) return found
      }
    }
    return undefined
  }

  return undefined
}
