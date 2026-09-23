import { describe, expect, test } from "bun:test"

import {
  IFRAME_EXTERNAL_LINKS_SCRIPT,
  shouldOpenIframeHrefExternally,
} from "../src/view/iframe-external-links.ts"
import { layout, layoutHtmlViewer } from "../src/view/layout.ts"
import { renderHtmlViewerPage } from "../src/view/html-viewer.ts"

const CURRENT = "http://localhost:3000/runs/alpha-run/raw/final.html?source=1"

describe("shouldOpenIframeHrefExternally", () => {
  test("keeps same-document hash jumps in the iframe", () => {
    expect(shouldOpenIframeHrefExternally("#sources", CURRENT)).toBe(false)
    expect(shouldOpenIframeHrefExternally("#", CURRENT)).toBe(false)
    expect(shouldOpenIframeHrefExternally("", CURRENT)).toBe(false)
    expect(shouldOpenIframeHrefExternally("?source=1#sources", CURRENT)).toBe(false)
    expect(shouldOpenIframeHrefExternally(
      "http://localhost:3000/runs/alpha-run/raw/final.html?source=1#sources",
      CURRENT,
    )).toBe(false)
  })

  test("opens http(s) and in-app navigations in a new tab", () => {
    expect(shouldOpenIframeHrefExternally("https://en.wikipedia.org/wiki/Quorum", CURRENT)).toBe(true)
    expect(shouldOpenIframeHrefExternally("http://example.com", CURRENT)).toBe(true)
    expect(shouldOpenIframeHrefExternally("/runs/alpha-run/raw/final.html", CURRENT)).toBe(true)
    expect(shouldOpenIframeHrefExternally("other.html", CURRENT)).toBe(true)
  })

  test("leaves mailto, tel, and javascript links alone", () => {
    expect(shouldOpenIframeHrefExternally("mailto:reader@example.com", CURRENT)).toBe(false)
    expect(shouldOpenIframeHrefExternally("tel:+15555550100", CURRENT)).toBe(false)
    expect(shouldOpenIframeHrefExternally("javascript:void(0)", CURRENT)).toBe(false)
  })
})

describe("iframe external links script", () => {
  test("is inlined in the html viewer and app layouts", () => {
    const viewer = renderHtmlViewerPage("alpha-run", "final.html", "", [])
    const app = layout("Runs", "<p>hi</p>")
    const viewerLayout = layoutHtmlViewer("doc", "<p>hi</p>")

    for (const html of [viewer, app, viewerLayout]) {
      expect(html).toContain(IFRAME_EXTERNAL_LINKS_SCRIPT)
      expect(html).toContain(".html-viewer-frame, .design-preview-frame")
      expect(html).toContain('anchor.setAttribute("target", "_blank")')
      expect(html).toContain("elementFromEventTarget")
    }
  })
})
