import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowUp, Search, Sparkles, Clock, AlertTriangle, RefreshCw, Loader2, Wand2 } from 'lucide-react'
import { useChatContext } from '../context/ChatContext'

function cn(...c: (string | boolean | undefined)[]) { return c.filter(Boolean).join(' ') }

function timeLabel(ts: string | number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function timeAgo(ts: string | number): string {
  const ms = Date.now() - new Date(ts).getTime()
  const m = Math.floor(ms / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (m < 2) return 'just now'
  if (m < 60) return `${m}m`
  if (h < 24) return `${h}h`
  return `${d}d`
}

interface AISuggestion { tone: string; label: string; text: string; reasoning?: string }
interface AIResult {
  noReplyNeeded?: boolean
  reason?: string
  situationRead?: string
  suggestions?: AISuggestion[]
  conflict?: boolean
}

interface PulseData {
  score: number
  label: string
  breakdown: { recency: number; tone: number; balance: number }
  lastActiveHoursAgo: number
}

function PulseRing({ score }: { score: number }) {
  const color = score >= 70 ? '#22c55e' : score >= 50 ? '#eab308' : score >= 30 ? '#f97316' : '#ef4444'
  const r = 14
  const circ = 2 * Math.PI * r
  const dash = (score / 100) * circ
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" className="-rotate-90">
      <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-secondary" />
      <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="3"
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
        className="transition-all duration-700" />
    </svg>
  )
}

function SuggestionChip({ s, onClick, selected }: { s: AISuggestion; onClick: () => void; selected: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex-shrink-0 max-w-[220px] rounded-2xl border text-left px-3.5 py-2.5 transition-all',
        selected
          ? 'bg-foreground text-background border-foreground'
          : 'border-border bg-background hover:border-foreground/30 hover:bg-secondary/50',
      )}
    >
      <p className={cn('text-[10px] font-semibold uppercase tracking-wider mb-1', selected ? 'text-background/60' : 'text-muted-foreground')}>
        {s.label}
      </p>
      <p className="text-[12.5px] leading-snug line-clamp-2">{s.text}</p>
    </button>
  )
}

