import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useMemo, useState } from "react"
import type { RuntimeConfig } from "../../config"
import type { InputRequest } from "../../schema"
import { openInEditor } from "../editor"
import { TMUX_TOP_INSET, centeredColumnWidth } from "../layout"
import { theme } from "../theme"

export type PromptMode = "topic" | "document"

export interface PromptScreenProps {
  config: RuntimeConfig
  onSubmit: (request: InputRequest) => void
}

const generateRequestId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `req-${Date.now().toString(16)}-${Math.floor(Math.random() * 1e9).toString(16)}`
}

const formatCharCount = (value: string): string => {
  if (value.length >= 1000) return `${(value.length / 1000).toFixed(1)}k chars`
  return `${value.length} chars`
}

const previewLine = (value: string): string => {
  const line = value
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0)
  return line ? line.slice(0, 72) : "(empty document)"
}

const ModeChip = ({ active, label }: { active: boolean; label: string }) => (
  <box
    border
    borderStyle="single"
    borderColor={active ? theme.borderActive : theme.borderSubtle}
    backgroundColor={active ? theme.backgroundPanel : theme.backgroundElement}
    paddingLeft={1}
    paddingRight={1}
  >
    <text fg={active ? theme.text : theme.textMuted}>{label}</text>
  </box>
)

export const PromptScreen = ({ config, onSubmit }: PromptScreenProps) => {
  const { width, height } = useTerminalDimensions()
  const renderer = useRenderer()
  const [mode, setMode] = useState<PromptMode>("topic")
  const [topic, setTopic] = useState("")
  const [doc, setDoc] = useState<{ path: string; content: string } | undefined>(undefined)
  const [hint, setHint] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const requestId = useMemo(generateRequestId, [])
  const columnWidth = centeredColumnWidth(width, 84, 68)
  const topBias = height >= 34 ? 2 : 1

  const submitTopic = () => {
    const trimmed = topic.trim()
    if (trimmed.length === 0) {
      setHint("type a topic to run")
      return
    }
    onSubmit({ inputMode: "topic", topic: trimmed })
  }

  const handleEditDoc = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await openInEditor({
        requestId,
        renderer,
        artifactRoot: config.quorumConfig.artifactDir,
      })
      if (result.ok) {
        setDoc({ path: result.path, content: result.content })
        setHint("")
      } else if (result.reason === "empty") {
        setHint("(empty — nothing saved)")
      } else if (result.reason === "cancelled") {
        setHint("(cancelled)")
      } else {
        setHint(`(editor exit ${result.code ?? "?"})`)
      }
    } finally {
      setBusy(false)
    }
  }

  const submitDoc = () => {
    if (!doc || doc.content.trim().length === 0) {
      setHint("compose a document first (press e)")
      return
    }
    onSubmit({ inputMode: "document", documentPath: doc.path })
  }

  useKeyboard((key) => {
    if (key.name === "tab") {
      setMode((current) => (current === "topic" ? "document" : "topic"))
      setHint("")
      return
    }
    if (mode !== "document") return
    if (key.name === "e") void handleEditDoc()
    else if (key.name === "return") submitDoc()
    else if (key.name === "escape") {
      setMode("topic")
      setHint("")
    }
  })

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2} backgroundColor={theme.background}>
      {TMUX_TOP_INSET > 0 ? <box height={TMUX_TOP_INSET} flexShrink={0} /> : null}
      <box flexGrow={1} minHeight={0} />
      {topBias > 0 ? <box height={topBias} flexShrink={0} /> : null}
      <box alignItems="center" flexShrink={0}>
        <box width={columnWidth} flexDirection="column" gap={1}>
          <box flexDirection="column">
            <text fg={theme.accent}>research-qurom</text>
            <text fg={theme.textMuted}>Run a topic or draft a source document, then hand it to the quorum.</text>
          </box>

          <box flexDirection="row" gap={1}>
            <ModeChip active={mode === "topic"} label="topic" />
            <ModeChip active={mode === "document"} label="compose document" />
          </box>

          <box
            border
            borderStyle={mode === "topic" ? "double" : "single"}
            borderColor={mode === "topic" ? theme.borderActive : theme.borderSubtle}
            backgroundColor={theme.backgroundPanel}
            padding={1}
            flexDirection="column"
          >
            {mode === "topic" ? (
              <>
                <text fg={theme.textMuted}>Ask a research question or paste a topic.</text>
                <box
                  border
                  borderStyle="single"
                  borderColor={theme.borderSubtle}
                  backgroundColor={theme.backgroundElement}
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <input
                    placeholder="e.g. effects of Mediterranean diet on cardiovascular outcomes"
                    focused
                    onInput={setTopic}
                    onSubmit={submitTopic}
                  />
                </box>
                <text fg={theme.textMuted}>Enter run  ·  Tab switch modes</text>
              </>
            ) : (
              <>
                <text fg={theme.textMuted}>Open $EDITOR, save the document, then run the quorum on that draft.</text>
                <box
                  border
                  borderStyle="single"
                  borderColor={theme.borderSubtle}
                  backgroundColor={theme.backgroundElement}
                  padding={1}
                  flexDirection="column"
                >
                  {doc ? (
                    <>
                      <text wrapMode="word">{doc.path}</text>
                      <text fg={theme.textMuted} wrapMode="word">
                        {`${formatCharCount(doc.content)}  ·  ${previewLine(doc.content)}`}
                      </text>
                    </>
                  ) : (
                    <text fg={theme.textMuted}>(no document loaded yet)</text>
                  )}
                </box>
                <text fg={theme.textMuted}>e open editor  ·  Enter run  ·  Tab or Esc topic</text>
              </>
            )}
          </box>

          {hint ? (
            <box
              border
              borderStyle="single"
              borderColor={theme.borderSubtle}
              backgroundColor={theme.backgroundElement}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={theme.textMuted}>{hint}</text>
            </box>
          ) : null}

          <box>
            <text fg={theme.textMuted}>
              {mode === "topic"
                ? "Topic mode runs immediately from the prompt above."
                : "Document mode keeps the draft on disk under runs/.drafts/."}
            </text>
          </box>
        </box>
      </box>
      <box flexGrow={1} minHeight={0} />
    </box>
  )
}
