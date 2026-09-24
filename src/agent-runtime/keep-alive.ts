/** A keepAlive provider session is gone (error, cancelled, or not active). */
export class KeepAliveSessionDeadError extends Error {
  readonly handleId: string
  readonly reason: string

  constructor(handleId: string, reason: string, options?: ErrorOptions) {
    super(`Keep-alive session ${handleId} died (${reason})`, options)
    this.name = "KeepAliveSessionDeadError"
    this.handleId = handleId
    this.reason = reason
  }
}

export function isDeadKeepAliveReason(reason: string): boolean {
  const text = reason.toLowerCase()
  if (/\b(cancelled|canceled)\b/.test(text)) return true
  if (/\bnot active\b/.test(text)) return true
  if (/\brun(?: ended with)? status error\b/.test(text)) return true
  if (/\bstatus error\b/.test(text)) return true
  return false
}
