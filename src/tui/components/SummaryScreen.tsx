import type { RunStore } from "../state/runStore"
import { useStoreSelector } from "../state/useStore"
import { theme } from "../theme"

export type SummaryAction = "rerun" | "new-topic" | "new-document" | "quit"

export interface SummaryScreenProps {
  store: RunStore
  onAction: (action: SummaryAction) => void
}

const NEXT_OPTIONS = [
  { name: "Re-run same input", description: "(stub) returns to prompt", value: "rerun" },
  { name: "New topic", description: "compose a new topic prompt", value: "new-topic" },
  { name: "New document", description: "compose a new document", value: "new-document" },
  { name: "Quit", description: "exit research-qurom", value: "quit" },
]

const NEXT_STYLE = { height: 8 }

const shortId = (id?: string): string => (id ? `${id.slice(0, 8)}..` : "----")

export const SummaryScreen = ({ store, onAction }: SummaryScreenProps) => {
  const phase = useStoreSelector(store, (s) => s.lifecycle.phase)
  const outputDir = useStoreSelector(store, (s) => s.lifecycle.outputDir)
  const traceId = useStoreSelector(store, (s) => s.lifecycle.traceId)
  const error = useStoreSelector(store, (s) => s.lifecycle.error)
  const result = useStoreSelector(store, (s) => s.result) as
    | {
        outcome?: string
        outputPath?: string
        raw?: { approvedAgents?: string[] }
      }
    | undefined
  const agents = useStoreSelector(store, (s) => s.agents)

  const approved =
    result?.raw?.approvedAgents ??
    Object.entries(agents)
      .filter(([, agent]) => agent.status === "complete" && !agent.pendingPermission)
      .map(([key]) => key)

  const outcome = result?.outcome ?? (phase === "error" ? "error" : "(unknown)")
  const outputPath = result?.outputPath ?? outputDir ?? "(none)"
  const errorMessage = error instanceof Error ? error.message : error ? String(error) : undefined

  return (
    <box flexDirection="column" padding={1} flexGrow={1}>
      <box border title="result" padding={1} flexDirection="column">
        <text>
          <span fg={theme.dim}>outcome  </span>
          <span fg={theme.accent}>{outcome}</span>
        </text>
        <text>
          <span fg={theme.dim}>approved </span>
          <span>{approved.length > 0 ? approved.join(", ") : "(none)"}</span>
        </text>
        <text>
          <span fg={theme.dim}>output   </span>
          <span>{outputPath}</span>
        </text>
        <text>
          <span fg={theme.dim}>trace    </span>
          <span>{shortId(traceId)}</span>
        </text>
        {errorMessage ? (
          <text fg={theme.system}>error: {errorMessage}</text>
        ) : null}
      </box>

      <box border title="next" padding={1}>
        <select
          focused
          options={NEXT_OPTIONS}
          onChange={(_, option) => {
            const v = option?.value
            if (v === "rerun" || v === "new-topic" || v === "new-document" || v === "quit") {
              onAction(v)
            }
          }}
          style={NEXT_STYLE}
        />
      </box>
    </box>
  )
}