export function ConversationPage() {
  const { threadId } = useParams<{ threadId: string }>()
  const navigate = useNavigate()
  const { chats, allCommitments, setActiveId } = useChatContext()
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [q, setQ] = useState('')
  const [text, setText] = useState('')
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [improving, setImproving] = useState(false)
  const [ai, setAi] = useState<AIResult | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [pulse, setPulse] = useState<PulseData | null>(null)

  const chat = threadId ? chats[threadId] : null

  useEffect(() => { if (threadId && chats[threadId]) setActiveId(threadId) }, [threadId])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [chat?.messages?.length])

  const fetchAI = useCallback(async () => {
    if (!chat?.messages?.length) return
    setAiLoading(true)
    setAi(null)
    setSelectedIdx(null)
    setText('')
    const msgs = chat.messages
    // Detect user's name from participants (non-numeric = user)
    const userAuthor = (() => {
      const counts: Record<string, number> = {}
      for (const p of (chat.participants ?? [])) {
        if (!/^\d+$/.test(p)) counts[p] = (counts[p] ?? 0) + 1
      }
      return Object.keys(counts)[0] ?? 'Me'
    })()
    const lastInbound = [...msgs].reverse().find(m => m.author !== 'Me' && m.author !== userAuthor)
    if (!lastInbound) { setAiLoading(false); return }
    try {
      const res = await fetch('/api/suggest-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: chat.id,
          message: lastInbound.text ?? (lastInbound as any).body ?? '',
          sender: lastInbound.author ?? chat.label ?? 'them',
          contactName: chat.label,
        }),
      })
      if (res.ok) setAi(await res.json())
    } catch {}
    finally { setAiLoading(false) }
  }, [chat?.id, chat?.messages?.length])

  const fetchPulse = useCallback(async () => {
    if (!chat?.messages?.length) return
    try {
      const res = await fetch('/api/relationship-pulse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chat.messages.slice(-30), contactName: chat.label }),
      })
      if (res.ok) setPulse(await res.json())
    } catch {}
  }, [chat?.id, chat?.messages?.length])

  useEffect(() => { fetchAI(); fetchPulse() }, [fetchAI, fetchPulse])

  async function improveDraft() {
    if (!text.trim()) return
    setImproving(true)
    try {
      const res = await fetch('/api/improve-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: chat?.id, draft: text }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.improved) setText(data.improved)
      }
    } catch {} finally { setImproving(false) }
  }

  const messages = useMemo(() => {
    if (!chat) return []
    if (!q.trim()) return chat.messages
    return chat.messages.filter(m => (m.body ?? '').toLowerCase().includes(q.toLowerCase()))
  }, [chat, q])

  const grouped = useMemo(() => {
    const out: Array<{ type: 'date'; label: string } | { type: 'msg'; m: any; key: string }> = []
    let lastDate = ''
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      const d = m.timestamp
        ? new Date(m.timestamp).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
        : ''
      if (d && d !== lastDate) { out.push({ type: 'date', label: d }); lastDate = d }
      out.push({ type: 'msg', m, key: m.id ?? String(i) })
    }
    return out
  }, [messages])

  const commitments = useMemo(() => {
    if (!chat) return []
    return allCommitments.filter(c => c.conversationId === chat.id || c.madeToPersonName === chat.label)
  }, [chat, allCommitments])

  const overdue = commitments.filter(c => c.status === 'overdue')
  const pending = commitments.filter(c => c.status === 'pending' || c.status === 'in-progress')
  const suggestions = ai?.suggestions ?? []

  function selectChip(idx: number) {
    const s = suggestions[idx]
    if (!s) return
    setSelectedIdx(idx)
    setText(s.text)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  if (!chat) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Conversation not found.</p>
          <button onClick={() => navigate('/')} className="rounded-full bg-secondary px-4 py-2 text-[13px]">← Back</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border shrink-0">
          <button onClick={() => navigate('/')} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-secondary">
            <ArrowLeft className="h-4 w-4" strokeWidth={1.6} />
          </button>
          <div className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center text-[13px] font-semibold shrink-0">
            {(chat.label ?? '?').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold truncate leading-tight">{chat.label}</p>
            <p className="text-[11px] text-muted-foreground">{chat.messages.length.toLocaleString()} messages</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" strokeWidth={1.6} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" className="h-7 w-32 rounded-full bg-secondary pl-8 pr-3 text-[12px] outline-none" />
            </div>
            <button onClick={fetchAI} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" title="Refresh AI">
              <RefreshCw className={cn('h-3.5 w-3.5', aiLoading && 'animate-spin')} strokeWidth={1.6} />
            </button>
          </div>
        </div>

        {/* AI suggestion chips */}
        <div className="border-b border-border/60 px-4 py-3 shrink-0 bg-background">
          {aiLoading ? (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.6} />
              <span>VAC is reading the conversation…</span>
            </div>
          ) : ai?.noReplyNeeded ? (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
              No reply needed — {ai.reason ?? 'conversation appears complete.'}
            </div>
          ) : suggestions.length > 0 ? (
            <div>
              {ai?.situationRead && (
                <p className="text-[11px] text-muted-foreground mb-2.5 flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 shrink-0 text-accent" strokeWidth={1.6} />
                  {ai.situationRead}
                </p>
              )}
              <div className="flex gap-2 overflow-x-auto scrollbar-none pb-0.5">
                {suggestions.map((s, i) => (
                  <SuggestionChip key={i} s={s} onClick={() => selectChip(i)} selected={selectedIdx === i} />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">Open a conversation — VAC will read it and suggest replies.</p>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {grouped.map((g, i) => {
            if (g.type === 'date') {
              return (
                <div key={`d-${i}`} className="flex items-center justify-center py-4">
                  <span className="text-[10px] text-muted-foreground px-3 py-1 rounded-full bg-secondary/60">{g.label}</span>
                </div>
              )
            }
            const userAuthorName = chat.participants?.find(p => !/^\d+$/.test(p)) ?? 'Me'
            const isMe = g.m.author === 'Me' || g.m.author === userAuthorName || g.m.isFromUser
            return (
              <div key={g.key} className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
                <div className="max-w-[72%]">
                  {!isMe && <p className="text-[10px] text-muted-foreground mb-1 ml-1">{g.m.author}</p>}
                  <div className={cn(
                    'rounded-[18px] px-3.5 py-2.5 text-[13.5px] leading-[1.5]',
                    isMe ? 'bg-foreground text-background rounded-br-sm' : 'bg-secondary text-foreground rounded-bl-sm',
                  )}>
                    <p className="whitespace-pre-wrap break-words">{g.m.text ?? g.m.body}</p>
                  </div>
                  <p className={cn('mt-0.5 text-[10px] text-muted-foreground', isMe ? 'text-right mr-1' : 'ml-1')}>
                    {g.m.timestamp ? timeLabel(g.m.timestamp) : ''}
                  </p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Reply composer */}
        <div className="shrink-0 border-t border-border px-4 py-3">
          <div className="flex items-end gap-2 rounded-2xl bg-secondary px-4 py-3 focus-within:ring-2 focus-within:ring-foreground/10 transition-shadow">
            <textarea
              ref={inputRef}
              rows={1}
              value={text}
              onChange={e => { setText(e.target.value); setSelectedIdx(null) }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) e.preventDefault() }}
              placeholder={`Reply to ${(chat.label ?? '').split(' ')[0]}…`}
              className="flex-1 resize-none bg-transparent text-[13.5px] leading-[1.5] placeholder:text-muted-foreground focus:outline-none max-h-36"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
            />
            <div className="flex items-center gap-1.5 shrink-0">
              {text.trim() && (
                <button onClick={improveDraft} disabled={improving} title="Polish with AI" className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-background/60 flex items-center justify-center transition-colors disabled:opacity-40">
                  {improving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" strokeWidth={1.6} />}
                </button>
              )}
              <button disabled={!text.trim()} className="h-8 w-8 rounded-full bg-foreground flex items-center justify-center text-background disabled:opacity-25 transition-opacity">
                <ArrowUp className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </div>
          {selectedIdx !== null && suggestions[selectedIdx]?.reasoning && (
            <p className="mt-1.5 text-[11px] text-muted-foreground px-1">
              {suggestions[selectedIdx].reasoning}
            </p>
          )}
        </div>
      </div>

      {/* Intelligence sidebar */}
      <div className="w-[256px] shrink-0 border-l border-border overflow-y-auto hidden lg:flex flex-col">

        {/* Pulse */}
        <div className="p-5 border-b border-border/60">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Relationship pulse</p>
          {pulse ? (
            <>
              <div className="flex items-center gap-3 mb-3">
                <PulseRing score={pulse.score} />
                <div>
                  <p className="text-[24px] font-semibold leading-none">{pulse.score}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{pulse.label}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                {(Object.entries(pulse.breakdown) as [string, number][]).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <p className="text-[11px] text-muted-foreground w-14 capitalize">{k}</p>
                    <div className="flex-1 h-[3px] rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full bg-foreground/40 transition-all duration-700" style={{ width: `${v}%` }} />
                    </div>
                    <p className="text-[10px] text-muted-foreground w-6 text-right tabular-nums">{v}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <div className="h-9 w-24 bg-secondary rounded-lg animate-pulse" />
              <div className="h-2 w-full bg-secondary rounded-full animate-pulse" />
              <div className="h-2 w-4/5 bg-secondary rounded-full animate-pulse" />
            </div>
          )}
        </div>

        {/* Commitments */}
        {commitments.length > 0 && (
          <div className="p-5 border-b border-border/60">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Commitments · {commitments.length}
            </p>
            <div className="space-y-2">
              {overdue.slice(0, 3).map(c => (
                <div key={c.id} className="flex items-start gap-2 rounded-xl bg-destructive/8 px-3 py-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" strokeWidth={1.6} />
                  <p className="text-[12px] leading-snug">{c.text}</p>
                </div>
              ))}
              {pending.slice(0, 3).map(c => (
                <div key={c.id} className="flex items-start gap-2 rounded-xl bg-secondary px-3 py-2.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" strokeWidth={1.6} />
                  <p className="text-[12px] leading-snug">{c.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Situation */}
        {ai?.situationRead && (
          <div className="p-5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Situation read</p>
            <p className="text-[12px] leading-relaxed text-foreground/80">{ai.situationRead}</p>
            {ai.conflict && (
              <div className="mt-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5">
                <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">Conflict detected — VAC will help you de-escalate.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
