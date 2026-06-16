/**
 * LiveChat — VAC WhatsApp Live Bridge
 * Connects to the local WhatsApp bridge via SSE for real-time messages,
 * analysis, and suggestions. Supports auto-reply and manual send.
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useChatContext } from '../context/ChatContext'
import { KeyboardComposer, type KeyboardAssistPayload } from '../components/live/KeyboardComposer'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BridgeStatus {
  status: 'disconnected' | 'qr_pending' | 'connecting' | 'ready' | 'auth_failure' | 'reconnecting' | 'reconnect_failed'
  qrDataUrl?: string | null
  info?: { name: string; phone: string } | null
}

interface LiveMessage {
  id: string
  chat_id: string
  chat_name: string
  sender: string
  message: string
  timestamp: number
  direction: 'in' | 'out'
  analysis?: Analysis
  suggestion?: string
  replyId?: string
  feedbackGiven?: 'good' | 'neutral' | 'bad'
}

interface Analysis {
  tone_analysis?: { dominant: string; scores: Record<string, number> }
  emotion?: string
  psychological_state?: string
  commitment_detected?: boolean
  commitment_score?: number
  subtext?: string
  urgency_level?: string
  suggested_reply?: string
  confidence?: number
  method?: string
  explanation?: {
    summary?: string
    intent?: string
    tone_read?: string
    context_used?: string
    style_notes?: string[]
    recipient_style_read?: string
    confidenceScore?: number
  }
}

interface WaConfig {
  autoReply: boolean
  replyDelay: { min: number; max: number }
  ignoredChats: string[]
  allowedChats: string[]
  maxQueuePerChat: number
}

interface ChatSummary {
  chatId: string
  senderName: string | null
  lastSeen: number | null
  messageCount: number
  replyCount: number
}

// ── Tone bar colours ──────────────────────────────────────────────────────────

const TONE_COLORS: Record<string, string> = {
  stress:      '#ef4444',
  anger:       '#dc2626',
  urgency:     '#f97316',
  enthusiasm:  '#22c55e',
  politeness:  '#3b82f6',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(ts: number) {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}

function statusLabel(s: BridgeStatus['status']) {
  return {
    disconnected: 'Disconnected',
    qr_pending:   'Scan QR code',
    connecting:   'Connecting…',
    reconnecting: 'Reconnecting…',
    reconnect_failed: 'Reconnect failed',
    ready:        'Connected',
    auth_failure: 'Auth failed',
  }[s] ?? s
}

function statusDot(s: BridgeStatus['status']) {
  if (s === 'ready') return 'bg-green-500'
  if (s === 'connecting' || s === 'qr_pending' || s === 'reconnecting') return 'bg-yellow-400'
  return 'bg-red-500'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ToneBar({ label, value }: { label: string; value: number }) {
  const color = TONE_COLORS[label] ?? 'hsl(var(--muted-foreground))'
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'hsl(var(--muted-foreground))', marginBottom: 2 }}>
        <span style={{ textTransform: 'capitalize' }}>{label}</span>
        <span>{value}</span>
      </div>
      <div style={{ height: 4, background: '#f0f0f0', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: 2, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  )
}

function AnalysisPanel({ analysis }: { analysis: Analysis }) {
  const scores = analysis.tone_analysis?.scores ?? {}
  const urgencyColors: Record<string, string> = { low: '#22c55e', medium: '#f97316', high: '#ef4444', critical: '#7f1d1d' }
  return (
    <div style={{ padding: '12px 14px', background: 'hsl(var(--secondary))', border: '1px solid hsl(var(--border))', borderRadius: 8, marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {analysis.emotion && (
          <span style={{ fontSize: 11, padding: '2px 8px', background: '#fff', border: '1px solid hsl(var(--border))', borderRadius: 20 }}>
            {analysis.emotion}
          </span>
        )}
        {analysis.urgency_level && (
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: urgencyColors[analysis.urgency_level] ?? 'hsl(var(--muted-foreground))', color: 'hsl(var(--background))' }}>
            {analysis.urgency_level} urgency
          </span>
        )}
        {analysis.commitment_detected && (
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' }}>
            commitment
          </span>
        )}
        {analysis.confidence != null && (
          <span style={{ fontSize: 11, padding: '2px 8px', background: '#fff', border: '1px solid hsl(var(--border))', borderRadius: 20, color: 'hsl(var(--muted-foreground))' }}>
            {Math.round(analysis.confidence * 100)}% confidence
          </span>
        )}
      </div>
      {Object.entries(scores).map(([k, v]) => (
        <ToneBar key={k} label={k} value={Number(v)} />
      ))}
      {analysis.psychological_state && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
          <strong style={{ color: 'hsl(var(--foreground))' }}>State: </strong>{analysis.psychological_state}
        </p>
      )}
      {analysis.subtext && (
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
          <strong style={{ color: 'hsl(var(--foreground))' }}>Subtext: </strong>{analysis.subtext}
        </p>
      )}
      {analysis.method && (
        <p style={{ margin: '4px 0 0', fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>via {analysis.method}</p>
      )}
    </div>
  )
}

function MessageBubble({
  msg,
  onSendSuggestion,
  onRate,
}: {
  msg: LiveMessage
  onSendSuggestion: (chatId: string, text: string, replyId?: string) => void
  onRate: (msgId: string, chatId: string, replyId: string, rating: 'good' | 'neutral' | 'bad') => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [explExpanded, setExplExpanded] = useState(false)
  const isOut = msg.direction === 'out'

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Bubble */}
      <div style={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start' }}>
        <div
          style={{
            maxWidth: '72%',
            padding: '10px 14px',
            background: isOut ? 'hsl(var(--foreground))' : '#fff',
            color: isOut ? '#fff' : 'hsl(var(--foreground))',
            border: isOut ? 'none' : '1px solid #e5e5e5',
            borderRadius: isOut ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
            fontSize: 14,
            lineHeight: '1.5',
          }}
        >
          {!isOut && (
            <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 600, color: isOut ? '#e0e0e0' : 'hsl(var(--muted-foreground))' }}>
              {msg.sender}
            </p>
          )}
          <p style={{ margin: 0 }}>{msg.message}</p>
          <p style={{ margin: '4px 0 0', fontSize: 10, opacity: 0.6, textAlign: 'right' }}>
            {relTime(msg.timestamp)}
          </p>
        </div>
      </div>

      {/* Analysis toggle (inbound only) */}
      {msg.analysis && !isOut && (
        <div style={{ marginTop: 4, paddingLeft: 4 }}>
          <button
            onClick={() => setExpanded((x) => !x)}
            style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {expanded ? '▲ hide analysis' : '▼ show analysis'}
          </button>
          {expanded && <AnalysisPanel analysis={msg.analysis} />}
        </div>
      )}

      {/* Suggestion */}
      {msg.suggestion && !isOut && (
        <div
          style={{
            marginTop: 6,
            padding: '10px 12px',
            background: '#fff',
            border: '1px dashed #c0c0c0',
            borderRadius: 10,
          }}
        >
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <p style={{ margin: 0, fontSize: 11, color: 'hsl(var(--muted-foreground))', flex: 1 }}>💡 Suggested reply</p>
            {msg.analysis?.explanation && (
              <button
                onClick={() => setExplExpanded((x) => !x)}
                style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                {explExpanded ? '▲ hide why' : '▼ why this?'}
              </button>
            )}
          </div>

          {/* Explanation panel */}
          {explExpanded && msg.analysis?.explanation && (
            <div style={{ marginBottom: 8, padding: '8px 10px', background: '#f7f7f7', borderRadius: 7, fontSize: 11, color: '#555', lineHeight: '1.5' }}>
              {msg.analysis.explanation.summary && (
                <p style={{ margin: '0 0 4px', fontWeight: 600, color: 'hsl(var(--foreground))' }}>{msg.analysis.explanation.summary}</p>
              )}
              {msg.analysis.explanation.intent && (
                <p style={{ margin: '0 0 2px' }}>Intent: <strong>{msg.analysis.explanation.intent}</strong></p>
              )}
              {msg.analysis.explanation.context_used && (
                <p style={{ margin: '0 0 2px' }}>Context: {msg.analysis.explanation.context_used}</p>
              )}
              {msg.analysis.explanation.style_notes && msg.analysis.explanation.style_notes.length > 0 && (
                <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {msg.analysis.explanation.style_notes.map((n, i) => (
                    <span key={i} style={{ fontSize: 10, padding: '2px 7px', background: '#e8f0fe', borderRadius: 12, color: '#2255aa' }}>{n}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Reply text + actions */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'hsl(var(--foreground))', flex: 1, lineHeight: '1.5' }}>{msg.suggestion}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
              <button
                className="btn-pill bg-foreground text-background hover:opacity-90"
                style={{ fontSize: 12, padding: '5px 12px', whiteSpace: 'nowrap' }}
                onClick={() => onSendSuggestion(msg.chat_id, msg.suggestion!, msg.replyId)}
              >
                Send
              </button>
              {/* Feedback row */}
              {msg.replyId && (
                <div style={{ display: 'flex', gap: 3, justifyContent: 'center' }}>
                  {(['good', 'neutral', 'bad'] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => msg.replyId && onRate(msg.id, msg.chat_id, msg.replyId, r)}
                      title={r}
                      style={{
                        border: '1px solid',
                        borderColor: msg.feedbackGiven === r ? (r === 'good' ? '#22c55e' : r === 'bad' ? '#ef4444' : '#f97316') : 'hsl(var(--border))',
                        background: msg.feedbackGiven === r ? (r === 'good' ? '#dcfce7' : r === 'bad' ? '#fee2e2' : '#fff7ed') : '#fff',
                        borderRadius: 6,
                        padding: '2px 6px',
                        fontSize: 13,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      {r === 'good' ? '👍' : r === 'bad' ? '👎' : '—'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LiveChat() {
  const { importLiveChats, appendLiveMessage, chats: contextChats } = useChatContext()
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({ status: 'disconnected' })
  const [messages, setMessages] = useState<LiveMessage[]>([])
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [config, setConfig] = useState<WaConfig | null>(null)
  const [inputText, setInputText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [isLoadingChats, setIsLoadingChats] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loadedChatCount, setLoadedChatCount] = useState(0)
  const feedRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  const importedRef = useRef(false)

  // ── Status polling — fallback for when SSE events are missed ────────────────
  // Defined early so useEffects below can reference them safely.
  const pollStatusRef = useRef<number | null>(null)

  const stopPolling = useCallback(() => {
    if (pollStatusRef.current) { clearInterval(pollStatusRef.current); pollStatusRef.current = null }
  }, [])

  // ── Load all WhatsApp chats into ChatContext ─────────────────────────────────
  const loadAllChats = useCallback(async () => {
    if (importedRef.current) return
    importedRef.current = true
    setIsLoadingChats(true)

    // Retry with exponential backoff — server may not be ready immediately
    const MAX_ATTEMPTS = 6
    let delay = 1500
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch('/api/whatsapp/chats/all')
        if (res.status === 503) {
          // Bridge not ready yet — wait and retry silently
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, delay))
            delay = Math.min(delay * 1.5, 8000)
            continue
          }
          importedRef.current = false
          setIsLoadingChats(false)
          return
        }
        if (!res.ok) { importedRef.current = false; setIsLoadingChats(false); return }
        const { chats: liveChatData } = await res.json()
        if (!liveChatData?.length) { setIsLoadingChats(false); return }
        setLoadedChatCount(liveChatData.length)
        importLiveChats(liveChatData)
        setChats(liveChatData.map((c: any) => ({
          chatId: c.chatId,
          senderName: c.chatName,
          lastSeen: c.lastMessageTime,
          messageCount: c.messages.length,
          replyCount: 0,
        })))
        setIsLoadingChats(false)
        return
      } catch (_err) {
        // Network error (server starting up) — retry silently
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, delay))
          delay = Math.min(delay * 1.5, 8000)
        } else {
          importedRef.current = false
          setIsLoadingChats(false)
        }
      }
    }
  }, [importLiveChats])

  const startPolling = useCallback(() => {
    stopPolling()
    pollStatusRef.current = window.setInterval(async () => {
      try {
        const res = await fetch('/api/whatsapp/status')
        if (!res.ok) return
        const d = await res.json()
        setBridgeStatus({ status: d.status, qrDataUrl: d.qrDataUrl, info: d.info })
        if (d.status === 'ready') {
          stopPolling()
          loadAllChats()
        } else if (d.status === 'auth_failure' || d.status === 'reconnect_failed') {
          stopPolling()
        }
      } catch { /* server unreachable — keep polling */ }
    }, 3000)
  }, [stopPolling, loadAllChats])

  // ── Config / status load on mount ────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/whatsapp/config')
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {})
    fetch('/api/whatsapp/status')
      .then((r) => r.json())
      .then((d) => {
        setBridgeStatus({ status: d.status, qrDataUrl: d.qrDataUrl, info: d.info })
        if (d.status === 'ready') loadAllChats()
        // Bridge already connecting on page load (auto-start) — poll until ready
        else if (d.status === 'connecting' || d.status === 'reconnecting') startPolling()
      })
      .catch(() => {})
  }, [loadAllChats, startPolling])

  // ── SSE connection ──────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/api/whatsapp/events')
    esRef.current = es

    const on = (evt: string, fn: (d: MessageEvent) => void) =>
      es.addEventListener(evt, fn)

    on('bridge_status', (e) => {
      const d = JSON.parse(e.data)
      setBridgeStatus({ status: d.status, qrDataUrl: d.qrDataUrl, info: d.info })
      // If SSE delivers ready/error, stop the polling fallback
      if (d.status === 'ready' || d.status === 'auth_failure' || d.status === 'reconnect_failed') {
        stopPolling()
      }
      if (d.status === 'ready') loadAllChats()
    })

    on('qr', (e) => {
      const d = JSON.parse(e.data)
      stopPolling()  // QR arrived — SSE is working
      setBridgeStatus((prev) => ({ ...prev, status: 'qr_pending', qrDataUrl: d.qrDataUrl }))
    })

    on('ready', (e) => {
      const d = JSON.parse(e.data)
      stopPolling()  // SSE delivered ready — stop polling
      setBridgeStatus({ status: 'ready', qrDataUrl: null, info: d.info })
      loadAllChats()
    })

    on('chats_loading', () => {
      setIsLoadingChats(true)
    })

    on('chats_loaded', (e) => {
      setIsLoadingChats(false)   // ← always clear the spinner
      const { chats: liveChatData } = JSON.parse(e.data)
      if (!liveChatData?.length) return
      importedRef.current = true  // mark as loaded so REST fetch is skipped
      setLoadedChatCount(liveChatData.length)
      importLiveChats(liveChatData)
      setChats(liveChatData.map((c: any) => ({
        chatId: c.chatId,
        senderName: c.chatName,
        lastSeen: c.lastMessageTime,
        messageCount: c.messages.length,
        replyCount: 0,
      })))
    })

    on('message', (e) => {
      const d = JSON.parse(e.data)
      const msg: LiveMessage = {
        id: d.message_id || `${d.chat_id}-${d.timestamp}`,
        chat_id: d.chat_id,
        chat_name: d.chat_name,
        sender: d.sender,
        message: d.message,
        timestamp: d.timestamp,
        direction: 'in',
      }
      setMessages((prev) => [...prev.slice(-499), msg])
      // Append to ChatContext so all features (tone, psych, commitments) stay updated
      appendLiveMessage(d.chat_id, d.sender, d.message, d.timestamp, d.message_id)
      // Update sidebar
      setChats((prev) => {
        const exists = prev.find((c) => c.chatId === d.chat_id)
        if (exists) return prev.map((c) => c.chatId === d.chat_id ? { ...c, lastSeen: d.timestamp, messageCount: c.messageCount + 1 } : c)
        return [{ chatId: d.chat_id, senderName: d.sender, lastSeen: d.timestamp, messageCount: 1, replyCount: 0 }, ...prev]
      })
    })

    on('analysis', (e) => {
      const d = JSON.parse(e.data)
      setMessages((prev) => {
        // Patch the last un-analyzed inbound message in this chat
        const idx = [...prev].reverse().findIndex(
          (m) => m.chat_id === d.chat_id && m.direction === 'in' && !m.analysis
        )
        if (idx === -1) return prev
        const realIdx = prev.length - 1 - idx
        const next = [...prev]
        // Merge explanation into analysis object so bubble can show "why this?"
        const analysisWithExpl = {
          ...d.analysis,
          explanation: d.analysis?.explanation ?? undefined,
        }
        next[realIdx] = { ...next[realIdx], analysis: analysisWithExpl }
        return next
      })
    })

    on('suggestion', (e) => {
      const d = JSON.parse(e.data)
      setMessages((prev) => {
        let patched = false
        return prev.map((m) => {
          if (patched) return m
          if (m.chat_id === d.chat_id && m.direction === 'in' && !m.suggestion &&
              m.message === d.message) {
            patched = true
            return { ...m, suggestion: d.reply, replyId: d.replyId ?? undefined }
          }
          return m
        })
      })
    })

    on('reply_sent', (e) => {
      const d = JSON.parse(e.data)
      const ts = Date.now()
      const msg: LiveMessage = {
        id: `out-${ts}`,
        chat_id: d.chatId,
        chat_name: '',
        sender: 'You',
        message: d.text,
        timestamp: ts,
        direction: 'out',
      }
      setMessages((prev) => [...prev.slice(-499), msg])
      appendLiveMessage(d.chatId, 'You', d.text, ts)
      setChats((prev) => prev.map((c) => c.chatId === d.chatId ? { ...c, replyCount: c.replyCount + 1 } : c))
    })

    on('log_replay', () => {
      // ignore for now — could hydrate message list
    })

    es.onerror = () => {
      setBridgeStatus((prev) =>
        prev.status === 'ready' ? { ...prev, status: 'reconnecting' } : prev,
      )
    }

    return () => { es.close(); esRef.current = null }
  }, [loadAllChats, importLiveChats, appendLiveMessage, stopPolling])

  // Stop polling when component unmounts
  useEffect(() => stopPolling, [stopPolling])

  // ── Actions ─────────────────────────────────────────────────────────────────
  const startBridge = useCallback(async () => {
    setIsStarting(true)
    // Show connecting immediately — don't wait for SSE
    setBridgeStatus((prev) => ({ ...prev, status: 'connecting' }))
    try {
      await fetch('/api/whatsapp/start', { method: 'POST' })
      startPolling()  // poll until SSE delivers ready event
    } finally {
      setIsStarting(false)
    }
  }, [startPolling])

  const reconnectBridge = useCallback(async () => {
    setIsReconnecting(true)
    setBridgeStatus((prev) => ({ ...prev, status: 'connecting' }))
    try {
      await fetch('/api/whatsapp/reconnect', { method: 'POST' })
      startPolling()
    } finally {
      setIsReconnecting(false)
    }
  }, [startPolling])

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? inputText).trim()
    if (!activeChatId || !text || isSending) return
    setIsSending(true)
    try {
      await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: activeChatId, text }),
      })
      setInputText('')
    } catch (err) {
      console.error(err)
    } finally {
      setIsSending(false)
    }
  }, [activeChatId, inputText, isSending])

  const sendSuggestion = useCallback(async (chatId: string, text: string, replyId?: string) => {
    setIsSending(true)
    try {
      await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, text, replyId }),
      })
      // Auto-rate as good when user manually sends the suggestion
      if (replyId) {
        await fetch('/api/whatsapp/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId, replyId, rating: 'good' }),
        }).catch(() => {})
        setMessages((prev) => prev.map((m) => m.replyId === replyId ? { ...m, feedbackGiven: 'good' } : m))
      }
    } finally {
      setIsSending(false)
    }
  }, [])

  const rateSuggestion = useCallback(async (msgId: string, chatId: string, replyId: string, rating: 'good' | 'neutral' | 'bad') => {
    // Optimistic update
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, feedbackGiven: rating } : m))
    try {
      await fetch('/api/whatsapp/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, replyId, rating }),
      })
    } catch {
      // revert on failure
      setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, feedbackGiven: undefined } : m))
    }
  }, [])

  const toggleAutoReply = useCallback(async () => {
    if (!config) return
    const next = { ...config, autoReply: !config.autoReply }
    setConfig(next)
    await fetch('/api/whatsapp/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoReply: next.autoReply }),
    })
  }, [config])

  // Merge historical messages from ChatContext with live SSE messages
  const activeMessages = useMemo<LiveMessage[]>(() => {
    if (!activeChatId) return messages.slice(-80)

    // Find the ChatRecord loaded at startup via importLiveChats
    const record = Object.values(contextChats).find((r) => r.liveId === activeChatId)

    // SSE messages for this chat (current session)
    const sseMsgs = messages.filter((m) => m.chat_id === activeChatId)
    const sseIds  = new Set(sseMsgs.map((m) => m.id))

    // Convert historical messages to LiveMessage shape, skip any already in SSE
    const historical: LiveMessage[] = (record?.messages ?? [])
      .filter((m) => !sseIds.has(m.id))
      .map((m) => {
        const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0
        return {
          id:        m.id,
          chat_id:   activeChatId,
          chat_name: record?.label ?? '',
          sender:    m.author,
          message:   m.text,
          timestamp: ts,
          direction: m.author === 'You' ? ('out' as const) : ('in' as const),
        }
      })

    return [...historical, ...sseMsgs].sort((a, b) => a.timestamp - b.timestamp)
  }, [activeChatId, contextChats, messages])

  const requestKeyboardAssist = useCallback(async (draft: string): Promise<KeyboardAssistPayload | null> => {
    if (!activeChatId) return null
    try {
      const res = await fetch('/api/whatsapp/keyboard-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: activeChatId, draft, platform: 'whatsapp' }),
      })
      if (!res.ok) return null
      return res.json() as Promise<KeyboardAssistPayload>
    } catch {
      return null
    }
  }, [activeChatId])

  const activeChatSummary = useMemo(
    () => chats.find((chat) => chat.chatId === activeChatId) ?? null,
    [activeChatId, chats],
  )

  // ── Auto-scroll: only fire when a new message arrives or the active chat changes ──
  const lastMsgId = activeMessages[activeMessages.length - 1]?.id
  useEffect(() => {
    const el = feedRef.current
    if (!el) return
    // Only auto-scroll if already near the bottom (within 200px), to avoid
    // hijacking the scroll position when the user is browsing history
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMsgId, activeChatId])

  const isReady = bridgeStatus.status === 'ready'

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Emergent-style top bar ─────────────────────────────────────────── */}
      <div style={{ borderBottom: '1px solid hsl(var(--border))', padding: '12px 48px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
        <h2 style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.01em', marginRight: 'auto' }}>Live Bridge.</h2>
        {/* Mobile sidebar toggle */}
        <button
          onClick={() => setSidebarOpen((o) => !o)}
          style={{ display: 'none', background: 'none', border: '1px solid hsl(var(--border))', borderRadius: 8, padding: '5px 8px', cursor: 'pointer', fontSize: 14 }}
          className="mobile-sidebar-btn"
        >
          ☰
        </button>
        {/* Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={`inline-block w-2 h-2 rounded-full ${statusDot(bridgeStatus.status)}`} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{statusLabel(bridgeStatus.status)}</span>
          {bridgeStatus.info && (
            <span style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>— {bridgeStatus.info.name} (+{bridgeStatus.info.phone})</span>
          )}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Auto-reply toggle */}
          {config && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
              <div
                onClick={toggleAutoReply}
                style={{
                  width: 36, height: 20, borderRadius: 10, position: 'relative', cursor: 'pointer',
                  background: config.autoReply ? 'hsl(var(--foreground))' : '#d1d1d6', transition: 'background 0.2s',
                }}
              >
                <div style={{
                  position: 'absolute', top: 2, left: config.autoReply ? 18 : 2,
                  width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
                }} />
              </div>
              Auto-reply
            </label>
          )}

          {/* Start button */}
          {bridgeStatus.status === 'disconnected' || bridgeStatus.status === 'auth_failure' ? (
            <button className="btn-pill bg-foreground text-background hover:opacity-90" style={{ fontSize: 12, padding: '6px 14px' }} onClick={startBridge} disabled={isStarting}>
              {isStarting ? 'Starting…' : 'Start Bridge'}
            </button>
          ) : null}
          {bridgeStatus.status !== 'qr_pending' && (
            <button className="btn-pill bg-secondary text-foreground hover:opacity-80" style={{ fontSize: 12, padding: '6px 14px' }} onClick={reconnectBridge} disabled={isReconnecting}>
              {isReconnecting ? 'Reconnecting…' : 'Reconnect'}
            </button>
          )}
        </div>
      </div>

      {/* ── Main layout ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>

        {/* Mobile sidebar backdrop */}
        {sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 40 }}
          />
        )}

        {/* Sidebar — chat list */}
        <div
          className={`vac-sidebar${sidebarOpen ? ' vac-sidebar-open' : ''}`}
          style={{
            width: 220,
            borderRight: '1px solid #e5e5e5',
            overflow: 'auto',
            flexShrink: 0,
            background: '#fff',
          }}
        >
          <div style={{ padding: '10px 12px 6px', borderBottom: '1px solid hsl(var(--border))' }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'hsl(var(--muted-foreground))' }}>Chats</p>
          </div>
          {/* All messages option */}
          <div
            onClick={() => { setActiveChatId(null); setSidebarOpen(false) }}
            style={{
              padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0',
              background: activeChatId === null ? '#f2f2f2' : 'transparent',
              fontWeight: activeChatId === null ? 600 : 400, fontSize: 13,
            }}
          >
            All messages
            <span style={{ marginLeft: 6, fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>({messages.length})</span>
          </div>
          {chats.map((c) => (
            <div
              key={c.chatId}
              onClick={() => { setActiveChatId(c.chatId); setSidebarOpen(false) }}
              style={{
                padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0',
                background: activeChatId === c.chatId ? '#f2f2f2' : 'transparent',
              }}
            >
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.senderName || c.chatId.split('@')[0]}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>
                {c.messageCount} msg · {c.replyCount} replied
              </p>
              {c.lastSeen && (
                <p style={{ margin: '1px 0 0', fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>{relTime(c.lastSeen)}</p>
              )}
            </div>
          ))}
          {chats.length === 0 && (
            <p style={{ padding: '16px 12px', fontSize: 12, color: 'hsl(var(--muted-foreground))', margin: 0 }}>
              No chats yet. Start the bridge and receive a message.
            </p>
          )}
        </div>

        {/* Content area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* QR code overlay */}
          {bridgeStatus.status === 'qr_pending' && bridgeStatus.qrDataUrl && (
            <div style={{ padding: 24, textAlign: 'center', borderBottom: '1px solid hsl(var(--border))', background: '#fafafa' }}>
              <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 14 }}>Scan with WhatsApp</p>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
                Open WhatsApp → Linked Devices → Link a Device
              </p>
              <img src={bridgeStatus.qrDataUrl} alt="WhatsApp QR" style={{ width: 220, height: 220, borderRadius: 12, border: '1px solid hsl(var(--border))' }} />
            </div>
          )}

          {/* Connecting state */}
          {(bridgeStatus.status === 'connecting' || bridgeStatus.status === 'reconnecting') && (
            <div style={{ padding: 20, textAlign: 'center', borderBottom: '1px solid hsl(var(--border))', background: '#fafafa' }}>
              <p style={{ margin: 0, fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>
                {bridgeStatus.status === 'reconnecting' ? 'Reconnecting to WhatsApp…' : 'Connecting to WhatsApp…'}
              </p>
            </div>
          )}

          {/* Loading chats */}
          {isLoadingChats && (
            <div style={{ padding: '12px 20px', borderBottom: '1px solid hsl(var(--border))', background: '#fafafa', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid #000', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
              <p style={{ margin: 0, fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>Loading all chats…</p>
            </div>
          )}
          {!isLoadingChats && loadedChatCount > 0 && (
            <div style={{ padding: '8px 20px', borderBottom: '1px solid hsl(var(--border))', background: 'hsl(var(--secondary))' }}>
              <p style={{ margin: 0, fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
                ✓ {loadedChatCount} chats loaded — available in Tone, Psychology, Commitments, Chat
              </p>
            </div>
          )}

          {/* Not started */}
          {bridgeStatus.status === 'disconnected' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, fontSize: 28 }}>
                💬
              </div>
              <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>WhatsApp Live Bridge</h2>
              <p style={{ margin: '0 0 24px', fontSize: 14, color: 'hsl(var(--muted-foreground))', maxWidth: 360 }}>
                Connect VAC to your WhatsApp account for real-time message analysis, tone scoring, and AI-powered reply suggestions.
              </p>
              <button className="btn-pill bg-foreground text-background hover:opacity-90" style={{ padding: '10px 24px' }} onClick={startBridge} disabled={isStarting}>
                {isStarting ? 'Starting…' : 'Start WhatsApp Bridge'}
              </button>
              <p style={{ margin: '16px 0 0', fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>
                Runs locally · No data leaves your laptop
              </p>
            </div>
          )}

          {/* Message feed */}
          {(isReady || messages.length > 0) && (
            <>
              <div ref={feedRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
                {activeMessages.length === 0 && (
                  <p style={{ textAlign: 'center', color: 'hsl(var(--muted-foreground))', fontSize: 13, marginTop: 40 }}>
                    {isReady ? 'Waiting for messages…' : 'No messages yet.'}
                  </p>
                )}
                {activeMessages.map((msg) => (
                  <MessageBubble key={msg.id} msg={msg} onSendSuggestion={sendSuggestion} onRate={rateSuggestion} />
                ))}
              </div>

              {/* Reply input */}
              {activeChatId && isReady && (
                <KeyboardComposer
                  value={inputText}
                  onChange={setInputText}
                  onSend={(text) => void sendMessage(text)}
                  onRequestAssist={requestKeyboardAssist}
                  disabled={!isReady}
                  sending={isSending}
                  activeChatName={activeChatSummary?.senderName || activeChatId}
                  activeChatId={activeChatId}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
