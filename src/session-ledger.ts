import { mkdir, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"

export const SESSION_LEDGER_FILENAME = "session-ledger.json"

export type SessionLedgerStatus = "created" | "waiting" | "finished" | "error" | "harvested"

export type SessionLedgerEntry = {
  role: string
  node: string
  round: number
  requestId?: string
  provider?: string
  handleId: string
  expectedArtifact?: string
  cursorRunId?: string
  status: SessionLedgerStatus
  createdAt: string
  updatedAt: string
}

export type SessionLedgerFile = {
  version: 1
  sessions: SessionLedgerEntry[]
}

export type SessionLedgerKey = {
  role: string
  node: string
  round: number
}

export type SessionLedgerPatch = SessionLedgerKey & {
  requestId?: string
  provider?: string
  handleId?: string
  expectedArtifact?: string
  cursorRunId?: string
  status?: SessionLedgerStatus
}

const writeChains = new Map<string, Promise<unknown>>()

export function sessionLedgerKey(input: SessionLedgerKey): string {
  return `${input.role}:${input.node}:${input.round}`
}

export function emptySessionLedger(): SessionLedgerFile {
  return { version: 1, sessions: [] }
}

export function findLedgerEntry(
  file: SessionLedgerFile,
  key: SessionLedgerKey,
): SessionLedgerEntry | undefined {
  const id = sessionLedgerKey(key)
  return file.sessions.find((entry) => sessionLedgerKey(entry) === id)
}

export async function readSessionLedger(runDir: string): Promise<SessionLedgerFile> {
  try {
    const raw = await Bun.file(join(runDir, SESSION_LEDGER_FILENAME)).json()
    if (raw && raw.version === 1 && Array.isArray(raw.sessions)) {
      return raw as SessionLedgerFile
    }
  } catch {
    // missing or invalid
  }
  return emptySessionLedger()
}

export function isHarvestableLedgerStatus(status: SessionLedgerStatus): boolean {
  return status === "created" || status === "waiting" || status === "finished" || status === "harvested"
}

function applyPatch(file: SessionLedgerFile, patch: SessionLedgerPatch, now: string): SessionLedgerEntry {
  const existing = findLedgerEntry(file, patch)
  if (existing) {
    if (patch.requestId) existing.requestId = patch.requestId
    if (patch.provider) existing.provider = patch.provider
    if (patch.handleId) existing.handleId = patch.handleId
    if (patch.expectedArtifact) existing.expectedArtifact = patch.expectedArtifact
    if (patch.cursorRunId) existing.cursorRunId = patch.cursorRunId
    if (patch.status) existing.status = patch.status
    existing.updatedAt = now
    return existing
  }

  if (!patch.handleId) {
    throw new Error(`session ledger create requires handleId for ${sessionLedgerKey(patch)}`)
  }

  const created: SessionLedgerEntry = {
    role: patch.role,
    node: patch.node,
    round: patch.round,
    requestId: patch.requestId,
    provider: patch.provider,
    handleId: patch.handleId,
    expectedArtifact: patch.expectedArtifact,
    cursorRunId: patch.cursorRunId,
    status: patch.status ?? "created",
    createdAt: now,
    updatedAt: now,
  }
  file.sessions.push(created)
  return created
}

async function writeLedgerAtomic(runDir: string, file: SessionLedgerFile): Promise<void> {
  await mkdir(runDir, { recursive: true })
  const dest = join(runDir, SESSION_LEDGER_FILENAME)
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8")
  await rename(tmp, dest)
}

function withLedgerLock<T>(runDir: string, fn: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(runDir) ?? Promise.resolve()
  const next = previous.then(fn, fn)
  writeChains.set(runDir, next.then(() => undefined, () => undefined))
  return next
}

export async function upsertSessionLedgerEntry(
  runDir: string,
  patch: SessionLedgerPatch,
): Promise<SessionLedgerEntry> {
  return withLedgerLock(runDir, async () => {
    const file = await readSessionLedger(runDir)
    const entry = applyPatch(file, patch, new Date().toISOString())
    await writeLedgerAtomic(runDir, file)
    return entry
  })
}

export async function findSessionLedgerEntry(
  runDir: string,
  key: SessionLedgerKey,
): Promise<SessionLedgerEntry | undefined> {
  const file = await readSessionLedger(runDir)
  return findLedgerEntry(file, key)
}
