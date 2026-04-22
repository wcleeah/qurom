import type { RunStore, RunStoreState } from "../state/runStore"
import { useStoreSelector } from "../state/useStore"
import { theme } from "../theme"

export type SummaryAction = "rerun" | "new-topic" | "new-document" | "quit"

export interface SummaryScreenProps {
  store: RunStore
  onAction: (action: SummaryAction) => void
}

const selectSummary = (s: RunStoreState) => ({
  phase: s.lifecycle.phase,
  outputDir: s.lifecycle.outputDir,
  traceId: s.lifecycle.traceId,
  error: s.lifecycle.error,
  result: s.result,
  approved: Object.entries(s.agents)
    .filter(([, a]) => a.status === "complete" && !a.pendingPermission)
    .map(([k]) => k),
})

const shortId = (id?: string): string => (id ? `${id.slice(0, 8)}..` : "----")

export const SummaryScreen = ({ store, onAction }: SummaryScreenProps) => {
  const summary = useStoreSelector(store, selectSummary)
  const result = summary.result as { outcome?: string; outputPath?: string } | undefined
  const outcome = result?.outcome ?? (summary.phase === "error" ? "error" : "(unknown)")
  const outputPath = result?.outputPath ?? summary.outputDir ?? "(none)"
  const errorMessage = summary.error instanceof Error ? summary.error.message : summary.error ? String(summary.error) : undefined

  return (
    <box flexDirection="column" padding={1} flexGrow={1}>
      <box border title="result" padding={1} flexDirection="column">
        <text>
          <span fg={theme.dim}>outcome  </span>
          <span fg={theme.accent}>{outcome}</span>
        </text>
        <text>
          <span fg={theme.dim}>approved </span>
          <span>{summary.approved.length > 0 ? summary.approved.join(", ") : "(none)"}</span>
        </text>
        <text>
          <span fg={theme.dim}>output   </span>
          <span>{outputPath}</span>
        </text>
        <text>
          <span fg={theme.dim}>trace    </span>
          <span>{shortId(summary.traceId)}</span>
        </text>
        {errorMessage ? (
          <text fg={theme.system}>error: {errorMessage}</text>
        ) : null}
      </box>

      <box border title="next" padding={1}>
        <select
          focused
          options={[
            { name: "Re-run same input", description: "(stub) returns to prompt", value: "rerun" },
            { name: "New topic", description: "compose a new topic prompt", value: "new-topic" },
            { name: "New document", description: "compose a new document", value: "new-document" },
            { name: "Quit", description: "exit research-qurom", value: "quit" },
          ]}
          onChange={(_, option) => {
            const v = option?.value
            if (v === "rerun" || v === "new-topic" || v === "new-document" || v === "quit") {
              onAction(v)
            }
          }}
          style={{ height: 8 }}
        />
      </box>
    </box>
  )
}
