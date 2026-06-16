import type { ChatMessage } from '../types'

const CHAT_KEY = 'clarity-chat-history-v1'

export function loadChatHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    return raw ? (JSON.parse(raw) as ChatMessage[]) : []
  } catch {
    return []
  }
}

export function saveChatHistory(messages: ChatMessage[]) {
  // Keep last 200 messages
  const trimmed = messages.slice(-200)
  localStorage.setItem(CHAT_KEY, JSON.stringify(trimmed))
}

export function clearChatHistory() {
  localStorage.removeItem(CHAT_KEY)
}

export function appendChatMessage(msg: ChatMessage) {
  const history = loadChatHistory()
  saveChatHistory([...history, msg])
}
