import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  addChat,
  appendMessageToLiveChat,
  deleteChat,
  getActiveChat,
  loadActiveChatId,
  loadChatStore,
  markNotified,
  migrateFromLegacy,
  saveActiveChatId,
  updateChatLabel,
  upsertLiveChat,
  type ChatRecord,
} from '../lib/chatStore'
import { extractCommitmentsFromText, loadCommitments, reconcileStatuses, saveCommitments } from '../lib/commitments'
import { loadNotificationPrefs } from '../lib/notificationPrefs'
import type { Commitment } from '../types'
import type { WhatsAppMessage } from '../lib/whatsappImport'

interface LiveChatData {
  chatId: string
  chatName: string
  isGroup: boolean
  messages: { id: string; author: string; text: string; timestamp: number }[]
  plainText: string
  participants: string[]
}

interface ChatContextValue {
  chats: Record<string, ChatRecord>
  activeChat: ChatRecord | null
  activeId: string | null
  setActiveId: (id: string) => void
  importChat: (label: string, messages: WhatsAppMessage[], plainText: string, commitments?: Commitment[]) => ChatRecord
  /** Batch-import all live WhatsApp chats (from linked bridge) */
  importLiveChats: (liveChats: LiveChatData[]) => void
  /** Append a single new live message to an existing live chat */
  appendLiveMessage: (liveId: string, author: string, text: string, timestamp: number, msgId?: string) => void
  renameChat: (id: string, label: string) => void
  removeChat: (id: string) => void
  hasChatContext: boolean
  /** Commitments that belong ONLY to the active chat */
  chatCommitments: Commitment[]
  allCommitments: Commitment[]
  refreshCommitments: () => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function ChatProvider({ children }: { children: ReactNode }) {
  const [chats, setChats] = useState<Record<string, ChatRecord>>(() => {
    migrateFromLegacy()
    return loadChatStore()
  })
  const [activeId, setActiveIdState] = useState<string | null>(() => {
    const stored = loadActiveChatId()
    const store = loadChatStore()
    if (stored && store[stored]) return stored
    const first = Object.keys(store)[0] ?? null
    if (first) saveActiveChatId(first)
    return first
  })
  const [allCommitments, setAllCommitments] = useState<Commitment[]>(() =>
    reconcileStatuses(loadCommitments()),
  )

  const activeChat = useMemo(
    () => (activeId && chats[activeId] ? chats[activeId] : getActiveChat()),
    [activeId, chats],
  )

  // Strictly match ONLY this chat's commitments — by chat ID tag or label+source
  const chatCommitments = useMemo(() => {
    if (!activeChat) return []
    const label = activeChat.label.toLowerCase()
    const chatIdTag = `chat:${activeChat.id}`
    return allCommitments.filter((c) => {
      // Exact chat ID tag (set on import)
      if (c.tags.includes(chatIdTag)) return true
      // Label match in tags (e.g. "shaurya")
      if (c.tags.some((t) => t.toLowerCase() === label)) return true
      // Source contains this chat's label specifically
      if (c.source.toLowerCase().includes(label) && c.tags.includes('whatsapp')) return true
      return false
    })
  }, [activeChat, allCommitments])

  function setActiveId(id: string) {
    setActiveIdState(id)
    saveActiveChatId(id)
  }

  function importChat(
    label: string,
    messages: WhatsAppMessage[],
    plainText: string,
    commitments?: Commitment[],
  ): ChatRecord {
    const record = addChat(label, messages, plainText)
    setChats(loadChatStore())
    setActiveId(record.id)

    {
      // Use server-provided commitments if available, otherwise run rule-based extraction
      const rawCommitments = commitments?.length
        ? commitments
        : extractCommitmentsFromText(plainText, label)

      const tagged = rawCommitments.map((c) => ({
        ...c,
        tags: Array.from(new Set([...c.tags, `chat:${record.id}`, label.toLowerCase(), 'whatsapp'])),
        source: `${label} (WhatsApp)`,
      }))

      // Remove old commitments from this label, add fresh ones
      const existing = reconcileStatuses(loadCommitments()).filter(
        (c) => !c.tags.includes(`chat:${record.id}`) && !c.source.startsWith(`${label} (WhatsApp)`),
      )
      const merged = [...tagged, ...existing]
      saveCommitments(merged)
      setAllCommitments(reconcileStatuses(merged))

      // Always trigger notifications after import
      if (tagged.length) {
        triggerImportNotifications(record.label, tagged)
      }
    }

    return record
  }

  function importLiveChats(liveChats: LiveChatData[]) {
    for (const lc of liveChats) {
      const messages: WhatsAppMessage[] = lc.messages.map((m) => {
        const dateObj = new Date(m.timestamp)
        const validDate = Number.isNaN(dateObj.getTime()) ? null : dateObj
        return {
          id: m.id,
          author: m.author,
          text: m.text,
          rawHeader: validDate ? dateObj.toISOString() : '',
          timestamp: validDate ? dateObj.toISOString() : null,
          date: validDate ? `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getFullYear()}` : '',
          time: validDate ? `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}` : '',
        }
      })

      const record = upsertLiveChat(lc.chatId, lc.chatName, messages, lc.plainText)

      // Extract + merge commitments for this chat
      const rawCommitments = extractCommitmentsFromText(lc.plainText, lc.chatName)
      const tagged = rawCommitments.map((c) => ({
        ...c,
        tags: Array.from(new Set([...c.tags, `chat:${record.id}`, lc.chatName.toLowerCase(), 'whatsapp', 'live'])),
        source: `${lc.chatName} (WhatsApp Live)`,
      }))

      if (tagged.length > 0) {
        const existing = reconcileStatuses(loadCommitments()).filter(
          (c) => !c.tags.includes(`chat:${record.id}`),
        )
        const merged = [...tagged, ...existing]
        saveCommitments(merged)
        setAllCommitments(reconcileStatuses(merged))
        triggerImportNotifications(lc.chatName, tagged)
      }
    }
    setChats(loadChatStore())
  }

  function appendLiveMessage(liveId: string, author: string, text: string, timestamp: number, msgId?: string) {
    const dateObj = new Date(timestamp)
    const msg: WhatsAppMessage = {
      id: msgId || `live-${Date.now()}`,
      author,
      text,
      rawHeader: dateObj.toISOString(),
      timestamp: dateObj.toISOString(),
      date: `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getFullYear()}`,
      time: `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`,
    }

    const updated = appendMessageToLiveChat(liveId, msg)
    if (!updated) return
    setChats(loadChatStore())

    // Check for new commitment in the new message
    const newCommitment = extractCommitmentsFromText(text, author)
    if (newCommitment.length > 0) {
      const tagged = newCommitment.map((c) => ({
        ...c,
        tags: Array.from(new Set([...c.tags, `chat:${updated.id}`, updated.label.toLowerCase(), 'whatsapp', 'live'])),
        source: `${updated.label} (WhatsApp Live)`,
      }))
      const existing = reconcileStatuses(loadCommitments()).filter(
        (c) => !tagged.some((t) => t.text === c.text && c.tags.includes(`chat:${updated.id}`)),
      )
      const merged = [...tagged, ...existing]
      saveCommitments(merged)
      setAllCommitments(reconcileStatuses(merged))
      triggerImportNotifications(updated.label, tagged)
    }
  }

  function renameChat(id: string, label: string) {
    updateChatLabel(id, label)
    setChats(loadChatStore())
  }

  function removeChat(id: string) {
    // Also remove all commitments tagged to this chat
    const chatIdTag = `chat:${id}`
    const cleaned = reconcileStatuses(loadCommitments()).filter(
      (c) => !c.tags.includes(chatIdTag),
    )
    saveCommitments(cleaned)
    setAllCommitments(cleaned)

    deleteChat(id)
    const updated = loadChatStore()
    setChats(updated)
    if (activeId === id) {
      const next = Object.keys(updated)[0] ?? null
      setActiveIdState(next)
      if (next) saveActiveChatId(next)
    }
  }

  function refreshCommitments() {
    setAllCommitments(reconcileStatuses(loadCommitments()))
  }

  const hasChatContext = Object.keys(chats).length > 0

  // Poll commitments every 60s
  useEffect(() => {
    const id = setInterval(() => {
      setAllCommitments(reconcileStatuses(loadCommitments()))
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  // Auto-notify when active chat changes or commitments update
  useChatNotifications(activeChat, chatCommitments)

  const value: ChatContextValue = {
    chats,
    activeChat,
    activeId,
    setActiveId,
    importChat,
    importLiveChats,
    appendLiveMessage,
    renameChat,
    removeChat,
    hasChatContext,
    chatCommitments,
    allCommitments,
    refreshCommitments,
  }

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChatContext() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChatContext must be used inside ChatProvider')
  return ctx
}

// ─── Fire notifications when chat is imported ─────────────────────────────────

function fireImportNotifications(label: string, commitments: Commitment[]) {
  console.log('[VAC] fireImportNotifications — permission:', Notification.permission, 'commitments:', commitments.length)

  const prefs = loadNotificationPrefs()
  const overdue = commitments.filter((c) => c.status === 'overdue')
  const pending = commitments.filter((c) => c.status === 'pending' || c.status === 'in-progress')

  console.log('[VAC] overdue:', overdue.length, 'pending:', pending.length, 'prefs:', prefs)

  // Always fire import summary (not gated by per-type prefs)
  const total = overdue.length + pending.length
  if (total > 0) {
    try {
      new Notification(`VAC — ${label} imported`, {
        body: `Found ${total} commitment${total > 1 ? 's' : ''}${overdue.length ? ` · ${overdue.length} overdue` : ''}`,
        icon: '/favicon.ico',
        requireInteraction: false,
        tag: `vac-import-${label}`,
      })
      console.log('[VAC] Fired import summary notification')
    } catch (e) {
      console.error('[VAC] Notification error:', e)
    }
  }

  // Overdue details — fire immediately after 500ms
  if (overdue.length) {
    setTimeout(() => {
      try {
        new Notification(`VAC — ${overdue.length} overdue in "${label}"`, {
          body: overdue.slice(0, 3).map((c) => `• ${c.text.slice(0, 70)}`).join('\n'),
          icon: '/favicon.ico',
          requireInteraction: false,
          tag: `vac-overdue-${label}`,
        })
        console.log('[VAC] Fired overdue notification')
      } catch (e) {
        console.error('[VAC] Overdue notification error:', e)
      }
    }, 500)
  }

  // Pending details — fire 2s after overdue
  if (pending.length) {
    setTimeout(() => {
      try {
        new Notification(`VAC — ${pending.length} pending in "${label}"`, {
          body: pending.slice(0, 3).map((c) => `• ${c.text.slice(0, 70)}`).join('\n'),
          icon: '/favicon.ico',
          requireInteraction: false,
          tag: `vac-pending-${label}`,
        })
        console.log('[VAC] Fired pending notification')
      } catch (e) {
        console.error('[VAC] Pending notification error:', e)
      }
    }, 2000)
  }
}

function triggerImportNotifications(label: string, commitments: Commitment[]) {
  console.log('[VAC] triggerImportNotifications called, permission:', typeof Notification !== 'undefined' ? Notification.permission : 'N/A')

  if (typeof Notification === 'undefined') {
    console.warn('[VAC] Notifications not supported')
    return
  }

  if (Notification.permission === 'granted') {
    fireImportNotifications(label, commitments)
    return
  }

  if (Notification.permission === 'default') {
    // Request permission first, then fire
    Notification.requestPermission().then((perm) => {
      console.log('[VAC] Permission result:', perm)
      if (perm === 'granted') {
        fireImportNotifications(label, commitments)
      }
    })
  }
  // If 'denied', silently skip
}

// ─── Auto-notify when due/overdue commitments exist for active chat ───────────

function useChatNotifications(
  activeChat: ChatRecord | null,
  chatCommitments: Commitment[],
) {
  const lastCheckRef = useRef<string>('')

  useEffect(() => {
    if (!activeChat) return
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'granted') return
    const prefs = loadNotificationPrefs()
    if (!prefs.masterEnabled) return

    const chatKey = `${activeChat.id}:${chatCommitments.length}`
    if (chatKey === lastCheckRef.current) return
    lastCheckRef.current = chatKey

    const now = new Date()
    const toNotify = chatCommitments.filter((c) => {
      if (c.status === 'completed') return false
      if (activeChat.notifiedIds.includes(c.id)) return false
      if (c.status === 'overdue') return prefs.notifyOverdue
      try {
        const due = new Date(`${c.dueDate}T${c.dueTime}:00`)
        const msUntilDue = due.getTime() - now.getTime()
        return prefs.notifyPending && msUntilDue <= c.notifyBefore * 60 * 1000
      } catch {
        return false
      }
    })

    if (!toNotify.length) return

    const overdueNow = toNotify.filter((c) => c.status === 'overdue')
    const dueNow = toNotify.filter((c) => c.status !== 'overdue')

    if (overdueNow.length) {
      new Notification(`⚠️ Clarity — ${activeChat.label}`, {
        body: overdueNow.length === 1
          ? `Overdue: "${overdueNow[0].text.slice(0, 80)}"`
          : `${overdueNow.length} overdue commitments from ${activeChat.label}`,
        icon: '/favicon.ico',
        tag: `clarity-overdue-${activeChat.id}`,
      })
    }
    if (dueNow.length) {
      new Notification(`🔔 Clarity — ${activeChat.label}`, {
        body: dueNow.length === 1
          ? `Due soon: "${dueNow[0].text.slice(0, 80)}"`
          : `${dueNow.length} commitments due soon from ${activeChat.label}`,
        icon: '/favicon.ico',
        tag: `clarity-pending-${activeChat.id}`,
      })
    }

    markNotified(activeChat.id, toNotify.map((c) => c.id))
  }, [activeChat, chatCommitments])
}
