import type { HtmlReaderAskMessage, HtmlReaderAskThread } from "./html-ask-store"
import { escapeHtml } from "./utils"

export function askThreadsToJson(threads: HtmlReaderAskThread[]): string {
  return escapeHtml(JSON.stringify(threads))
}

export function askMessagesToJson(messages: HtmlReaderAskMessage[]): string {
  return escapeHtml(JSON.stringify(messages))
}

export const HTML_ASK_SCRIPT = /* html */ `
<script>
(function () {
  const root = document.querySelector("[data-html-ask-root]")
  if (!(root instanceof HTMLElement)) return

  const runName = root.dataset.runName || ""
  const filePath = root.dataset.file || ""
  const apiBase = "/runs/" + encodeURIComponent(runName) + "/html-ask"

  let threads = []
  try { threads = JSON.parse(root.dataset.threads || "[]") } catch { threads = [] }
  let highlights = []
  try { highlights = JSON.parse(root.dataset.highlights || "[]") } catch { highlights = [] }

  const shell = document.querySelector(".html-viewer-shell")
  const askTab = document.querySelector('[data-html-tab="ask"]')
  const askPanel = document.querySelector('[data-html-panel="ask"]')
  const chatListEl = document.querySelector("[data-html-ask-chat-list]")
  const bootstrapEl = document.querySelector("[data-html-ask-bootstrap]")
  const bootstrapSelect = document.querySelector("[data-html-ask-bootstrap-select]")
  const contextChipEl = document.querySelector("[data-html-ask-context]")
  const messagesEl = document.querySelector("[data-html-ask-messages]")
  const form = document.querySelector("[data-html-ask-form]")
  const input = document.querySelector("[data-html-ask-input]")
  const sendBtn = document.querySelector("[data-html-ask-send]")
  const newChatBtn = document.querySelector("[data-html-ask-new]")
  const statusEl = document.querySelector("[data-html-ask-status]")
  const sheetEl = document.querySelector("[data-html-ask-sheet]")

  let activeThreadId = null
  let bootstrapScope = "page"
  let bootstrapHighlightId = null
  let messageCache = new Map()
  let streaming = false

  function isMobile() {
    return window.matchMedia("(max-width: 860px)").matches
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  }

  function displayQuote(quote) {
    return String(quote || "").trim()
  }

  function truncate(text, max) {
    const trimmed = displayQuote(text)
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

  function highlightQuote(id) {
    const item = highlights.find((entry) => entry.id === id)
    return item ? displayQuote(item.quote) : "Highlight"
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

  function bootstrapLabel(thread) {
    if (thread.scope === "page") return "Page"
    return truncate(highlightQuote(thread.highlightId), 32)
  }

  function applyThreadBootstrap(thread) {
    if (!thread) {
      bootstrapScope = "page"
      bootstrapHighlightId = null
      return
    }
    bootstrapScope = thread.scope === "highlight" ? "highlight" : "page"
    bootstrapHighlightId = thread.scope === "highlight" ? (thread.highlightId || null) : null
  }

  function readBootstrapFromSelect() {
    if (!(bootstrapSelect instanceof HTMLSelectElement)) {
      bootstrapScope = "page"
      bootstrapHighlightId = null
      return
    }
    const value = bootstrapSelect.value
    if (value === "page") {
      bootstrapScope = "page"
      bootstrapHighlightId = null
      return
    }
    if (value.startsWith("highlight:")) {
      bootstrapScope = "highlight"
      bootstrapHighlightId = value.slice("highlight:".length) || null
      return
    }
    bootstrapScope = "page"
    bootstrapHighlightId = null
  }

  function syncBootstrapSelect() {
    if (!(bootstrapSelect instanceof HTMLSelectElement)) return
    bootstrapSelect.innerHTML = '<option value="page">Whole page</option>' +
      highlights.map((highlight) =>
        '<option value="highlight:' + escapeHtml(highlight.id) + '">' +
        escapeHtml(truncate(highlight.quote, 48)) + "</option>",
      ).join("")
    if (bootstrapScope === "highlight" && bootstrapHighlightId) {
      bootstrapSelect.value = "highlight:" + bootstrapHighlightId
    } else {
      bootstrapSelect.value = "page"
    }
  }

  function renderBootstrapUi() {
    const isNewChat = !activeThreadId
    if (bootstrapEl instanceof HTMLElement) bootstrapEl.hidden = !isNewChat
    if (contextChipEl instanceof HTMLElement) {
      contextChipEl.hidden = isNewChat
      if (!isNewChat) {
        const thread = threads.find((entry) => entry.id === activeThreadId)
        if (thread) {
          contextChipEl.textContent = thread.scope === "page"
            ? "Started from whole page"
            : 'Started from: "' + truncate(highlightQuote(thread.highlightId), 72) + '"'
        }
      }
    }
    if (isNewChat) syncBootstrapSelect()
  }

  function syncAskSheet(open) {
    if (!(sheetEl instanceof HTMLElement)) return
    if (!isMobile()) {
      sheetEl.hidden = true
      shell?.classList.remove("html-viewer-ask-sheet-open")
      return
    }
    const show = open && askPanel instanceof HTMLElement && !askPanel.hidden
    sheetEl.hidden = !show
    shell?.classList.toggle("html-viewer-ask-sheet-open", show)
  }

  askTab?.addEventListener("click", () => {
    startNewChat()
    setTimeout(() => syncAskSheet(true), 0)
  })

  window.addEventListener("resize", () => {
    syncAskSheet(askPanel instanceof HTMLElement && !askPanel.hidden)
  })

  function renderChatList() {
    if (!(chatListEl instanceof HTMLElement)) return
    const rows = ['<div class="html-viewer-ask-chat-list-header">Chats</div>']
    for (const thread of threads) {
      const active = thread.id === activeThreadId
      const label = truncate(thread.firstUserPreview || thread.lastMessagePreview || "New conversation", 56)
      rows.push(
        '<div class="html-viewer-ask-chat-row' + (active ? " html-viewer-ask-chat-row-active" : "") + '">' +
        '<button type="button" class="html-viewer-ask-chat-open" data-ask-thread-id="' + escapeHtml(thread.id) + '"' +
        (active ? ' aria-current="true"' : "") + ">" +
        (active ? '<span class="html-viewer-ask-chat-selected">Selected</span>' : "") +
        '<span class="html-viewer-ask-chat-title">' + escapeHtml(label) + "</span>" +
        '<span class="html-viewer-ask-chat-meta">' +
        '<span class="html-viewer-ask-chat-badge">' + escapeHtml(bootstrapLabel(thread)) + "</span> " +
        escapeHtml(formatRelative(thread.updatedAt)) +
        "</span></button>" +
        '<button type="button" class="html-viewer-ask-chat-delete" data-ask-delete-id="' + escapeHtml(thread.id) + '" aria-label="Delete chat">×</button>' +
        "</div>",
      )
    }
    if (!threads.length) {
      rows.push('<p class="html-viewer-ask-empty muted-text">No chats yet.</p>')
    }
    chatListEl.innerHTML = rows.join("")
  }

  function renderMessages(messages) {
    if (!(messagesEl instanceof HTMLElement)) return
    if (!messages.length) {
      messagesEl.innerHTML = '<p class="html-viewer-ask-empty muted-text">Ask a question about this document.</p>'
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
    applyThreadBootstrap(threads.find((entry) => entry.id === threadId))
    renderChatList()
    renderBootstrapUi()
    await loadMessages(threadId)
  }

  function startNewChat(options) {
    activeThreadId = null
    bootstrapScope = options?.scope || "page"
    bootstrapHighlightId = options?.highlightId || null
    renderChatList()
    renderBootstrapUi()
    renderMessages([])
    setStatus("", false)
  }

  async function refreshThreadsFromServer() {
    try {
      const resp = await fetch(apiBase + "/threads?file=" + encodeURIComponent(filePath))
      if (!resp.ok) return
      const data = await resp.json()
      threads = Array.isArray(data.threads) ? data.threads : []
      if (activeThreadId && !threads.some((thread) => thread.id === activeThreadId)) {
        startNewChat()
        return
      }
      renderChatList()
      renderBootstrapUi()
    } catch {}
  }

  function rollbackOptimisticSend(previousMessages, savedMessage, assistantEl) {
    renderMessages(previousMessages)
    if (input instanceof HTMLTextAreaElement) input.value = savedMessage
    if (assistantEl instanceof HTMLElement) assistantEl.remove()
  }

  async function deleteChat(threadId) {
    let deleted = false
    try {
      const resp = await fetch(
        apiBase + "/threads/" + encodeURIComponent(threadId) + "?file=" + encodeURIComponent(filePath),
        { method: "DELETE" },
      )
      deleted = resp.ok
    } catch {}
    if (!deleted) {
      setStatus("Could not delete chat.", true)
      await refreshThreadsFromServer()
      return
    }
    messageCache.delete(threadId)
    if (activeThreadId === threadId) {
      activeThreadId = null
    }
    await refreshThreadsFromServer()
    if (!activeThreadId) {
      startNewChat()
    }
  }

  function parseSseChunk(buffer, handler) {
    const parts = buffer.split("\\n\\n")
    const rest = parts.pop() || ""
    for (const part of parts) {
      if (!part.trim()) continue
      let eventName = "message"
      let dataLine = ""
      for (const line of part.split("\\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim()
        if (line.startsWith("data:")) dataLine = line.slice(5).trim()
      }
      if (dataLine) {
        try { handler(eventName, JSON.parse(dataLine)) } catch {}
      }
    }
    return rest
  }

  async function sendMessage() {
    if (!(input instanceof HTMLTextAreaElement) || !(sendBtn instanceof HTMLButtonElement)) return
    const message = input.value.trim()
    if (!message || streaming) return

    if (!activeThreadId) readBootstrapFromSelect()

    streaming = true
    sendBtn.disabled = true
    setStatus("Thinking...", false)

    const payload = {
      file: filePath,
      threadId: activeThreadId,
      message,
    }
    if (!activeThreadId) {
      payload.scope = bootstrapScope
      payload.highlightId = bootstrapHighlightId
    }

    const savedMessage = message
    const userBubble = { role: "user", content: savedMessage }
    const previousMessages = activeThreadId ? (messageCache.get(activeThreadId) || []).slice() : []
    renderMessages([...previousMessages, userBubble])
    input.value = ""

    let assistantText = ""
    let assistantEl = null
    let sendCommitted = false
    if (messagesEl instanceof HTMLElement) {
      assistantEl = document.createElement("div")
      assistantEl.className = "html-viewer-ask-message html-viewer-ask-message-assistant"
      assistantEl.innerHTML = '<div class="html-viewer-ask-message-body md-content"></div>'
      messagesEl.appendChild(assistantEl)
    }
    const assistantBody = assistantEl?.querySelector(".html-viewer-ask-message-body")

    try {
      const resp = await fetch(apiBase + "/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify(payload),
      })

      if (resp.status === 409) {
        rollbackOptimisticSend(previousMessages, savedMessage, assistantEl)
        setStatus("Already waiting for a reply on this thread.", true)
        return
      }
      if (resp.status === 410) {
        rollbackOptimisticSend(previousMessages, savedMessage, assistantEl)
        setStatus("Conversation expired. Delete and start a new chat.", true)
        return
      }
      if (resp.status === 404) {
        rollbackOptimisticSend(previousMessages, savedMessage, assistantEl)
        let errorMessage = "Highlight not found."
        try {
          const data = await resp.json()
          if (data && typeof data.message === "string") errorMessage = data.message
        } catch {}
        setStatus(errorMessage, true)
        await refreshThreadsFromServer()
        return
      }
      if (!resp.ok || !resp.body) {
        rollbackOptimisticSend(previousMessages, savedMessage, assistantEl)
        throw new Error("request failed")
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        buffer = parseSseChunk(buffer, (eventName, data) => {
          if (eventName === "thread") {
            activeThreadId = data.threadId
            if (data.created) {
              threads.unshift({
                id: data.threadId,
                scope: data.scope,
                highlightId: data.highlightId || null,
                firstUserPreview: savedMessage,
                updatedAt: new Date().toISOString(),
              })
            }
            renderChatList()
            renderBootstrapUi()
          }
          if (eventName === "delta" && data.text && assistantBody) {
            assistantText += data.text
            scheduleAssistantMarkdown(assistantBody, assistantText)
            if (messagesEl instanceof HTMLElement) messagesEl.scrollTop = messagesEl.scrollHeight
          }
          if (eventName === "error") {
            if (!sendCommitted) {
              rollbackOptimisticSend(previousMessages, savedMessage, assistantEl)
              void refreshThreadsFromServer()
            }
            setStatus(data.message || "Something went wrong.", true)
          }
          if (eventName === "done") {
            sendCommitted = true
            if (assistantBody) {
              cancelAnimationFrame(markdownRenderFrame)
              assistantBody.innerHTML = renderMarkdownHtml(data.text || assistantText)
            }
            const messages = (messageCache.get(activeThreadId) || previousMessages).slice()
            messages.push(userBubble)
            messages.push({ role: "assistant", content: data.text || assistantText })
            messageCache.set(activeThreadId, messages)
            const thread = threads.find((entry) => entry.id === activeThreadId)
            if (thread) {
              thread.firstUserPreview = thread.firstUserPreview || savedMessage
              thread.lastMessagePreview = data.text || assistantText
              thread.updatedAt = new Date().toISOString()
              threads.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
            }
            renderChatList()
            setStatus("", false)
          }
        })
      }
      if (!sendCommitted) {
        rollbackOptimisticSend(previousMessages, savedMessage, assistantEl)
        await refreshThreadsFromServer()
      }
    } catch {
      rollbackOptimisticSend(previousMessages, savedMessage, assistantEl)
      setStatus("Failed to send message.", true)
      await refreshThreadsFromServer()
    } finally {
      streaming = false
      sendBtn.disabled = false
    }
  }

  chatListEl?.addEventListener("click", (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const deleteBtn = target.closest("[data-ask-delete-id]")
    if (deleteBtn instanceof HTMLElement && deleteBtn.dataset.askDeleteId) {
      void deleteChat(deleteBtn.dataset.askDeleteId)
      return
    }
    const openBtn = target.closest("[data-ask-thread-id]")
    if (openBtn instanceof HTMLElement && openBtn.dataset.askThreadId) {
      void selectChat(openBtn.dataset.askThreadId)
    }
  })

  bootstrapSelect?.addEventListener("change", () => readBootstrapFromSelect())

  form?.addEventListener("submit", (event) => {
    event.preventDefault()
    void sendMessage()
  })
  newChatBtn?.addEventListener("click", () => startNewChat())

  window.addEventListener("html-ask-open", (event) => {
    const detail = event.detail || {}
    if (activeThreadId) {
      setStatus("Start a new chat before asking about a different highlight.", true)
      return
    }
    startNewChat({
      scope: "highlight",
      highlightId: detail.highlightId || null,
    })
  })

  window.addEventListener("html-highlights-changed", (event) => {
    const detail = event.detail || {}
    if (Array.isArray(detail.highlights)) {
      highlights = detail.highlights
      if (!activeThreadId) syncBootstrapSelect()
    }
  })

  startNewChat()
  void refreshThreadsFromServer()

  syncAskSheet(askPanel instanceof HTMLElement && !askPanel.hidden)
})();
</script>`
