import { useKeyboard, useRenderer } from "@opentui/react"
import { useMemo, useState } from "react"
import type { RuntimeConfig } from "../../config"
import type { InputRequest } from "../../schema"
import { openInEditor } from "../editor"
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

export const PromptScreen = ({ config, onSubmit }: PromptScreenProps) => {
  const renderer = useRenderer()
  const [mode, setMode] = useState<PromptMode>("topic")
  const [topic, setTopic] = useState("")
  const [doc, setDoc] = useState<{ path: string; content: string } | undefined>(undefined)
  const [hint, setHint] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const requestId = useMemo(generateRequestId, [])

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
    if (mode !== "document") return
    if (key.name === "e") void handleEditDoc()
    else if (key.name === "return") submitDoc()
    else if (key.name === "escape") setMode("topic")
    else if (key.name === "tab") setMode("topic")
  })

  return (
    <box flexDirection="column" padding={1} flexGrow={1}>
      <box border title="research-qurom" padding={1} flexDirection="column">
        <text fg={theme.accent}>choose input mode</text>
        <select
          options={[
            { name: "Topic", description: "Type a research topic", value: "topic" },
            { name: "Compose document", description: "Open $EDITOR to write a draft", value: "document" },
          ]}
          focused={false}
          onChange={(_, option) => {
            const value = option?.value
            if (value === "topic" || value === "document") {
              setMode(value)
              setHint("")
            }
          }}
          style={{ height: 4 }}
        />
      </box>

      {mode === "topic" ? (
        <box border title="topic" padding={1} flexDirection="column">
          <input
            placeholder="e.g. effects of Mediterranean diet on cardiovascular outcomes"
            focused
            onInput={setTopic}
            onSubmit={submitTopic}
          />
          <text fg={theme.dim}>Enter to run</text>
        </box>
      ) : (
        <box border title="document" padding={1} flexDirection="column">
          {doc ? (
            <text>
              {doc.path}
              <span fg={theme.dim}>{`  ·  ${doc.content.length} chars  ·  ${doc.content.split("\n")[0].slice(0, 48)}`}</span>
            </text>
          ) : (
            <text fg={theme.dim}>(no document yet — press e to compose)</text>
          )}
          <text fg={theme.dim}>e edit  ·  Enter run  ·  Esc back</text>
        </box>
      )}

      {hint ? <text fg={theme.dim}>{hint}</text> : null}
    </box>
  )
}
