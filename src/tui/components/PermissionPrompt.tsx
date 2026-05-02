import { useKeyboard } from "@opentui/react"
import type { PendingPermissionEntry } from "../state/runStore"
import { theme } from "../theme"

export interface PermissionPromptProps {
  permission: PendingPermissionEntry
  submitting?: boolean
  onReply: (reply: "once" | "always" | "reject") => void
}

function formatPatterns(patterns: string[]) {
  if (patterns.length === 0) return "(none)"
  return patterns.join(", ")
}

function formatAlways(always: string[]) {
  if (always.length === 0) return "(not provided)"
  return always.join(", ")
}

export const PermissionPrompt = ({ permission, submitting = false, onReply }: PermissionPromptProps) => {
  useKeyboard((key) => {
    if (submitting) return
    if (key.name === "o") onReply("once")
    else if (key.name === "a") onReply("always")
    else if (key.name === "r" || key.name === "escape") onReply("reject")
  })

  return (
    <box
      position="absolute"
      top="18%"
      left="16%"
      width="68%"
      border
      borderStyle="double"
      borderColor={theme.borderActive}
      backgroundColor={theme.backgroundPanel}
      padding={1}
      flexDirection="column"
      zIndex={40}
      gap={1}
    >
      <text fg={theme.permission}>permission required</text>
      <text wrapMode="word" fg={theme.text}>
        {`${permission.roleKey}: ${permission.permission}`}
      </text>
      <text wrapMode="word" fg={theme.textMuted}>
        {`patterns: ${formatPatterns(permission.patterns)}`}
      </text>
      <text wrapMode="word" fg={theme.textMuted}>
        {`always scope: ${formatAlways(permission.always)}`}
      </text>
      <text fg={theme.textMuted}>
        {submitting ? "sending reply..." : "o allow once  |  a allow always  |  r / Esc reject"}
      </text>
    </box>
  )
}
