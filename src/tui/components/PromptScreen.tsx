import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useState } from "react"
import type { InputRequest } from "../../schema"
import { theme } from "../theme"

export type PromptMode = "topic" | "document" | "design"

export interface PromptScreenProps {
  onSubmit: (request: InputRequest) => void
  onDesignSubmit?: (runId: string) => void
}

export const PromptScreen = ({ onSubmit, onDesignSubmit }: PromptScreenProps) => {
  const { width, height } = useTerminalDimensions()
  const [mode, setMode] = useState<PromptMode>("topic")
  const [topic, setTopic] = useState("")
  const [documentPath, setDocumentPath] = useState("")
  const [designRunId, setDesignRunId] = useState("")

  const submitTopic = () => {
    const trimmed = topic.trim()
    if (trimmed.length === 0) return
    onSubmit({ inputMode: "topic", topic: trimmed })
  }

  const submitDocument = () => {
    const trimmed = documentPath.trim()
    if (trimmed.length === 0) return
    onSubmit({ inputMode: "document", documentPath: trimmed })
  }

  const submitDesign = () => {
    const trimmed = designRunId.trim()
    if (trimmed.length === 0) return
    onDesignSubmit?.(trimmed)
  }

  useKeyboard((key) => {
    if (key.name === "tab") {
      setMode((current) => {
        if (current === "topic") return "document"
        if (current === "document") return "design"
        return "topic"
      })
      return
    }
    if (key.name === "return") {
      if (mode === "topic") submitTopic()
      else if (mode === "document") submitDocument()
      else submitDesign()
      return
    }
  })

  const topBias = height >= 30 ? 2 : 1

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2} backgroundColor={theme.background}>
      <box flexGrow={1} minHeight={0} />
      {topBias > 0 ? <box height={topBias} flexShrink={0} /> : null}
      <box alignItems="center" flexShrink={0}>
        <box width={Math.min(width - 4, 72)} flexDirection="column" gap={1}>
          <text fg={theme.accent}>research-qurom</text>

          <box flexDirection="row" gap={1}>
            <text fg={mode === "topic" ? theme.text : theme.textMuted}>
              {mode === "topic" ? "● topic" : "○ topic"}
            </text>
            <text fg={mode === "document" ? theme.text : theme.textMuted}>
              {mode === "document" ? "● document" : "○ document"}
            </text>
            <text fg={mode === "design" ? theme.text : theme.textMuted}>
              {mode === "design" ? "● design" : "○ design"}
            </text>
          </box>

          <box
            border
            borderStyle="single"
            borderColor={theme.borderActive}
            backgroundColor={theme.backgroundPanel}
            padding={1}
            width="100%"
          >
            {mode === "topic" ? (
              <input
                placeholder="e.g. Why is 1+1 2?"
                focused
                width="100%"
                value={topic}
                onInput={setTopic}
              />
            ) : mode === "document" ? (
              <input
                placeholder="path to markdown file"
                focused
                width="100%"
                value={documentPath}
                onInput={setDocumentPath}
              />
            ) : (
              <input
                placeholder="run directory name or request ID"
                focused
                width="100%"
                value={designRunId}
                onInput={setDesignRunId}
              />
            )}
          </box>

          <text fg={theme.textMuted}>
            Enter: run · Tab: {mode === "topic" ? "document" : mode === "document" ? "design" : "topic"} mode · Ctrl-C: quit
          </text>
        </box>
      </box>
      <box flexGrow={1} minHeight={0} />
    </box>
  )
}
