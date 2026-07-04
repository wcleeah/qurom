import { describe, expect, test } from "bun:test"

import { LIVE_REFRESH_STORAGE_KEY, renderRefreshControls } from "../src/view/refresh-controls.ts"

describe("refresh controls", () => {
  test("renders live refresh toggle and manual refresh button", () => {
    const html = renderRefreshControls()
    expect(html).toContain('id="refresh-controls"')
    expect(html).toContain("data-refresh-toggle")
    expect(html).toContain("data-refresh-now")
    expect(html).toContain("Live refresh")
  })

  test("uses a stable localStorage key", () => {
    expect(LIVE_REFRESH_STORAGE_KEY).toBe("qurom-view-live-refresh")
  })
})
