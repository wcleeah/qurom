import type { DebugLog } from "./debug-log"
import { StructuredRecoveryError } from "./opencode"
import { recoveryDriftDetector, SystemicDriftError } from "./recovery-drift"

/**
 * Phase 3.5 — outer fresh-session restart for auditors.
 *
 * When promptAgent's in-session RecoveryRouter exhausts its budget it throws a
 * typed StructuredRecoveryError. Audits are pure functions of (prompt, draft),
 * so we can tear down the poisoned session, create a brand-new OpenCode session
 * with a clean context window, and re-run the identical audit prompt — at most
 * `maxRestarts` times — before letting the run fail.
 *
 * Scoped to auditors by design: drafter/rebuttal/draft-synthesis carries
 * accumulated state across turns and would lose information on a fresh session.
 * Only the caller knows it is running an audit (promptAgent only knows the
 * agent by name), so the restart lives here at the caller layer. The wrapper
 * reuses the same `outputFile`/prompt/inputFiles so downstream file readers
 * keep seeing the canonical artifact path (no `.restart-N` clutter).
 *
 * Non-recovery errors propagate unchanged: only the categorized
 * StructuredRecoveryError is a recoverable retry signal. The wrapper matches
 * on `instanceof StructuredRecoveryError` so a programmer/contract error (an
 * assertStatus failure, a ZodError from caller code, etc.) is never masked as
 * "retry the audit".
 */

export interface AuditRestartInput<T> {
  maxRestarts: number
  agent: string
  round: number
  requestId: string
  /** Title prefix used to mint fresh-session titles, e.g. `audit:<req>:<agent>:round:<n>`. */
  titleBase: string
  /** Session already created and observed by the caller; used for attempt 0. */
  firstSessionID: string
  /**
   * Factory for fresh restart sessions. Inject as `opencode.createSession` in
   * production; inject a stub in tests so the wrapper is unit-testable without
   * Bun module mocking.
   */
  createSession: (title: string) => Promise<{ id: string }>
  /** Called whenever a fresh restart session is created (observe + telemetry). */
  onSessionCreated: (sessionID: string) => void
  /** Build the audit promptAgent/tui call and invoke it with `sessionID`. */
  runAttempt: (sessionID: string) => Promise<T>
  debugLog?: DebugLog
}

export async function auditWithRestart<T>(input: AuditRestartInput<T>): Promise<T> {
  for (let attempt = 0; attempt <= input.maxRestarts; attempt++) {
    const sessionID = attempt === 0
      ? input.firstSessionID
      : (await input.createSession(`${input.titleBase}:restart:${attempt}`)).id
    if (attempt > 0) {
      input.onSessionCreated(sessionID)
    }
    try {
      return await input.runAttempt(sessionID)
    } catch (e) {
      // Last attempt — propagate whatever it is.
      if (attempt === input.maxRestarts) throw e
      // Only StructuredRecoveryError is a recoverable restart signal;
      // any other throw (assertStatus, plain programmer error, etc.) propagates.
      if (!(e instanceof StructuredRecoveryError)) throw e
      input.debugLog?.write("audit.restart_from_scratch", {
        agent: input.agent,
        round: input.round,
        attempt: attempt + 1,
        fault: e.fault,
        priorAttempts: e.attempts,
        requestId: input.requestId,
      })
      const drift = recoveryDriftDetector.recordRestart(input.agent, input.requestId)
      if (drift.drift) {
        input.debugLog?.write("recovery.systemic_drift", {
          agent: input.agent,
          requestIds: drift.previousRequestIds,
          secondRunFault: e.fault,
          recommendedAction: `audit prompt/schema for ${input.agent}`,
        })
        throw new SystemicDriftError({
          agent: input.agent,
          requestIds: drift.previousRequestIds,
          secondRunFault: e.fault,
        })
      }
    }
  }
  // Unreachable: the loop body always either returns or throws.
  throw new Error("auditWithRestart: unreachable (attempt loop exited without return)")
}