import { describe, expect, test } from "bun:test"

import {
  isOfflineCaptureUrl,
  offlineDocCacheName,
  offlineSnapshotId,
  offlineViewIdFromUrl,
  parseRawHtmlPathname,
  rawDocumentUrl,
  shouldRecordRequest,
  urlWithoutOfflineParams,
  withOfflineCapture,
  withOfflineView,
} from "../src/view/offline-protocol.ts"
import { renderOfflinePage } from "../src/view/offline-page.ts"
import { OFFLINE_SERVICE_WORKER_SOURCE, serveOfflineServiceWorker } from "../src/view/offline-sw.ts"
import { renderHtmlViewerPage } from "../src/view/html-viewer.ts"
import { renderAppNavbar } from "../src/view/app-nav.ts"
import { layout, layoutHtmlViewer } from "../src/view/layout.ts"

describe("offline protocol", () => {
  test("builds stable snapshot ids and raw document urls", () => {
    const id = offlineSnapshotId("alpha-run", "final.html")
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(offlineSnapshotId("alpha-run", "final.html")).toBe(id)
    expect(offlineSnapshotId("other", "final.html")).not.toBe(id)
    expect(rawDocumentUrl("alpha-run", "final.html")).toBe("/runs/alpha-run/raw/final.html?source=1")
    expect(offlineDocCacheName(id)).toBe(`quorum-offline-doc:${id}`)
  })

  test("parses raw html paths", () => {
    expect(parseRawHtmlPathname("/runs/alpha-run/raw/final.html")).toEqual({
      runName: "alpha-run",
      filePath: "final.html",
    })
    expect(parseRawHtmlPathname("/runs/alpha%2Drun/raw/final.html")).toEqual({
      runName: "alpha-run",
      filePath: "final.html",
    })
    expect(parseRawHtmlPathname("/library")).toBeNull()
  })

  test("marks capture and view query params", () => {
    const documentUrl = rawDocumentUrl("alpha-run", "final.html")
    const capture = withOfflineCapture(documentUrl)
    const id = offlineSnapshotId("alpha-run", "final.html")
    const view = withOfflineView(documentUrl, id)
    expect(isOfflineCaptureUrl(capture)).toBe(true)
    expect(capture).toContain("source=1")
    expect(capture).toContain("offline-capture=1")
    expect(offlineViewIdFromUrl(view)).toBe(id)
    expect(urlWithoutOfflineParams(capture)).toBe(documentUrl)
    expect(urlWithoutOfflineParams(view)).toBe(documentUrl)
  })

  test("records only http GET resources", () => {
    expect(shouldRecordRequest("GET", "https://cdn.example/app.js")).toBe(true)
    expect(shouldRecordRequest("POST", "https://cdn.example/app.js")).toBe(false)
    expect(shouldRecordRequest("GET", "/sw.js")).toBe(false)
    expect(shouldRecordRequest("GET", "data:text/plain,hi")).toBe(false)
  })
})

describe("offline pages", () => {
  test("serves a javascript service worker for the site root", () => {
    const response = serveOfflineServiceWorker()
    expect(response.headers.get("content-type")).toContain("application/javascript")
    expect(response.headers.get("Service-Worker-Allowed")).toBe("/")
  })

  test("worker records capture loads and serves cache-only snapshots", () => {
    expect(OFFLINE_SERVICE_WORKER_SOURCE).toContain("offline-capture")
    expect(OFFLINE_SERVICE_WORKER_SOURCE).toContain("offline-saved")
    expect(OFFLINE_SERVICE_WORKER_SOURCE).toContain("resultingClientId")
    expect(OFFLINE_SERVICE_WORKER_SOURCE).toContain("snapshot miss")
    expect(OFFLINE_SERVICE_WORKER_SOURCE).toContain("method !== \"GET\"")
  })

  test("offline list is a client-rendered shell", async () => {
    const html = await renderOfflinePage().text()
    expect(html).toContain("Nothing saved yet")
    expect(html).toContain("id=\"offline-snapshot-list\"")
    expect(html).toContain("offline-list")
    expect(html).toContain('href="/offline"')
    expect(html).toContain("app-navbar-pill-active")
  })

  test("html viewer exposes save for offline", () => {
    const html = renderHtmlViewerPage("alpha-run", "final.html", "", [])
    expect(html).toContain("data-offline-save")
    expect(html).toContain("Save for offline")
    expect(html).toContain("offline-capture=1")
    expect(html).toContain("data-capture-url")
  })

  test("layouts register the service worker", () => {
    expect(layout("t", "b")).toContain('navigator.serviceWorker.register("/sw.js"')
    expect(layoutHtmlViewer("t", "b")).toContain('navigator.serviceWorker.register("/sw.js"')
  })

  test("site nav includes Offline", () => {
    const html = renderAppNavbar({ section: "offline" })
    expect(html).toContain('href="/offline"')
    expect(html).toContain("Offline")
  })
})
