import type { RuntimeConfig } from "../config"
import { getProvider, providerForRole } from "./registry"
import type { AgentProviderId, AgentRole } from "./types"

const IDLE_TEARDOWN_MS = 60_000

type ProviderSlot = {
  refCount: number
  cleanup?: () => Promise<void>
  idleTimer?: ReturnType<typeof setTimeout>
}

export type ProviderLifecycleStatus = "idle" | "starting" | "running"

export type ProviderLifecycle = {
  acquire: (config: RuntimeConfig, providerId: AgentProviderId) => Promise<() => Promise<void>>
  acquireForRoles: (config: RuntimeConfig, roles: AgentRole[]) => Promise<() => Promise<void>>
  status: (providerId: AgentProviderId) => ProviderLifecycleStatus
  shutdown: () => Promise<void>
}

export function createProviderLifecycle(): ProviderLifecycle {
  const slots = new Map<AgentProviderId, ProviderSlot>()
  const starting = new Set<AgentProviderId>()

  function slotFor(providerId: AgentProviderId): ProviderSlot {
    let slot = slots.get(providerId)
    if (!slot) {
      slot = { refCount: 0 }
      slots.set(providerId, slot)
    }
    return slot
  }

  function clearIdleTimer(slot: ProviderSlot) {
    if (slot.idleTimer !== undefined) {
      clearTimeout(slot.idleTimer)
      slot.idleTimer = undefined
    }
  }

  async function teardownProvider(providerId: AgentProviderId) {
    const slot = slots.get(providerId)
    if (!slot || slot.refCount > 0) return
    clearIdleTimer(slot)
    const cleanup = slot.cleanup
    slot.cleanup = undefined
    if (cleanup) await cleanup().catch(() => {})
    if (slot.refCount === 0 && !slot.cleanup) {
      slots.delete(providerId)
    }
  }

  function scheduleIdleTeardown(providerId: AgentProviderId) {
    const slot = slotFor(providerId)
    if (slot.refCount > 0 || !slot.cleanup) return
    clearIdleTimer(slot)
    slot.idleTimer = setTimeout(() => {
      void teardownProvider(providerId)
    }, IDLE_TEARDOWN_MS)
  }

  async function acquireProvider(config: RuntimeConfig, providerId: AgentProviderId): Promise<() => Promise<void>> {
    const provider = getProvider(providerId)
    const slot = slotFor(providerId)
    clearIdleTimer(slot)

    if (slot.refCount === 0 && !slot.cleanup) {
      starting.add(providerId)
      try {
        const prepared = await provider.prepare?.({ config })
        if (prepared?.cleanup) slot.cleanup = prepared.cleanup
      } finally {
        starting.delete(providerId)
      }
    }

    slot.refCount += 1

    let released = false
    return async () => {
      if (released) return
      released = true
      const current = slots.get(providerId)
      if (!current) return
      current.refCount = Math.max(0, current.refCount - 1)
      if (current.refCount === 0) {
        scheduleIdleTeardown(providerId)
      }
    }
  }

  return {
    async acquire(config, providerId) {
      return acquireProvider(config, providerId)
    },

    async acquireForRoles(config, roles) {
      const uniqueIds = new Set<AgentProviderId>()
      for (const role of roles) {
        uniqueIds.add(providerForRole(config, role).id)
      }

      const releases: Array<() => Promise<void>> = []
      for (const providerId of uniqueIds) {
        releases.push(await acquireProvider(config, providerId))
      }

      let releasedAll = false
      return async () => {
        if (releasedAll) return
        releasedAll = true
        for (const release of releases.reverse()) {
          await release()
        }
      }
    },

    status(providerId) {
      if (starting.has(providerId)) return "starting"
      const slot = slots.get(providerId)
      if (slot && (slot.refCount > 0 || slot.cleanup)) return "running"
      return "idle"
    },

    async shutdown() {
      for (const slot of slots.values()) {
        clearIdleTimer(slot)
      }
      const ids = [...slots.keys()]
      for (const providerId of ids) {
        await teardownProvider(providerId)
      }
    },
  }
}

let defaultLifecycle: ProviderLifecycle | undefined

export function getProviderLifecycle(): ProviderLifecycle {
  if (!defaultLifecycle) {
    defaultLifecycle = createProviderLifecycle()
  }
  return defaultLifecycle
}

export function resetProviderLifecycleForTests() {
  defaultLifecycle = undefined
}
