/**
 * Multi-chat store — keeps multiple WhatsApp conversations in localStorage.
 * Each chat has a user-given label (e.g. "Mom", "Work Group", "John").
 */
import type { WhatsAppMessage } from './whatsappImport'

export interface ChatRecord {
  id: string
  label: string
  messages: WhatsAppMessage[]
  plainText: string
  participants: string[]
  importedAt: string
  /** commitments already auto-notified so we don't spam */
  notifiedIds: string[]
  /** WhatsApp live chat ID (e.g. "628xxx@c.us") — set when loaded from live bridge */
  liveId?: string
  /** 'file' = imported .txt export, 'live' = linked WhatsApp */
  source?: 'file' | 'live'
}

const STORE_KEY = 'clarity-chat-store-v1'
const ACTIVE_KEY = 'clarity-chat-active-v1'

function timestampValue(timestamp: string | null) {
  if (!timestamp) return 0
  const ms = Date.parse(timestamp)
  return Number.isNaN(ms) ? 0 : ms
}

// ─── Persistence ─────────────────────────────────────────────────────────────

export function loadChatStore(): Record<string, ChatRecord> {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, ChatRecord>) : {}
  } catch {
    return {}
  }
}

export function saveChatStore(store: Record<string, ChatRecord>) {
  try {
    // Trim messages to avoid localStorage quota errors (WhatsApp chats can be huge)
    const trimmed: Record<string, ChatRecord> = {}
    for (const [k, v] of Object.entries(store)) {
      trimmed[k] = {
        ...v,
        messages: Array.isArray(v.messages) ? v.messages.slice(-100) : v.messages,
      }
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(trimmed))
  } catch (e) {
    // QuotaExceededError — save a minimal version (just IDs + labels)
    try {
      const minimal: Record<string, Partial<ChatRecord>> = {}
      for (const [k, v] of Object.entries(store)) {
        minimal[k] = { label: v.label, notifiedIds: v.notifiedIds }
      }
      localStorage.setItem(STORE_KEY, JSON.stringify(minimal))
    } catch (_) { /* give up silently */ }
  }
}

export function loadActiveChatId(): string | null {
  return localStorage.getItem(ACTIVE_KEY)
}

export function saveActiveChatId(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_KEY, id)
  else localStorage.removeItem(ACTIVE_KEY)
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function addChat(
  label: string,
  messages: WhatsAppMessage[],
  plainText: string,
): ChatRecord {
  const store = loadChatStore()
  const participants = Array.from(new Set(messages.map((m) => m.author)))
  const record: ChatRecord = {
    id: crypto.randomUUID(),
    label: label.trim() || participants[0] || 'Chat',
    messages,
    plainText,
    participants,
    importedAt: new Date().toISOString(),
    notifiedIds: [],
  }
  store[record.id] = record
  saveChatStore(store)
  return record
}

/**
 * Create or update a live-bridge chat record, keyed by liveId.
 * If a record with this liveId already exists it is updated in-place
 * (messages replaced, plainText refreshed) — no duplicates.
 */
export function upsertLiveChat(
  liveId: string,
  label: string,
  messages: WhatsAppMessage[],
  plainText: string,
): ChatRecord {
  const store = loadChatStore()
  const existing = Object.values(store).find((c) => c.liveId === liveId)

  if (existing) {
    // Merge: keep any newer messages that aren't already stored
    const existingIds = new Set(existing.messages.map((m) => m.id))
    const newMsgs = messages.filter((m) => !existingIds.has(m.id))
    const merged = [...existing.messages, ...newMsgs].sort(
      (a, b) => timestampValue(a.timestamp) - timestampValue(b.timestamp),
    )
    const participants = Array.from(new Set(merged.map((m) => m.author)))
    const updatedPlain = merged
      .map((m) => {
        if (!m.timestamp) return `${m.author}: ${m.text}`
        const d = new Date(m.timestamp)
        const date = `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()}`
        const time = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
        return `${date}, ${time} - ${m.author}: ${m.text}`
      })
      .join('\n')
    const updated = { ...existing, messages: merged, plainText: updatedPlain, participants }
    store[existing.id] = updated
    saveChatStore(store)
    return updated
  }

  const participants = Array.from(new Set(messages.map((m) => m.author)))
  const record: ChatRecord = {
    id: crypto.randomUUID(),
    label: label.trim() || participants[0] || 'Chat',
    messages,
    plainText,
    participants,
    importedAt: new Date().toISOString(),
    notifiedIds: [],
    liveId,
    source: 'live',
  }
  store[record.id] = record
  saveChatStore(store)
  return record
}

/**
 * Append a single live message to a chat identified by liveId.
 * Returns the updated record or null if not found.
 */
export function appendMessageToLiveChat(
  liveId: string,
  message: WhatsAppMessage,
): ChatRecord | null {
  const store = loadChatStore()
  const record = Object.values(store).find((c) => c.liveId === liveId)
  if (!record) return null

  // Avoid duplicates
  if (record.messages.some((m) => m.id === message.id)) return record

  const d = new Date(message.timestamp ?? Date.now())
  const date = `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()}`
  const time = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
  const line = `${date}, ${time} - ${message.author}: ${message.text}`

  const updated: ChatRecord = {
    ...record,
    messages: [...record.messages, message],
    plainText: record.plainText + '\n' + line,
    participants: Array.from(new Set([...record.participants, message.author])),
  }
  store[record.id] = updated
  saveChatStore(store)
  return updated
}

export function updateChatLabel(id: string, label: string) {
  const store = loadChatStore()
  if (store[id]) {
    store[id] = { ...store[id], label }
    saveChatStore(store)
  }
}

export function deleteChat(id: string) {
  const store = loadChatStore()
  delete store[id]
  saveChatStore(store)
  const activeId = loadActiveChatId()
  if (activeId === id) {
    const remaining = Object.keys(store)
    saveActiveChatId(remaining[0] ?? null)
  }
}

export function getActiveChat(): ChatRecord | null {
  const store = loadChatStore()
  const id = loadActiveChatId()
  if (id && store[id]) return store[id]
  // fall back to most recent
  const chats = Object.values(store).sort(
    (a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime(),
  )
  return chats[0] ?? null
}

export function markNotified(chatId: string, commitmentIds: string[]) {
  const store = loadChatStore()
  if (store[chatId]) {
    const existing = new Set(store[chatId].notifiedIds)
    commitmentIds.forEach((id) => existing.add(id))
    store[chatId] = { ...store[chatId], notifiedIds: Array.from(existing) }
    saveChatStore(store)
  }
}

// ─── Legacy migration ─────────────────────────────────────────────────────────
// If user had a single chat loaded under old keys, pull it in.

export function migrateFromLegacy() {
  const store = loadChatStore()
  if (Object.keys(store).length > 0) return // already migrated

  try {
    const raw = localStorage.getItem('clarity-wa-messages-v1')
    const ctx = localStorage.getItem('clarity-wa-context-v1')
    if (!raw || !ctx) return
    const messages = JSON.parse(raw) as WhatsAppMessage[]
    if (!messages.length) return
    const chat = addChat(messages[0]?.author ?? 'Imported Chat', messages, ctx)
    saveActiveChatId(chat.id)
  } catch {
    /* ignore */
  }
}
