export class SystemicDriftError extends Error {
  readonly agent: string
  readonly requestIds: string[]
  readonly secondRunFault: string

  constructor(input: { agent: string; requestIds: string[]; secondRunFault: string }) {
    super(
      `recovery.systemic_drift: agent ${input.agent} restarted across distinct runs (${input.requestIds.join(", ")}); audit prompt/schema drift suspected`,
    )
    this.name = "SystemicDriftError"
    this.agent = input.agent
    this.requestIds = input.requestIds
    this.secondRunFault = input.secondRunFault
  }
}

export class RecoveryDriftDetector {
  private readonly seen = new Map<string, Set<string>>()

  recordRestart(agent: string, requestId: string): { drift: boolean; previousRequestIds: string[] } {
    const set = this.seen.get(agent) ?? new Set<string>()
    if (set.has(requestId)) {
      return { drift: false, previousRequestIds: [...set] }
    }
    if (set.size > 0) {
      set.add(requestId)
      this.seen.set(agent, set)
      return { drift: true, previousRequestIds: [...set] }
    }
    set.add(requestId)
    this.seen.set(agent, set)
    return { drift: false, previousRequestIds: [...set] }
  }

  resetForTests() {
    this.seen.clear()
  }
}

export const recoveryDriftDetector = new RecoveryDriftDetector()
