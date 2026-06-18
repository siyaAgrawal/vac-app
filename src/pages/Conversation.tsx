import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Search, Clock, AlertTriangle, Brain, ArrowLeft } from 'lucide-react'
import { useChatContext } from '../context/ChatContext'
import { ReplyBox } from '../components/ReplyBox'
import type { SendDecision } from '../types'

function cn(...c: (string | boolean | undefined)[]) { return c.filter(Boolean).join(' ') }

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (m < 2) return 'just now'
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  return `${d}d ago`
}

export function ConversationPage() {
  const { threadId } = useParams<{ threadId: string }>()
  const navigate = useNavigate()
  const { chats, allCommitments, setActiveId } = useChatContext()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')
  const [decision, setDecision] = useState<SendDecision | null>(null)
  const [loadingDecision, setLoadingDecision] = useState(false)

  const chat = threadId ? chats[threadId] : null

  useEffect(() => {
    if (threadId && chats[threadId]) {
      setActiveId(threadId)
    }
  }, [threadId])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [chat?.messages?.length])

  // Fetch intelligence decision for this thread
  useEffect(() => {
    if (!chat?.messages?.length) return
    setLoadingDecision(true)
    const lastMsg = chat.messages[chat.messages.length - 1]
    if (!lastMsg) { setLoadingDecision(false); return }

    fetch('/api/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draft: '',
        recentMessages: chat.messages.slice(-10).map(m => ({
          role: m.author === 'Me' ? 'user' : 'assistant',
          content: m.text ?? '',
        })),
        contactName: chat.label,
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.suggestions) {
          setDecision({
            noReply: { shouldReply: true, signals: [] },
            drafts: data.suggestions.slice(0, 4).map((s: any, i: number) => ({
              mode: (['natural', 'professional', 'warm', 'persuasive'] as const)[i] ?? 'natural',
              text: s.text ?? s,
              tonePreview: { stress: 20, urgency: 20, politeness: 70, anger: 0, enthusiasm: 50, warmth: 65, dominant: 'neutral' },
              explanation: s.why ?? '',
              expectedOutcome: '',
              risks: [],
              lengthOk: true,
            })),
            strategy: {
              shouldReply: true, realIntent: '', emotionalTemperature: 'neutral',
              relationshipGoal: 'maintain', approach: '', mustAddress: [], avoid: [],
              tonePlan: { warmth: 6, directness: 5, brevity: 5 }, confidence: 0.7,
            },
            explanation: { summary: 'AI suggestions', intent: '', toneRead: '', whyThisStrategy: '' },
            sendHint: { bestWindow: null, canSendNow: true, reason: 'Good time to send' },
            warnings: [],
            strategyConfidence: 0.7,
            generatedAt: new Date().toISOString(),
          })
        }
      })
      .catch(() => {})
      .finally(() => setLoadingDecision(false))
  }, [chat?.id, chat?.messages?.length])

  const messages = useMemo(() => {
    if (!chat) return []
    if (!q.trim()) return chat.messages
    return chat.messages.filter(m => (m.text ?? '').toLowerCase().includes(q.toLowerCase()))
  }, [chat, q])

  const commitments = useMemo(() => {
    if (!chat) return []
    return allCommitments.filter(c =>
      c.chatId === chat.id || c.person === chat.label
    )
  }, [chat, allCommitments])

  const overdue = commitments.filter(c => c.status === 'overdue')
  const pending = commitments.filter(c => c.status === 'pending' || c.status === 'in-progress')

  // Simple tone from last 5 messages
  const toneScore = useMemo(() => {
    if (!chat?.messages?.length) return 25
    const text = chat.messages.slice(-5).map(m => m.text ?? '').join(' ')
    if (/urgent|asap|please|help|worried|need now/i.test(text)) return 70
    if (/angry|frustrated|hate|upset|disappointed/i.test(text)) return 85
    return 25
  }, [chat?.messages?.length])

  // Group by date
  const grouped = useMemo(() => {
    const out: Array<{ type: 'date'; label: string } | { type: 'msg'; m: any }> = []
    let lastDate = ''
    for (const m of messages) {
      const d = m.timestamp
        ? new Date(m.timestamp).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
        : ''
      if (d && d !== lastDate) { out.push({ type: 'date', label: d }); lastDate = d }
      out.push({ type: 'msg', m })
    }
    return out
  }, [messages])

  if (!chat) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-[15px] text-muted-foreground mb-4">Conversation not found.</p>
          <button onClick={() => navigate('/')} className="btn-pill bg-secondary text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to Inbox
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Main conversation */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-border shrink-0">
          <button onClick={() => navigate('/')} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" strokeWidth={1.6} />
          </button>
          <div className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center text-[12px] font-semibold shrink-0">
            {chat.label?.charAt(0)?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-medium truncate">{chat.label}</p>
            <p className="text-[11px] text-muted-foreground">{chat.messages.length.toLocaleString()} messages</p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" strokeWidth={1.6} />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search"
              className="h-8 w-44 rounded-full bg-secondary pl-9 pr-4 text-[12px] outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {grouped.map((g, i) => {
            if (g.type === 'date') {
              return (
                <div key={`d-${i}`} className="flex items-center justify-center my-6">
                  <span className="text-[11px] text-muted-foreground">{g.label}</span>
                </div>
              )
            }
            const isMe = g.m.author === 'Me'
            return (
              <div key={g.m.id ?? i} className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
                <div className="max-w-[65%]">
                  <div className={cn(
                    'rounded-[18px] px-4 py-2.5 text-[14px] leading-[1.45]',
                    isMe ? 'bg-accent text-accent-foreground rounded-tr-sm' : 'bg-secondary text-foreground rounded-tl-sm',
                  )}>
                    {g.m.text}
                  </div>
                  <p className={cn('mt-1 text-[10px] text-muted-foreground', isMe ? 'text-right' : 'text-left')}>
                    {!isMe && <span className="font-medium mr-1">{g.m.author} ·</span>}
                    {g.m.timestamp ? new Date(g.m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Reply box */}
        <ReplyBox
          threadId={chat.id}
          placeholder={`Reply to ${chat.label?.split(' ')[0]}…`}
          decision={decision}
          loading={loadingDecision}
          onRefresh={() => setDecision(null)}
        />
      </div>

      {/* Intelligence sidebar */}
      <div className="w-72 shrink-0 border-l border-border overflow-y-auto hidden lg:block">
        <div className="p-5 space-y-6">
          {/* Tone */}
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Tone</p>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full flex items-center justify-center" style={{
                background: toneScore > 70 ? '#fee2e2' : toneScore > 50 ? '#fef9c3' : '#f0fdf4',
              }}>
                <span className="text-[18px]">{toneScore > 70 ? '😤' : toneScore > 50 ? '😐' : '😊'}</span>
              </div>
              <div>
                <p className="text-[13px] font-medium">
                  {toneScore > 70 ? 'High stress' : toneScore > 50 ? 'Neutral' : 'Warm'}
                </p>
                <p className="text-[11px] text-muted-foreground">Last 5 messages</p>
              </div>
            </div>
          </div>

          {/* Commitments */}
          {commitments.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Commitments ({commitments.length})
              </p>
              <div className="space-y-2">
                {overdue.slice(0, 2).map(c => (
                  <div key={c.id} className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" strokeWidth={1.6} />
                    <p className="text-[12px] leading-snug">{c.text}</p>
                  </div>
                ))}
                {pending.slice(0, 2).map(c => (
                  <div key={c.id} className="flex items-start gap-2 rounded-xl bg-secondary p-3">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" strokeWidth={1.6} />
                    <p className="text-[12px] leading-snug">{c.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Relationship memory placeholder */}
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3">
              <Brain className="inline h-3 w-3 mr-1" strokeWidth={1.6} />
              Memory
            </p>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              VAC will build a relationship memory as you use it more. Import more conversations to get started.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
