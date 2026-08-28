import {
  OFFLINE_CAPTURE_MAX_MS,
  OFFLINE_CAPTURE_PARAM,
  OFFLINE_DOC_CACHE_PREFIX,
  OFFLINE_LIST_PATH,
  OFFLINE_SHELL_CACHE,
  OFFLINE_SW_PATH,
  OFFLINE_VIEW_PARAM,
} from "./offline-protocol"

/** Browser service worker source. Keep in sync with offline-protocol.ts. */
export const OFFLINE_SERVICE_WORKER_SOURCE = /* js */ `'use strict';

const SHELL_CACHE = ${JSON.stringify(OFFLINE_SHELL_CACHE)};
const DOC_PREFIX = ${JSON.stringify(OFFLINE_DOC_CACHE_PREFIX)};
const LIST_PATH = ${JSON.stringify(OFFLINE_LIST_PATH)};
const SW_PATH = ${JSON.stringify(OFFLINE_SW_PATH)};
const CAPTURE_PARAM = ${JSON.stringify(OFFLINE_CAPTURE_PARAM)};
const VIEW_PARAM = ${JSON.stringify(OFFLINE_VIEW_PARAM)};
const CAPTURE_MAX_MS = ${OFFLINE_CAPTURE_MAX_MS};

const recordings = new Map();

function cacheNameFor(id) {
  return DOC_PREFIX + id;
}

function snapshotId(runName, filePath) {
  const bytes = new TextEncoder().encode(runName + "\\n" + filePath);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
}

function parseRawPath(pathname) {
  const match = pathname.match(/^\\/runs\\/([^/]+)\\/raw\\/(.+)$/);
  if (!match) return null;
  try {
    return { runName: decodeURIComponent(match[1]), filePath: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

function stripOfflineParams(href) {
  const url = new URL(href);
  url.searchParams.delete(CAPTURE_PARAM);
  url.searchParams.delete(VIEW_PARAM);
  return url;
}

function cacheKeyFor(request) {
  return stripOfflineParams(request.url).toString();
}

function shouldRecord(request) {
  if (request.method !== "GET") return false;
  let url;
  try { url = new URL(request.url); } catch { return false; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.pathname === SW_PATH) return false;
  return true;
}

function isSuccess(response) {
  return response.ok || response.type === "opaque" || response.type === "opaqueredirect";
}

function openDb() {
  return new Promise(function (resolve, reject) {
    const req = indexedDB.open("quorum-offline", 1);
    req.onupgradeneeded = function () {
      const db = req.result;
      if (!db.objectStoreNames.contains("snapshots")) {
        db.createObjectStore("snapshots", { keyPath: "id" });
      }
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

async function putSnapshot(snapshot) {
  const db = await openDb();
  await new Promise(function (resolve, reject) {
    const tx = db.transaction("snapshots", "readwrite");
    tx.objectStore("snapshots").put(snapshot);
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function () { reject(tx.error); };
  });
  db.close();
}

async function listSnapshots() {
  const db = await openDb();
  const rows = await new Promise(function (resolve, reject) {
    const tx = db.transaction("snapshots", "readonly");
    const req = tx.objectStore("snapshots").getAll();
    req.onsuccess = function () { resolve(req.result || []); };
    req.onerror = function () { reject(req.error); };
  });
  db.close();
  rows.sort(function (a, b) { return String(b.savedAt).localeCompare(String(a.savedAt)); });
  return rows;
}

async function getSnapshot(id) {
  const db = await openDb();
  const row = await new Promise(function (resolve, reject) {
    const tx = db.transaction("snapshots", "readonly");
    const req = tx.objectStore("snapshots").get(id);
    req.onsuccess = function () { resolve(req.result || null); };
    req.onerror = function () { reject(req.error); };
  });
  db.close();
  return row;
}

async function deleteSnapshot(id) {
  const db = await openDb();
  await new Promise(function (resolve, reject) {
    const tx = db.transaction("snapshots", "readwrite");
    tx.objectStore("snapshots").delete(id);
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function () { reject(tx.error); };
  });
  db.close();
  await caches.delete(cacheNameFor(id));
}

async function broadcast(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

function sessionForSnapshot(id) {
  for (const session of recordings.values()) {
    if (session.id === id) return session;
  }
  return null;
}

async function startRecording(clientId, parsed, documentUrl) {
  const id = snapshotId(parsed.runName, parsed.filePath);
  const existing = sessionForSnapshot(id);
  if (existing) await finishRecording(existing, { reason: "replaced" });
  await caches.delete(cacheNameFor(id));
  const session = {
    id: id,
    clientId: clientId,
    runName: parsed.runName,
    filePath: parsed.filePath,
    documentUrl: documentUrl,
    title: parsed.filePath,
    urls: new Set(),
    inFlight: 0,
    done: false,
    maxTimer: setTimeout(function () { void finishRecording(session, { reason: "timeout" }); }, CAPTURE_MAX_MS),
  };
  recordings.set(clientId, session);
}

async function finishRecording(session, info) {
  if (!session || session.done) return;
  session.done = true;
  clearTimeout(session.maxTimer);
  recordings.delete(session.clientId);
  const snapshot = {
    id: session.id,
    runName: session.runName,
    filePath: session.filePath,
    title: session.title || session.filePath,
    documentUrl: session.documentUrl,
    savedAt: new Date().toISOString(),
    resourceCount: session.urls.size,
  };
  await putSnapshot(snapshot);
  await broadcast({ type: "offline-saved", snapshot: snapshot, reason: info && info.reason ? info.reason : "stop" });
}

async function recordFetch(session, request) {
  if (session.done || !shouldRecord(request)) {
    return fetch(request);
  }
  session.inFlight += 1;
  try {
    const response = await fetch(request);
    if (isSuccess(response) && !session.done) {
      const cache = await caches.open(cacheNameFor(session.id));
      await cache.put(cacheKeyFor(request), response.clone());
      session.urls.add(stripOfflineParams(request.url).toString());
    }
    return response;
  } finally {
    session.inFlight -= 1;
  }
}

async function snapshotResponse(snapshotIdValue, request) {
  const cache = await caches.open(cacheNameFor(snapshotIdValue));
  const match = await cache.match(cacheKeyFor(request));
  if (match) return match;
  if (request.mode === "navigate") {
    return new Response(
      "<!DOCTYPE html><html><body><p>This saved copy is missing from this browser.</p><p><a href=\\"/offline\\">Back to Offline</a></p></body></html>",
      { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  return new Response("", { status: 504, statusText: "offline snapshot miss" });
}

async function handleFetch(event) {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET") return fetch(request);
  if (url.pathname === SW_PATH) return fetch(request);

  const isNav = request.mode === "navigate";
  const capture = url.searchParams.get(CAPTURE_PARAM) === "1";
  const viewId = url.searchParams.get(VIEW_PARAM);
  const parsed = parseRawPath(url.pathname);

  if (isNav && capture && event.resultingClientId && parsed) {
    const documentUrl = stripOfflineParams(url.toString());
    documentUrl.searchParams.set("source", "1");
    await startRecording(event.resultingClientId, parsed, documentUrl.pathname + documentUrl.search);
  }

  if (viewId) {
    return snapshotResponse(viewId, request);
  }

  if (event.clientId) {
    const client = await self.clients.get(event.clientId);
    if (client) {
      const clientViewId = new URL(client.url).searchParams.get(VIEW_PARAM);
      if (clientViewId) return snapshotResponse(clientViewId, request);
    }
    const session = recordings.get(event.clientId);
    if (session) return recordFetch(session, request);
  }

  if (isNav && capture && event.resultingClientId) {
    const session = recordings.get(event.resultingClientId);
    if (session) return recordFetch(session, request);
  }

  try {
    const response = await fetch(request);
    if (isNav && url.pathname === LIST_PATH && response.ok) {
      const shell = await caches.open(SHELL_CACHE);
      await shell.put(LIST_PATH, response.clone());
    }
    return response;
  } catch (error) {
    if (isNav) {
      const fallback = await caches.open(SHELL_CACHE).then(function (cache) { return cache.match(LIST_PATH); });
      if (fallback) return fallback;
    }
    throw error;
  }
}

self.addEventListener("install", function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(SHELL_CACHE);
    try {
      await cache.add(LIST_PATH);
    } catch {
      /* list page will be cached on first online visit */
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function (event) {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  event.respondWith(handleFetch(event));
});

self.addEventListener("message", function (event) {
  const data = event.data || {};
  const port = event.ports && event.ports[0];
  const reply = function (payload) {
    if (port) port.postMessage(payload);
  };

  if (data.type === "offline-list") {
    event.waitUntil(listSnapshots().then(function (snapshots) { reply({ snapshots: snapshots }); }));
    return;
  }
  if (data.type === "offline-delete") {
    event.waitUntil(deleteSnapshot(String(data.id || "")).then(function () { reply({ ok: true }); }));
    return;
  }
  if (data.type === "offline-title") {
    const session = sessionForSnapshot(String(data.id || ""));
    if (session && typeof data.title === "string" && data.title.trim()) session.title = data.title.trim();
    return;
  }
  if (data.type === "offline-stop") {
    const session = sessionForSnapshot(String(data.id || ""));
    if (!session) {
      reply({ ok: false });
      return;
    }
    event.waitUntil(finishRecording(session, { reason: "stop" }).then(function () { reply({ ok: true }); }));
  }
});
`

export function serveOfflineServiceWorker(): Response {
  return new Response(OFFLINE_SERVICE_WORKER_SOURCE, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
      "Cache-Control": "no-cache",
    },
  })
}

export const OFFLINE_SW_REGISTER_SCRIPT = /* html */ `
<script>
(function () {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register(${JSON.stringify(OFFLINE_SW_PATH)}, { scope: "/" }).catch(function () {});
})();
</script>`
