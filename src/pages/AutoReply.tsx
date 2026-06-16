import { useEffect, useState, useCallback } from 'react'
import {
  Bot, ThumbsUp, ThumbsDown, Minus, ChevronDown, ChevronUp,
  Zap, Eye, BrainCircuit, MessageSquare, Settings2, RefreshCw,
  CheckCircle2, AlertCircle, Info, Sparkles,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type Mode = 'off' | 'suggest' | 'auto'
type Rating = 'good' | 'neutral' | 'bad'

interface ReplyExplanation {
  summary:              string
  intent:               string
  tone_read:            string
  context_used:         string
  style_notes:          string[]
  recipient_style_read: string
  confidenceScore:      number
}

interface ReplyRecord {
  id:             string
  chatId:         string
  senderName:     string
  incomingMsg:    string
  generatedReply: string
  sentAt:         number
  mode:           string
  explanation:    ReplyExplanation
  feedback:       { rating: Rating | null; editedReply: string | null; submittedAt: number | null }
}

interface FeedbackStats {
  total:          number
  goodCount:      number
  neutralCount:   number
  badCount:       number
  goodRate:       number | null
  avoidPhrases:   string[]
  goodPhrases:    string[]
  preferredLength: string | null
  recentEntries:  Array<{ replyId: string; chatId: string; senderName: string; rating: Rating; generatedReply: string; incomingMsg: string }>
  perChat:        Record<string, { good: number; neutral: number; bad: number; senderName: string }>
}

interface ChatConfig {
  chatId: string
  mode:   Mode
}

interface WhatsAppChat {
  chatId:       string
  senderName:   string | null
  lastSeen:     string | null
  messageCount: number
  replyCount:   number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MODE_LABELS: Record<Mode, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  off:     { label: 'Off',          icon: <AlertCircle className="h-3.5 w-3.5" />, color: 'text-[#86868b]', bg: 'bg-[#f5f5f7] border-[#d2d2d7]/50' },
  suggest: { label: 'Suggest only', icon: <Eye          className="h-3.5 w-3.5" />, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200'       },
  auto:    { label: 'Auto-send',    icon: <Zap          className="h-3.5 w-3.5" />, color: 'text-[#0071e3]', bg: 'bg-[#0071e3]/8 border-[#0071e3]/20'  },
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts
  if (diff < 60_000)    return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}

function ConfidenceDot({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color = pct >= 80 ? '#059669' : pct >= 60 ? '#d97706' : '#dc2626'
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {pct}% confidence
    </span>
  )
}

// ── Reply card with explanation + feedback ────────────────────────────────────

function ReplyCard({ record, onRate }: { record: ReplyRecord; onRate: (id: string, chatId: string, rating: Rating) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [pendingRating, setPendingRating] = useState<Rating | null>(null)
  const currentRating = pendingRating ?? record.feedback.rating

  function handleRate(r: Rating) {
    setPendingRating(r)
    onRate(record.id, record.chatId, r)
  }

  return (
    <div className="rounded-[14px] border border-black/[0.06] bg-white shadow-[0_1px_8px_rgba(0,0,0,0.04)] overflow-hidden">
      {/* Main row */}
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          {/* Sender avatar */}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0071e3]/10 text-[10px] font-bold text-[#0071e3]">
            {(record.senderName || '?').slice(0, 2).toUpperCase()}
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            {/* Incoming */}
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-medium text-[#86868b]">{record.senderName}</span>
              <span className="text-[10px] text-[#d2d2d7]">{timeAgo(record.sentAt)}</span>
              <span className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${MODE_LABELS[record.mode as Mode]?.color ?? 'text-[#86868b]'} ${MODE_LABELS[record.mode as Mode]?.bg ?? ''}`}>
                {record.mode}
              </span>
            </div>

            {/* Message bubble */}
            <div className="rounded-lg bg-[#f5f5f7] px-3 py-2 text-sm text-[#1d1d1f]">
              "{record.incomingMsg}"
            </div>

            {/* Reply bubble */}
            <div className="ml-4 rounded-lg bg-[#1d1d1f] px-3 py-2 text-sm text-white">
              {record.generatedReply}
            </div>
          </div>
        </div>

        {/* Actions row */}
        <div className="mt-2.5 flex items-center justify-between pl-11">
          {/* Feedback buttons */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[#86868b]">Rate:</span>
            {(['good', 'neutral', 'bad'] as Rating[]).map((r) => (
              <button
                key={r}
                onClick={() => handleRate(r)}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                  currentRating === r
                    ? r === 'good'    ? 'bg-emerald-500 text-white'
                    : r === 'neutral' ? 'bg-amber-400 text-white'
                    : 'bg-red-500 text-white'
                    : 'border border-[#d2d2d7]/60 text-muted-foreground hover:bg-[#f5f5f7]'
                }`}
              >
                {r === 'good'    ? <ThumbsUp   className="h-3 w-3" /> : null}
                {r === 'neutral' ? <Minus       className="h-3 w-3" /> : null}
                {r === 'bad'     ? <ThumbsDown  className="h-3 w-3" /> : null}
                {r}
              </button>
            ))}
            {currentRating && (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            )}
          </div>

          {/* Expand explanation */}
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 rounded-full border border-[#d2d2d7]/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-[#f5f5f7] transition-colors"
          >
            <Info className="h-3 w-3" />
            Why this reply?
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Explanation panel */}
      {expanded && (
        <div className="border-t border-[#f5f5f7] bg-[#f9f9fb] px-4 py-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#86868b]">
            <BrainCircuit className="h-3.5 w-3.5" />
            AI Reasoning
            <span className="ml-auto"><ConfidenceDot score={record.explanation?.confidenceScore ?? 0} /></span>
          </div>

          {record.explanation?.summary && (
            <p className="text-xs text-[#1d1d1f] leading-relaxed">
              {record.explanation.summary}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span className="text-[#86868b]">Intent detected</span>
              <p className="mt-0.5 font-medium text-[#1d1d1f] capitalize">{record.explanation?.intent || '—'}</p>
            </div>
            <div>
              <span className="text-[#86868b]">Tone read</span>
              <p className="mt-0.5 font-medium text-[#1d1d1f] capitalize">{record.explanation?.tone_read || '—'}</p>
            </div>
            <div className="col-span-2">
              <span className="text-[#86868b]">Context used</span>
              <p className="mt-0.5 text-[#1d1d1f]">{record.explanation?.context_used || '—'}</p>
            </div>
            <div className="col-span-2">
              <span className="text-[#86868b]">Recipient style</span>
              <p className="mt-0.5 text-[#1d1d1f]">{record.explanation?.recipient_style_read || '—'}</p>
            </div>
            {record.explanation?.style_notes?.length > 0 && (
              <div className="col-span-2">
                <span className="text-[#86868b]">Style choices</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {record.explanation.style_notes.map((note, i) => (
                    <span key={i} className="rounded-full bg-[#0071e3]/8 px-2 py-0.5 text-[10px] text-[#0071e3]">
                      {note}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Chat mode row ─────────────────────────────────────────────────────────────

function ChatModeRow({ chat, currentMode, onChange }: {
  chat:        WhatsAppChat
  currentMode: Mode
  onChange:    (chatId: string, mode: Mode) => void
}) {
  const modes: Mode[] = ['off', 'suggest', 'auto']
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-[#f5f5f7] last:border-0">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0071e3]/10 text-[10px] font-bold text-[#0071e3]">
        {(chat.senderName || chat.chatId).slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[#1d1d1f]">
          {chat.senderName || chat.chatId}
        </p>
        <p className="text-[11px] text-[#86868b]">{chat.messageCount} messages · {chat.replyCount} auto-replied</p>
      </div>
      <div className="flex items-center gap-1">
        {modes.map((m) => {
          const meta = MODE_LABELS[m]
          const active = currentMode === m
          return (
            <button
              key={m}
              onClick={() => onChange(chat.chatId, m)}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${
                active ? `${meta.bg} ${meta.color}` : 'border-[#d2d2d7]/40 text-[#86868b] hover:border-[#d2d2d7] hover:bg-[#f5f5f7]'
              }`}
            >
              {meta.icon}
              {meta.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AutoReplyPage() {
  const [config, setConfig]         = useState<{ autoReply: boolean; sentimentThreshold: number } | null>(null)
  const [chats, setChats]           = useState<WhatsAppChat[]>([])
  const [chatModes, setChatModes]   = useState<Record<string, Mode>>({})
  const [stats, setStats]           = useState<FeedbackStats | null>(null)
  const [replies, setReplies]       = useState<ReplyRecord[]>([])
  const [activeChat, setActiveChat] = useState<string | null>(null)
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState<'overview' | 'chats' | 'history' | 'learning'>('overview')

  // ── Load everything ─────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [cfgRes, chatsRes, statsRes] = await Promise.all([
        fetch('/api/whatsapp/config'),
        fetch('/api/whatsapp/chats'),
        fetch('/api/whatsapp/feedback/stats'),
      ])
      if (cfgRes.ok)    setConfig(await cfgRes.json())
      if (chatsRes.ok) {
        const chatList: WhatsAppChat[] = await chatsRes.json()
        setChats(chatList)
        // Load per-chat mode for each chat
        const modes: Record<string, Mode> = {}
        for (const chat of chatList) {
          try {
            const r = await fetch(`/api/whatsapp/chats/${encodeURIComponent(chat.chatId)}/config`)
            if (r.ok) {
              const d = await r.json()
              modes[chat.chatId] = d.mode || 'suggest'
            }
          } catch { modes[chat.chatId] = 'suggest' }
        }
        setChatModes(modes)
      }
      if (statsRes.ok) setStats(await statsRes.json())
    } catch { /* offline */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Load replies for selected chat
  useEffect(() => {
    if (!activeChat) return
    fetch(`/api/whatsapp/replies/${encodeURIComponent(activeChat)}?limit=30`)
      .then((r) => r.ok ? r.json() : [])
      .then(setReplies)
      .catch(() => setReplies([]))
  }, [activeChat])

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function setGlobalMode(autoReply: boolean) {
    const r = await fetch('/api/whatsapp/config', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoReply }),
    })
    if (r.ok) setConfig((c) => c ? { ...c, autoReply } : c)
  }

  async function setChatMode(chatId: string, mode: Mode) {
    setChatModes((m) => ({ ...m, [chatId]: mode }))
    await fetch(`/api/whatsapp/chats/${encodeURIComponent(chatId)}/config`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    }).catch(() => null)
  }

  async function submitFeedback(replyId: string, chatId: string, rating: Rating) {
    await fetch('/api/whatsapp/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replyId, chatId, rating }),
    }).catch(() => null)
    // Refresh stats silently
    fetch('/api/whatsapp/feedback/stats').then((r) => r.ok ? r.json() : null).then((d) => { if (d) setStats(d) })
  }

  // ── UI ──────────────────────────────────────────────────────────────────────

  const goodRate = stats?.goodRate ?? null

  return (
    <div className="px-12 pt-8 pb-24 animate-fade-in">
      <section className="max-w-3xl pt-10 pb-14">
        <h2 className="display-lg">Auto-Reply.</h2>
        <p className="mt-5 max-w-xl text-[17px] leading-[1.5] text-muted-foreground">
          Context-aware, style-matched replies with explainability, per-chat control, and a feedback loop that learns.
        </p>
      </section>
      <div className="max-w-4xl space-y-8">

      {/* Global mode bar */}
      {config && (
        <div className="flex flex-wrap items-center gap-4 rounded-[18px] border border-black/[0.06] bg-white p-5 shadow-[0_2px_20px_rgba(0,0,0,0.06)]">
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#1d1d1f]">Global default mode</p>
            <p className="text-xs text-[#86868b] mt-0.5">Applied to all chats without a per-chat override</p>
          </div>
          <div className="flex items-center gap-2">
            {(['off', 'suggest', 'auto'] as Mode[]).map((m) => {
              const meta = MODE_LABELS[m]
              const isGlobal = m === 'off' ? false : m === 'auto' ? config.autoReply : !config.autoReply
              return (
                <button
                  key={m}
                  onClick={() => setGlobalMode(m === 'auto')}
                  disabled={m === 'off'}
                  title={m === 'off' ? 'Use per-chat config to turn off individual chats' : undefined}
                  className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    isGlobal ? `${meta.bg} ${meta.color}` : 'border-[#d2d2d7]/50 text-muted-foreground hover:bg-[#f5f5f7]'
                  }`}
                >
                  {meta.icon}{meta.label}
                </button>
              )
            })}
          </div>
          <button onClick={refresh} className="flex items-center gap-1.5 rounded-xl border border-[#d2d2d7]/50 px-3 py-2 text-xs text-muted-foreground hover:bg-[#f5f5f7] transition-colors">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      )}

      {/* Stats bar */}
      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Replies rated', value: stats.total, color: '#0071e3' },
            { label: 'Good',          value: `${stats.goodCount} (${goodRate ?? 0}%)`, color: '#059669' },
            { label: 'Neutral',       value: stats.neutralCount, color: '#d97706' },
            { label: 'Bad',           value: stats.badCount, color: '#dc2626' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-[14px] border border-black/[0.06] bg-white p-4 shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
              <p className="text-[11px] uppercase tracking-wide text-[#86868b]">{label}</p>
              <p className="mt-1 text-2xl font-bold" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-[#d2d2d7]/40">
        {([
          { key: 'overview', label: 'Overview',    icon: <Sparkles   className="h-3.5 w-3.5" /> },
          { key: 'chats',    label: 'Per-chat',    icon: <Settings2  className="h-3.5 w-3.5" /> },
          { key: 'history',  label: 'Reply history', icon: <MessageSquare className="h-3.5 w-3.5" /> },
          { key: 'learning', label: 'Learning',    icon: <BrainCircuit className="h-3.5 w-3.5" /> },
        ] as const).map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-[#0071e3] text-[#0071e3]'
                : 'border-transparent text-[#86868b] hover:text-[#1d1d1f]'
            }`}
          >
            {icon}{label}
          </button>
        ))}
      </div>

      {/* ── Overview tab ─────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* How it works */}
          <div className="rounded-[18px] border border-black/[0.06] bg-white p-6 shadow-[0_2px_20px_rgba(0,0,0,0.06)]">
            <h2 className="font-display text-base font-semibold text-[#1d1d1f]">How the engine works</h2>
            <ol className="mt-4 space-y-3">
              {[
                { n: '1', title: 'Incoming message', desc: 'Bridge captures every new WhatsApp message in real-time.' },
                { n: '2', title: 'Context analysis', desc: 'Last 40 messages are used for relationship + conversation context.' },
                { n: '3', title: 'Style profiling', desc: 'Your outgoing message history builds a style fingerprint per contact.' },
                { n: '4', title: 'Learning injection', desc: `Feedback from ${stats?.total || 0} rated replies adjusts phrase preferences.` },
                { n: '5', title: 'Reply generation', desc: 'Claude writes a reply + structured explanation of its reasoning.' },
                { n: '6', title: 'Mode decision', desc: 'Auto-send or suggest based on per-chat setting and sentiment threshold.' },
                { n: '7', title: 'Feedback loop', desc: 'Rate each reply to continuously improve future generations.' },
              ].map(({ n, title, desc }) => (
                <li key={n} className="flex gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0071e3]/10 text-[10px] font-bold text-[#0071e3]">{n}</span>
                  <div>
                    <p className="text-sm font-medium text-[#1d1d1f]">{title}</p>
                    <p className="text-xs text-[#86868b]">{desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Mode guide */}
          <div className="rounded-[18px] border border-black/[0.06] bg-white p-6 shadow-[0_2px_20px_rgba(0,0,0,0.06)] space-y-4">
            <h2 className="font-display text-base font-semibold text-[#1d1d1f]">Mode guide</h2>
            {Object.entries(MODE_LABELS).map(([mode, meta]) => (
              <div key={mode} className={`flex items-start gap-3 rounded-xl border p-3 ${meta.bg}`}>
                <span className={`mt-0.5 ${meta.color}`}>{meta.icon}</span>
                <div>
                  <p className={`text-sm font-semibold ${meta.color}`}>{meta.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {mode === 'off'     && 'No replies generated. Messages still analyzed for insights.'}
                    {mode === 'suggest' && 'VAC drafts a reply and shows it in Live Chat for your approval before sending.'}
                    {mode === 'auto'    && 'VAC sends replies automatically with human-like typing delays.'}
                  </p>
                </div>
              </div>
            ))}

            {/* Accuracy gauge */}
            {goodRate !== null && (
              <div className="rounded-xl border border-[#d2d2d7]/50 bg-[#f5f5f7] p-4">
                <p className="text-xs font-medium text-[#86868b] uppercase tracking-wide">Reply accuracy</p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex-1 h-2 rounded-full bg-[#d2d2d7]/60 overflow-hidden">
                    <div className="h-full rounded-full bg-[#059669] transition-all" style={{ width: `${goodRate}%` }} />
                  </div>
                  <span className="text-sm font-bold text-[#059669]">{goodRate}%</span>
                </div>
                <p className="mt-1 text-xs text-[#86868b]">Based on {stats?.total} rated replies</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Per-chat tab ──────────────────────────────────────────────────── */}
      {tab === 'chats' && (
        <div className="rounded-[18px] border border-black/[0.06] bg-white shadow-[0_2px_20px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="border-b border-[#f5f5f7] px-5 py-3">
            <p className="text-sm font-semibold text-[#1d1d1f]">Per-chat auto-reply control</p>
            <p className="text-xs text-[#86868b]">Override the global default for individual conversations</p>
          </div>
          <div className="divide-y divide-[#f5f5f7]">
            {loading ? (
              <p className="px-5 py-8 text-center text-sm text-[#86868b]">Loading chats…</p>
            ) : chats.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-[#86868b]">No chats loaded yet. Start the WhatsApp bridge first.</p>
            ) : (
              <div className="px-5">
                {chats.map((chat) => (
                  <ChatModeRow
                    key={chat.chatId}
                    chat={chat}
                    currentMode={chatModes[chat.chatId] || 'suggest'}
                    onChange={setChatMode}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Reply history tab ──────────────────────────────────────────────── */}
      {tab === 'history' && (
        <div className="space-y-4">
          {/* Chat selector */}
          <div className="flex flex-wrap gap-2">
            {chats.slice(0, 12).map((chat) => (
              <button
                key={chat.chatId}
                onClick={() => setActiveChat(chat.chatId)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeChat === chat.chatId
                    ? 'bg-[#0071e3] text-white border-[#0071e3]'
                    : 'border-[#d2d2d7]/60 text-muted-foreground hover:bg-[#f5f5f7] hover:text-[#1d1d1f]'
                }`}
              >
                {chat.senderName || chat.chatId}
              </button>
            ))}
          </div>

          {!activeChat ? (
            <div className="rounded-[18px] border border-[#d2d2d7]/40 bg-[#f5f5f7] px-6 py-10 text-center text-sm text-[#86868b]">
              Select a chat above to see its reply history and explanations.
            </div>
          ) : replies.length === 0 ? (
            <div className="rounded-[18px] border border-[#d2d2d7]/40 bg-[#f5f5f7] px-6 py-10 text-center text-sm text-[#86868b]">
              No auto-reply records yet for this chat.
            </div>
          ) : (
            <div className="space-y-3">
              {replies.map((r) => (
                <ReplyCard key={r.id} record={r} onRate={submitFeedback} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Learning tab ──────────────────────────────────────────────────── */}
      {tab === 'learning' && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Avoid phrases */}
          <div className="rounded-[18px] border border-black/[0.06] bg-white p-6 shadow-[0_2px_20px_rgba(0,0,0,0.06)]">
            <h2 className="flex items-center gap-2 font-display text-base font-semibold text-[#1d1d1f]">
              <AlertCircle className="h-4 w-4 text-red-500" />
              Phrases to avoid
            </h2>
            <p className="mt-1 text-xs text-[#86868b]">Patterns from replies you rated as Bad — VAC avoids these.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {!stats?.avoidPhrases?.length ? (
                <p className="text-sm text-[#86868b]">No data yet. Rate some replies to train the system.</p>
              ) : stats.avoidPhrases.map((p) => (
                <span key={p} className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-600">"{p}"</span>
              ))}
            </div>
          </div>

          {/* Good phrases */}
          <div className="rounded-[18px] border border-black/[0.06] bg-white p-6 shadow-[0_2px_20px_rgba(0,0,0,0.06)]">
            <h2 className="flex items-center gap-2 font-display text-base font-semibold text-[#1d1d1f]">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Preferred patterns
            </h2>
            <p className="mt-1 text-xs text-[#86868b]">Patterns from replies you rated as Good — VAC reinforces these.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {!stats?.goodPhrases?.length ? (
                <p className="text-sm text-[#86868b]">Rate more replies to identify preferred patterns.</p>
              ) : stats.goodPhrases.map((p) => (
                <span key={p} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700">"{p}"</span>
              ))}
            </div>
          </div>

          {/* Preferred length */}
          {stats?.preferredLength && (
            <div className="rounded-[18px] border border-[#0071e3]/20 bg-[#0071e3]/5 p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-[#0071e3]">Learned preferred length</p>
              <p className="mt-1 text-sm font-semibold text-[#1d1d1f]">{stats.preferredLength}</p>
            </div>
          )}

          {/* Per-chat accuracy */}
          {stats?.perChat && Object.keys(stats.perChat).length > 0 && (
            <div className="rounded-[18px] border border-black/[0.06] bg-white p-6 shadow-[0_2px_20px_rgba(0,0,0,0.06)] lg:col-span-2">
              <h2 className="font-display text-base font-semibold text-[#1d1d1f]">Per-contact accuracy</h2>
              <div className="mt-4 space-y-3">
                {Object.entries(stats.perChat).map(([chatId, data]) => {
                  const total = data.good + data.neutral + data.bad
                  const rate  = total > 0 ? Math.round((data.good / total) * 100) : 0
                  return (
                    <div key={chatId} className="flex items-center gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0071e3]/10 text-[10px] font-bold text-[#0071e3]">
                        {(data.senderName || chatId).slice(0, 2).toUpperCase()}
                      </div>
                      <span className="w-32 truncate text-sm text-[#1d1d1f]">{data.senderName || chatId}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-[#d2d2d7]/50 overflow-hidden">
                        <div className="h-full rounded-full bg-[#059669]" style={{ width: `${rate}%` }} />
                      </div>
                      <span className="text-xs font-medium text-[#1d1d1f]">{rate}%</span>
                      <span className="text-xs text-[#86868b]">{total} rated</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
