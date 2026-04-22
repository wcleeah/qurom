export const theme = {
  drafter: { borderColor: "brightCyan", borderStyle: "double" as const },
  auditor: {
    "source-auditor": { borderColor: "magenta", borderStyle: "single" as const },
    "logic-auditor": { borderColor: "yellow", borderStyle: "single" as const },
    "clarity-auditor": { borderColor: "green", borderStyle: "single" as const },
  },
  status: { running: "yellow", idle: "gray", error: "red", complete: "green" },
  panel: "white",
  drafterColor: "brightCyan",
  accent: "brightYellow",
  dim: "gray",
  tool: "cyan",
  permission: "yellow",
  system: "red",
  reasoning: "gray",
} as const

export type AuditorRole = keyof typeof theme.auditor
