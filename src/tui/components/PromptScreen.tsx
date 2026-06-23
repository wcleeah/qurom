import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useState } from "react"
import type { InputRequest } from "../../schema"
import { theme } from "../theme"

export type PromptMode = "topic" | "document"

export interface PromptScreenProps {
  onSubmit: (request: InputRequest) => void
}

export const PromptScreen = ({ onSubmit }: PromptScreenProps) => {
  const { width, height } = useTerminalDimensions()
  const [mode, setMode] = useState<PromptMode>("topic")
  const [topic, setTopic] = useState("")
  const [documentPath, setDocumentPath] = useState("")

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

  useKeyboard((key) => {
    if (key.name === "tab") {
      setMode((current) => (current === "topic" ? "document" : "topic"))
      return
    }
    if (key.name === "return") {
      if (mode === "topic") submitTopic()
      else submitDocument()
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
                onSubmit={submitTopic}
              />
            ) : (
              <input
                placeholder="path to markdown file"
                focused
                width="100%"
                value={documentPath}
                onInput={setDocumentPath}
                onSubmit={submitDocument}
              />
            )}
          </box>

          <text fg={theme.textMuted}>
            Enter: run · Tab: {mode === "topic" ? "document mode" : "topic mode"} · Ctrl-C: quit
          </text>
        </box>
      </box>
      <box flexGrow={1} minHeight={0} />
    </box>
  )
}
