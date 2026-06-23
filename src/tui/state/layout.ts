export type FocusRegion = string

export type LayoutMode = "wide" | "stacked"

export interface Position {
  row: number
  col: number
}

export type LayoutDescriptor = {
  mode: LayoutMode
  order: FocusRegion[]
  positions: Record<FocusRegion, Position>
}

/** Compute row/col positions for wide-mode directional navigation.
 *  Index 0 = dashboard (row 0, col 0, full-width).
 *  Index 1 = drafter (row 1, col 0).
 *  Remaining indices fill col 1 top-to-bottom. */
export function computePositions(order: FocusRegion[]): Record<FocusRegion, Position> {
  const positions: Record<FocusRegion, Position> = {}
  if (order.length === 0) return positions

  // Dashboard always first, spans full width
  positions[order[0]] = { row: 0, col: 0 }

  if (order.length >= 2) {
    positions[order[1]] = { row: 1, col: 0 }
  }

  for (let i = 2; i < order.length; i++) {
    positions[order[i]] = { row: i - 1, col: 1 }
  }

  return positions
}

export function computeLayout(width: number, slotOrder: FocusRegion[]): LayoutDescriptor {
  return {
    mode: width >= 100 ? "wide" : "stacked",
    order: slotOrder,
    positions: computePositions(slotOrder),
  }
}
