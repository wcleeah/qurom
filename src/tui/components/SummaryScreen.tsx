import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { TMUX_TOP_INSET, centeredColumnWidth } from "../layout"
import type { RunStore } from "../state/runStore"
import { useStoreSelector } from "../state/useStore"
import { theme } from "../theme"

export type SummaryAction = "rerun" | "new-topic" | "new-document" | "quit"

export interface SummaryScreenProps {
  store: RunStore
  onAction: (action: SummaryAction) => void
}

const NEXT_OPTIONS = [
  { name: "Re-run same input", description: "run again", value: "rerun" },
  { name: "New topic", description: "fresh prompt", value: "new-topic" },
  { name: "New document", description: "fresh draft", value: "new-document" },
  { name: "Quit", description: "exit", value: "quit" },
]

const NEXT_STYLE = { height: 8 }

const shortId = (id?: string): string => (id ? `${id.slice(0, 8)}..` : "----")

const outcomeColor = (outcome: string): string => {
  if (outcome === "approved") return theme.success
  if (outcome === "error" || outcome === "failed") return theme.error
  return theme.warning
}

const outcomeLabel = (outcome: string): string => outcome.replace(/_/g, " ").toUpperCase()

export const SummaryScreen = ({ store, onAction }: SummaryScreenProps) => {
  const { width, height } = useTerminalDimensions()
  const phase = useStoreSelector(store, (s) => s.lifecycle.phase)
  const outputDir = useStoreSelector(store, (s) => s.lifecycle.outputDir)
  const traceId = useStoreSelector(store, (s) => s.lifecycle.traceId)
  const error = useStoreSelector(store, (s) => s.lifecycle.error)
  const result = useStoreSelector(store, (s) => s.result) as
      | {
          status?: string
          outputPath?: string
          round?: number
          approvedAgents?: string[]
          unresolvedFindings?: unknown[]
          failureReason?: string
          inputSummary?: { title?: string; summary?: string }
          artifactSummary?: { title?: string; summary?: string }
        }
    | undefined
  const agents = useStoreSelector(store, (s) => s.agents)

  const approved =
    result?.approvedAgents ??
    Object.entries(agents)
      .filter(([, agent]) => agent.status === "complete" && !agent.pendingPermission)
      .map(([key]) => key)
  const audits = Array.isArray((result as { audits?: unknown[] } | undefined)?.audits)
    ? ((result as { audits?: Array<{ agent: string; vote: string }> }).audits ?? [])
    : []
  const approveVotes = audits.filter((audit) => audit.vote === "approve").length
  const reviseVotes = audits.filter((audit) => audit.vote === "revise").length
  const findingsByAgent = Object.entries(
    (result?.unresolvedFindings ?? []).reduce<Record<string, number>>((acc, finding) => {
      const agent =
        finding && typeof finding === "object" && "agent" in finding && typeof finding.agent === "string"
          ? finding.agent
          : "unknown"
      acc[agent] = (acc[agent] ?? 0) + 1
      return acc
    }, {}),
  )

  const outcome = phase === "error" ? "error" : result?.status ?? "(unknown)"
  const round = result?.round
  const unresolvedCount = result?.unresolvedFindings?.length ?? 0
  const failureReason = result?.failureReason
  const outputPath = result?.outputPath ?? outputDir ?? "(none)"
  const errorMessage = error instanceof Error ? error.message : error ? String(error) : undefined
  const wide = width >= 100
  const outerWidth = wide ? 100 : centeredColumnWidth(width, 92, 72)
  const topBias = height >= 34 ? 1 : 0
  const artifactSummaryTitle = result?.artifactSummary?.title ?? "(not available)"
  const artifactSummaryText = result?.artifactSummary?.summary ?? "(summary unavailable)"
  const inputSummaryTitle = result?.inputSummary?.title ?? "(not available)"
  const inputSummaryText = result?.inputSummary?.summary ?? "(summary unavailable)"

  useKeyboard((key) => {
    if (key.name === "q") onAction("quit")
    else if (key.name === "r") onAction("rerun")
    else if (key.name === "n") onAction("new-topic")
    else if (key.name === "f") onAction("new-document")
  })

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2} backgroundColor={theme.background}>
      {TMUX_TOP_INSET > 0 ? <box height={TMUX_TOP_INSET} flexShrink={0} /> : null}
      <box flexGrow={1} minHeight={0} />
      {topBias > 0 ? <box height={topBias} flexShrink={0} /> : null}
      <box alignItems="center" flexShrink={0}>
        <box width={outerWidth} flexDirection={wide ? "row" : "column"} gap={1}>
          <box flexGrow={1} flexDirection="column" gap={1}>
            <box
              border
              borderStyle="double"
              borderColor={outcomeColor(outcome)}
              backgroundColor={theme.backgroundPanel}
              padding={1}
              flexDirection="column"
            >
              <text fg={outcomeColor(outcome)} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
                {outcomeLabel(outcome)}
              </text>
              <text fg={theme.textMuted} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
                {`Round ${round ?? "-"}  ·  ${approved.length} approved  ·  ${unresolvedCount} unresolved`}
              </text>
              <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
                {approved.length > 0 ? approved.join(", ") : "(no approvals recorded)"}
              </text>
            </box>

            <box
              border
              borderStyle="single"
              borderColor={theme.borderSubtle}
              backgroundColor={theme.backgroundElement}
              padding={1}
              flexDirection="column"
            >
              <text fg={theme.textMuted} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
                artifact
              </text>
              <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
                {outputPath}
              </text>
              <text fg={theme.textMuted} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
                {`trace ${shortId(traceId)}`}
              </text>
              {failureReason ? (
                <text fg={theme.textMuted} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
                  {`failure: ${failureReason}`}
                </text>
              ) : null}
              {errorMessage ? (
                <text fg={theme.textMuted} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
                  {`error: ${errorMessage}`}
                </text>
              ) : null}
            </box>

            <box
              border
              borderStyle="single"
              borderColor={theme.borderSubtle}
              backgroundColor={theme.backgroundElement}
              padding={1}
              flexDirection="column"
            >
              <text fg={theme.textMuted} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
                distribution
              </text>
              <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
                {`votes: ${approveVotes} approve / ${reviseVotes} revise`}
              </text>
              <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
                {findingsByAgent.length > 0
                  ? `findings: ${findingsByAgent.map(([agent, count]) => `${agent} ${count}`).join(" · ")}`
                  : "findings: none unresolved"}
              </text>
            </box>

            <box
              border
              borderStyle="single"
              borderColor={theme.borderSubtle}
              backgroundColor={theme.backgroundElement}
              padding={1}
              flexDirection="column"
            >
              <text fg={theme.textMuted} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
                artifact summary
              </text>
              <text selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>{artifactSummaryTitle}</text>
              <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
                {artifactSummaryText}
              </text>
            </box>

            <box
              border
              borderStyle="single"
              borderColor={theme.borderSubtle}
              backgroundColor={theme.backgroundElement}
              padding={1}
              flexDirection="column"
            >
              <text fg={theme.textMuted} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
                input summary
              </text>
              <text selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>{inputSummaryTitle}</text>
              <text wrapMode="word" selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
                {inputSummaryText}
              </text>
            </box>
          </box>

          <box
            width={wide ? 38 : "100%"}
            border
            borderStyle="single"
            borderColor={theme.borderSubtle}
            backgroundColor={theme.backgroundPanel}
            padding={1}
            flexDirection="column"
          >
            <text fg={theme.textMuted} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
              what next
            </text>
            <text fg={theme.textMuted} selectionBg={theme.selectionBg} selectionFg={theme.selectionFg}>
              use arrow keys and Enter
            </text>
            <select
              focused
              options={NEXT_OPTIONS}
              onSelect={(_, option) => {
                const v = option?.value
                if (v === "rerun" || v === "new-topic" || v === "new-document" || v === "quit") {
                  onAction(v)
                }
              }}
              style={NEXT_STYLE}
            />
          </box>
        </box>
      </box>
      <box flexGrow={1} minHeight={0} />
    </box>
  )
}
