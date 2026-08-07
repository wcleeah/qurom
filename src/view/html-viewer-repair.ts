import type { HtmlReaderRepairMessage, HtmlReaderRepairThread } from "./html-repair-store"
import { escapeHtml } from "./utils"

export function repairThreadsToJson(threads: HtmlReaderRepairThread[]): string {
  return escapeHtml(JSON.stringify(threads))
}

export function repairMessagesToJson(messages: HtmlReaderRepairMessage[]): string {
  return escapeHtml(JSON.stringify(messages))
}

export const HTML_REPAIR_SCRIPT = /* html */ `
<script>
(function () {
  const root = document.querySelector("[data-html-repair-root]")
  if (!(root instanceof HTMLElement)) return

  const runName = root.dataset.runName || ""
  const filePath = root.dataset.file || ""
  const apiBase = "/runs/" + encodeURIComponent(runName) + "/html-repair"

  let threads = []
  try { threads = JSON.parse(root.dataset.threads || "[]") } catch { threads = [] }

  const shell = document.querySelector(".html-viewer-shell")
  const repairTab = document.querySelector('[data-html-tab="fix"]')
  const repairPanel = document.querySelector('[data-html-panel="fix"]')
  const chatListEl = document.querySelector("[data-html-repair-chat-list]")
  const contextChipEl = document.querySelector("[data-html-repair-context]")
  const messagesEl = document.querySelector("[data-html-repair-messages]")
  const form = document.querySelector("[data-html-repair-form]")
  const input = document.querySelector("[data-html-repair-input]")
  const sendBtn = document.querySelector("[data-html-repair-send]")
  const newChatBtn = document.querySelector("[data-html-repair-new]")
  const statusEl = document.querySelector("[data-html-repair-status]")
  const iframe = document.querySelector(".html-viewer-frame")

  let activeThreadId = null
  let bootstrapSelection = null
  let messageCache = new Map()
  let streaming = false

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  }

  function truncate(text, max) {
    const trimmed = String(text || "").trim()
    if (trimmed.length <= max) return trimmed
    return trimmed.slice(0, max - 1) + "…"
  }

  function renderMarkdownHtml(text) {
    if (typeof window.quorumRenderMarkdown === "function") {
      return window.quorumRenderMarkdown(text)
    }
    return escapeHtml(text)
  }

  function renderMessageBody(message) {
    const bodyClass = "html-viewer-ask-message-body" +
      (message.role === "assistant" ? " md-content" : "")
    const content = message.role === "assistant"
      ? renderMarkdownHtml(message.content)
      : escapeHtml(message.content)
    return '<div class="' + bodyClass + '">' + content + "</div>"
  }

  let markdownRenderFrame = 0
  function scheduleAssistantMarkdown(bodyEl, text) {
    if (!(bodyEl instanceof HTMLElement)) return
    cancelAnimationFrame(markdownRenderFrame)
    markdownRenderFrame = requestAnimationFrame(() => {
      bodyEl.innerHTML = renderMarkdownHtml(text)
    })
  }

  function setStatus(text, isError) {
    if (!(statusEl instanceof HTMLElement)) return
    statusEl.textContent = text
    statusEl.classList.toggle("html-viewer-ask-status-error", !!isError)
  }

  function formatRelative(iso) {
    const ms = Date.parse(iso)
    if (Number.isNaN(ms)) return ""
    const diff = Date.now() - ms
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return "just now"
    if (mins < 60) return mins + "m ago"
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return hrs + "h ago"
    const days = Math.floor(hrs / 24)
    if (days < 7) return days + "d ago"
    return new Date(ms).toLocaleDateString()
  }

  function renderContextUi() {
    if (!(contextChipEl instanceof HTMLElement)) return
    if (activeThreadId) {
      const thread = threads.find((entry) => entry.id === activeThreadId)
      if (thread && thread.contextQuote) {
        contextChipEl.hidden = false
        contextChipEl.textContent = 'Started from selection: "' + truncate(thread.contextQuote, 72) + '"'
        return
      }
      contextChipEl.hidden = true
      return
    }
    if (bootstrapSelection && bootstrapSelection.quote) {
      contextChipEl.hidden = false
      contextChipEl.textContent = 'Selected text: "' + truncate(bootstrapSelection.quote, 72) + '"'
      return
    }
    contextChipEl.hidden = true
  }

  function renderChatList() {
    if (!(chatListEl instanceof HTMLElement)) return
    const rows = ['<div class="html-viewer-ask-chat-list-header">Repair chats</div>']
    for (const thread of threads) {
      const active = thread.id === activeThreadId
      const label = truncate(thread.firstUserPreview || thread.lastMessagePreview || "New repair", 56)
      rows.push(
        '<div class="html-viewer-ask-chat-row' + (active ? " html-viewer-ask-chat-row-active" : "") + '">' +
        '<button type="button" class="html-viewer-ask-chat-open" data-repair-thread-id="' + escapeHtml(thread.id) + '"' +
        (active ? ' aria-current="true"' : "") + ">" +
        (active ? '<span class="html-viewer-ask-chat-selected">Selected</span>' : "") +
        '<span class="html-viewer-ask-chat-title">' + escapeHtml(label) + "</span>" +
        '<span class="html-viewer-ask-chat-meta">' +
        '<span class="html-viewer-ask-chat-badge">Fix</span> ' +
        escapeHtml(formatRelative(thread.updatedAt)) +
        "</span></button>" +
        '<button type="button" class="html-viewer-ask-chat-delete" data-repair-delete-id="' + escapeHtml(thread.id) + '" aria-label="Delete repair chat">×</button>' +
        "</div>",
      )
    }
    if (!threads.length) {
      rows.push('<p class="html-viewer-ask-empty muted-text">No repair chats yet.</p>')
    }
    chatListEl.innerHTML = rows.join("")
  }

  function renderMessages(messages) {
    if (!(messagesEl instanceof HTMLElement)) return
    if (!messages.length) {
      messagesEl.innerHTML = '<p class="html-viewer-ask-empty muted-text">Describe a bug in this HTML page (for example: cannot scroll).</p>'
      return
    }
    messagesEl.innerHTML = messages.map((message) => {
      return '<div class="html-viewer-ask-message html-viewer-ask-message-' + escapeHtml(message.role) + '">' +
        renderMessageBody(message) + "</div>"
    }).join("")
    messagesEl.scrollTop = messagesEl.scrollHeight
  }

  async function loadMessages(threadId) {
    if (messageCache.has(threadId)) {
      renderMessages(messageCache.get(threadId))
      return
    }
    const resp = await fetch(
      apiBase + "/threads/" + encodeURIComponent(threadId) + "/messages?file=" + encodeURIComponent(filePath),
    )
    if (!resp.ok) throw new Error("failed to load messages")
    const data = await resp.json()
    const messages = Array.isArray(data.messages) ? data.messages : []
    messageCache.set(threadId, messages)
    renderMessages(messages)
  }

  async function selectChat(threadId) {
    activeThreadId = threadId
    bootstrapSelection = null
    renderChatList()
    renderContextUi()
    await loadMessages(threadId)
  }

  function startNewChat(selection) {
    activeThreadId = null
    bootstrapSelection = selection && selection.quote
      ? {
        quote: selection.quote,
        prefix: selection.prefix || "",
        suffix: selection.suffix || "",
      }
      : null
    renderChatList()
    renderContextUi()
    renderMessages([])
    setStatus("")
    if (input instanceof HTMLTextAreaElement) input.focus()
  }

  function setStreaming(next) {
    streaming = next
    if (sendBtn instanceof HTMLButtonElement) sendBtn.disabled = next
    if (input instanceof HTMLTextAreaElement) input.disabled = next
  }

  function reloadHtmlFrame() {
    if (!(iframe instanceof HTMLIFrameElement)) return
    const src = iframe.src
    iframe.src = src
  }

  async function sendMessage(messageText) {
    if (streaming || !messageText.trim()) return
    setStreaming(true)
    setStatus("Repairing and verifying with Playwright...")

    const body = {
      file: filePath,
      message: messageText.trim(),
      threadId: activeThreadId,
    }
    if (!activeThreadId && bootstrapSelection) {
      body.contextQuote = bootstrapSelection.quote
      body.contextPrefix = bootstrapSelection.prefix
      body.contextSuffix = bootstrapSelection.suffix
    }

    const userMsg = { id: "local-user", role: "user", content: messageText.trim(), createdAt: new Date().toISOString() }
    const pending = (activeThreadId && messageCache.get(activeThreadId)) ? messageCache.get(activeThreadId).slice() : []
    pending.push(userMsg)
    const assistantMsg = { id: "local-assistant", role: "assistant", content: "", createdAt: new Date().toISOString() }
    pending.push(assistantMsg)
    renderMessages(pending)

    try {
      const resp = await fetch(apiBase + "/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify(body),
      })
      if (!resp.ok || !resp.body) {
        let detail = "repair failed"
        try {
          const err = await resp.json()
          if (err && err.message) detail = err.message
          if (err && err.code === "thread_stale") {
            setStatus("Session expired — start a new repair chat.", true)
            startNewChat()
            return
          }
        } catch {}
        throw new Error(detail)
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let assistantText = ""
      let donePayload = null

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split("\\n\\n")
        buffer = chunks.pop() || ""
        for (const chunk of chunks) {
          const lines = chunk.split("\\n")
          let eventName = "message"
          let dataLine = ""
          for (const line of lines) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim()
            if (line.startsWith("data:")) dataLine += line.slice(5).trim()
          }
          if (!dataLine) continue
          let data
          try { data = JSON.parse(dataLine) } catch { continue }
          if (eventName === "thread" && data.threadId) {
            activeThreadId = data.threadId
            if (!threads.some((t) => t.id === data.threadId)) {
              threads.unshift({
                id: data.threadId,
                updatedAt: new Date().toISOString(),
                firstUserPreview: messageText.trim(),
                lastMessagePreview: messageText.trim(),
                contextQuote: bootstrapSelection ? bootstrapSelection.quote : null,
              })
            }
            renderChatList()
            renderContextUi()
          }
          if (eventName === "delta" && data.text) {
            assistantText += data.text
            assistantMsg.content = assistantText
            const bodyEl = messagesEl && messagesEl.querySelector(".html-viewer-ask-message-assistant:last-child .html-viewer-ask-message-body")
            scheduleAssistantMarkdown(bodyEl, assistantText)
            if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight
          }
          if (eventName === "done") {
            donePayload = data
            assistantText = data.text || assistantText
            assistantMsg.content = assistantText
            assistantMsg.id = data.assistantMessageId || assistantMsg.id
            userMsg.id = data.userMessageId || userMsg.id
          }
          if (eventName === "error") {
            throw new Error(data.message || "repair failed")
          }
          if (eventName === "status" && data.phase === "running") {
            setStatus("Agent is fixing and verifying...")
          }
        }
      }

      if (activeThreadId) {
        messageCache.set(activeThreadId, pending.map((m) => ({ ...m })))
        const thread = threads.find((t) => t.id === activeThreadId)
        if (thread) {
          thread.lastMessagePreview = assistantText || messageText.trim()
          thread.updatedAt = new Date().toISOString()
        }
        renderChatList()
      }
      renderMessages(pending)
      setStatus("Repair complete. Reloading page…")
      if (!donePayload || donePayload.reloadHtml !== false) reloadHtmlFrame()
      bootstrapSelection = null
      renderContextUi()
      setStatus("Repair complete.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true)
    } finally {
      setStreaming(false)
      if (input instanceof HTMLTextAreaElement) {
        input.value = ""
        input.focus()
      }
    }
  }

  chatListEl?.addEventListener("click", (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const openBtn = target.closest("[data-repair-thread-id]")
    if (openBtn instanceof HTMLElement && openBtn.dataset.repairThreadId) {
      void selectChat(openBtn.dataset.repairThreadId)
      return
    }
    const deleteBtn = target.closest("[data-repair-delete-id]")
    if (deleteBtn instanceof HTMLElement && deleteBtn.dataset.repairDeleteId) {
      const id = deleteBtn.dataset.repairDeleteId
      void fetch(apiBase + "/threads/" + encodeURIComponent(id) + "?file=" + encodeURIComponent(filePath), {
        method: "DELETE",
      }).then((resp) => {
        if (!resp.ok) throw new Error("delete failed")
        threads = threads.filter((t) => t.id !== id)
        messageCache.delete(id)
        if (activeThreadId === id) startNewChat()
        else renderChatList()
      }).catch((error) => setStatus(error instanceof Error ? error.message : String(error), true))
    }
  })

  form?.addEventListener("submit", (event) => {
    event.preventDefault()
    if (!(input instanceof HTMLTextAreaElement)) return
    void sendMessage(input.value)
  })

  newChatBtn?.addEventListener("click", () => startNewChat())

  window.addEventListener("html-repair-open", (event) => {
    const detail = event && event.detail ? event.detail : null
    startNewChat(detail && detail.selection ? detail.selection : null)
    window.dispatchEvent(new CustomEvent("html-sidebar-open"))
    repairTab?.click()
    if (input instanceof HTMLTextAreaElement) input.focus()
  })

  renderChatList()
  renderContextUi()
  if (threads.length) {
    void selectChat(threads[0].id)
  } else {
    renderMessages([])
  }
})();
</script>`
