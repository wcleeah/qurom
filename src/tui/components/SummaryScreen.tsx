import { useStoreSelector } from "../state/useStore"
import type { RunStore } from "../state/runStore"
import { theme } from "../theme"

export interface SummaryScreenProps {
  store: RunStore
  viewUrl?: string
}

type RunResult = {
  status?: string
  designStatus?: string
  outputPath?: string
  requestId?: string
  round?: number
  approvedAgents?: unknown[]
  unresolvedFindings?: unknown[]
}

const VERDICT_LABEL: Record<string, string> = {
  approved: "Approved",
  failed: "Failed",
  approved_with_caveats: "Approved with caveats",
}

export const SummaryScreen = ({ store, viewUrl }: SummaryScreenProps) => {
  const phase = useStoreSelector(store, (s) => s.lifecycle.phase)
  const error = useStoreSelector(store, (s) => s.lifecycle.error)
  const outputDir = useStoreSelector(store, (s) => s.lifecycle.outputDir)
  const result = useStoreSelector(store, (s) => s.result) as RunResult | undefined

  const errored = phase === "error"
  const researchOutcome = result?.status
  const designOutcome = result?.designStatus

  const verdictText = errored
    ? "Run errored"
    : designOutcome === "approved"
      ? "Research approved · Design approved"
      : designOutcome === "failed"
        ? "Research approved · Design failed (best-effort HTML saved)"
        : researchOutcome
          ? `Research ${VERDICT_LABEL[researchOutcome] ?? researchOutcome}`
          : "Run complete"

  const verdictColor = errored
    ? theme.error
    : designOutcome === "approved" || researchOutcome === "approved"
      ? theme.success
      : theme.warning

  const errorMessage = error instanceof Error ? error.message : error ? String(error) : undefined

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={2} flexGrow={1}>
      <text fg={verdictColor} flexShrink={0}>
        {errored ? "✗" : "✓"} {verdictText}
      </text>

      {outputDir && (
        <text fg={theme.textMuted} marginTop={1} flexShrink={0}>
          Output: {outputDir}
        </text>
      )}

      {viewUrl && (
        <text fg={theme.textMuted} flexShrink={0}>
          Dashboard: {viewUrl}
        </text>
      )}

      {errorMessage && (
        <text fg={theme.error} marginTop={1} wrapMode="word" flexShrink={0}>
          {errorMessage}
        </text>
      )}

      <box flexGrow={1} />

      <text fg={theme.textMuted} flexShrink={0}>
        Enter: new run · Ctrl-C: exit
      </text>
    </box>
  )
}
