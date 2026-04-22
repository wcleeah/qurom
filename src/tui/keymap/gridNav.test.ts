import { describe, expect, test } from "bun:test"
import { nextFocus } from "./gridNav"
import { computeLayout, type FocusRegion } from "../state/layout"

const ORDER: FocusRegion[] = ["dashboard", "research-drafter", "source-auditor", "logic-auditor", "clarity-auditor"]

describe("nextFocus", () => {
  test("uses reading order for tab cycling", () => {
    const layout = computeLayout(140, ORDER)
    expect(nextFocus("dashboard", "tab", layout)).toBe("research-drafter")
    expect(nextFocus("clarity-auditor", "tab", layout)).toBe("dashboard")
    expect(nextFocus("dashboard", "shift-tab", layout)).toBe("clarity-auditor")
  })

  test("navigates the wide split layout with vim keys", () => {
    const layout = computeLayout(140, ORDER)
    expect(nextFocus("dashboard", "j", layout)).toBe("research-drafter")
    expect(nextFocus("research-drafter", "l", layout)).toBe("source-auditor")
    expect(nextFocus("source-auditor", "j", layout)).toBe("logic-auditor")
    expect(nextFocus("clarity-auditor", "h", layout)).toBe("research-drafter")
    expect(nextFocus("source-auditor", "k", layout)).toBe("dashboard")
  })

  test("collapses to vertical navigation when stacked", () => {
    const layout = computeLayout(90, ORDER)
    expect(nextFocus("dashboard", "j", layout)).toBe("research-drafter")
    expect(nextFocus("research-drafter", "k", layout)).toBe("dashboard")
    expect(nextFocus("source-auditor", "h", layout)).toBeUndefined()
    expect(nextFocus("source-auditor", "l", layout)).toBeUndefined()
  })
})
