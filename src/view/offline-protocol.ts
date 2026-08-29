export const OFFLINE_SW_PATH = "/sw.js"
export const OFFLINE_LIST_PATH = "/offline"
export const OFFLINE_CAPTURE_PARAM = "offline-capture"
export const OFFLINE_VIEW_PARAM = "offline"
export const OFFLINE_SHELL_CACHE = "quorum-offline-shell-v1"
export const OFFLINE_DOC_CACHE_PREFIX = "quorum-offline-doc:"
export const OFFLINE_CAPTURE_MAX_MS = 15_000
export const OFFLINE_CAPTURE_SETTLE_MS = 1_000

export type OfflineSnapshot = {
  id: string
  runName: string
  filePath: string
  title: string
  documentUrl: string
  savedAt: string
  resourceCount: number
}

export function offlineDocCacheName(snapshotId: string): string {
  return `${OFFLINE_DOC_CACHE_PREFIX}${snapshotId}`
}

export function offlineSnapshotId(runName: string, filePath: string): string {
  return toBase64Url(`${runName}\n${filePath}`)
}

export function parseRawHtmlPathname(pathname: string): { runName: string; filePath: string } | null {
  const match = pathname.match(/^\/runs\/([^/]+)\/raw\/(.+)$/)
  if (!match) return null
  try {
    return {
      runName: decodeURIComponent(match[1]!),
      filePath: decodeURIComponent(match[2]!),
    }
  } catch {
    return null
  }
}

export function rawDocumentUrl(runName: string, filePath: string): string {
  return `/runs/${encodeURIComponent(runName)}/raw/${encodeURIComponent(filePath)}?source=1`
}

export function withSearchParam(url: string, name: string, value: string): string {
  const parsed = new URL(url, "http://offline.local")
  parsed.searchParams.set(name, value)
  return `${parsed.pathname}${parsed.search}`
}

export function withOfflineCapture(documentUrl: string): string {
  return withSearchParam(urlWithoutOfflineParams(documentUrl), OFFLINE_CAPTURE_PARAM, "1")
}

export function withOfflineView(documentUrl: string, snapshotId: string): string {
  return withSearchParam(urlWithoutOfflineParams(documentUrl), OFFLINE_VIEW_PARAM, snapshotId)
}

export function urlWithoutOfflineParams(url: string): string {
  const parsed = new URL(url, "http://offline.local")
  parsed.searchParams.delete(OFFLINE_CAPTURE_PARAM)
  parsed.searchParams.delete(OFFLINE_VIEW_PARAM)
  return `${parsed.pathname}${parsed.search}`
}

export function isOfflineCaptureUrl(url: string): boolean {
  return new URL(url, "http://offline.local").searchParams.get(OFFLINE_CAPTURE_PARAM) === "1"
}

export function offlineViewIdFromUrl(url: string): string | null {
  const value = new URL(url, "http://offline.local").searchParams.get(OFFLINE_VIEW_PARAM)
  return value && value.length > 0 ? value : null
}

export function shouldRecordRequest(method: string, url: string): boolean {
  if (method !== "GET") return false
  let parsed: URL
  try {
    parsed = new URL(url, "http://offline.local")
  } catch {
    return false
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
  if (parsed.pathname === OFFLINE_SW_PATH) return false
  return true
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const base64 = typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(bytes).toString("base64")
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}
