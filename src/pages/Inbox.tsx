import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Upload, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react'
import { useChatContext } from '../context/ChatContext'

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

function ToneChip({ score }: { score: number }) {
  const label = score > 70 ? 'Stressed' : score > 50 ? 'Tense' : score > 30 ? 'Neutral' : 'Warm'
  const cls = score > 70
    ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
    : score > 50
      ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400'
      : 'bg-secondary text-muted-foreground'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {label}
    </span>
  )
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  return `${d}d ago`
}

export function InboxPage() {
  const navigate = useNavigate()
  const { chats, allCommitments, setActiveId } = useChatContext()

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning.'
    if (h < 18) return 'Good afternoon.'
    return 'Good evening.'
  })()

  const threads = useMemo(() => {
    return Object.values(chats)
      .map(chat => {
        const lastMsg = chat.messages[chat.messages.length - 1]
        const lastInbound = [...chat.messages].reverse().find(m => m.author !== 'Me' && m.author !== chat.label?.split(' ')[0])
        const commitments = allCommitments.filter(c => c.chatId === chat.id || c.person === chat.label)
        const overdue = commitments.filter(c => c.status === 'overdue').length
        const pending = commitments.filter(c => c.status === 'pending' || c.status === 'in-progress').length

        // Estimate stress from recent messages (simple heuristic)
        const recentText = chat.messages.slice(-5).map(m => m.body ?? '').join(' ')
        const stressScore = /urgent|asap|need|please|immediately|help|worried|concerned/i.test(recentText) ? 65
          : /angry|frustrated|disappointed|upset|hate/i.test(recentText) ? 80
          : 25

        // Simple no-reply detection
        const lastIsInbound = lastMsg && lastMsg.author !== 'Me'
        const lastInboundAge = lastInbound ? Date.now() - new Date(lastInbound.timestamp).getTime() : null
        const waitingTooLong = lastInboundAge && lastInboundAge > 4 * 3600000  // > 4 hours
        const needsReply = lastIsInbound && !chat.messages[chat.messages.length - 1]?.body?.match(/^(ok|okay|k|sure|👍|✅|noted|done|will do).?$/i)

        return {
          chat,
          lastMsg,
          lastInbound,
          overdue,
          pending,
          stressScore,
          needsReply: Boolean(needsReply),
          waitingTooLong: Boolean(waitingTooLong),
          priority: overdue * 3 + (waitingTooLong ? 2 : 0) + (needsReply ? 1 : 0),
          lastActivity: lastMsg?.timestamp ?? chat.messages[0]?.timestamp ?? new Date().toISOString(),
        }
      })
      .sort((a, b) => b.priority - a.priority || new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
  }, [chats, allCommitments])

  const waitingCount = threads.filter(t => t.needsReply).length
  const chatCount = Object.keys(chats).length

  return (
    <div className="flex flex-col h-full">
      {/* Hero header */}
      <div className="px-12 pt-10 pb-8 border-b border-border">
        <p className="text-[12px] text-muted-foreground mb-3">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="display-xl text-foreground">{greeting}</h1>
        <p className="mt-4 text-[17px] text-muted-foreground">
          {waitingCount > 0
            ? <><span className="font-semibold text-foreground">{waitingCount} {waitingCount === 1 ? 'person' : 'people'}</span> waiting for your reply.</>
            : chatCount > 0 ? 'All caught up.' : 'Import a conversation to get started.'
          }
        </p>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-muted-foreground/30 mb-6" strokeWidth={1} />
            <h2 className="text-[22px] font-semibold tracking-tight mb-3">Start with your last conversation.</h2>
            <p className="text-[15px] text-muted-foreground mb-8 max-w-sm">
              Export a WhatsApp chat and import it. VAC will read the context and start helping immediately.
            </p>
            <label className="btn-pill bg-foreground text-background hover:opacity-90 cursor-pointer">
              <Upload className="h-4 w-4" strokeWidth={1.6} />
              Import conversation
            </label>
            <p className="mt-4 text-[12px] text-muted-foreground">WhatsApp → open chat → ⋮ → More → Export (without media)</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {threads.map(({ chat, lastMsg, overdue, pending, stressScore, needsReply, waitingTooLong }) => (
              <button
                key={chat.id}
                onClick={() => { setActiveId(chat.id); navigate(`/c/${chat.id}`) }}
                className="w-full flex items-center gap-4 px-12 py-5 text-left hover:bg-secondary/40 transition-colors group"
              >
                {/* Avatar */}
                <div className={`h-11 w-11 rounded-full flex items-center justify-center text-[15px] font-semibold shrink-0 ${needsReply ? 'bg-foreground text-background' : 'bg-secondary text-foreground'}`}>
                  {chat.label?.charAt(0)?.toUpperCase() ?? '?'}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className={`text-[14px] font-medium truncate ${needsReply ? 'text-foreground' : 'text-foreground/70'}`}>
                      {chat.label}
                    </p>
                    {overdue > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive shrink-0">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        {overdue} overdue
                      </span>
                    )}
                    {pending > 0 && overdue === 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground shrink-0">
                        <Clock className="h-2.5 w-2.5" />
                        {pending}
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] text-muted-foreground truncate">
                    {lastMsg?.body?.slice(0, 80) ?? 'No messages'}
                  </p>
                </div>

                {/* Right side */}
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <p className="text-[11px] text-muted-foreground">
                    {lastMsg?.timestamp ? timeAgo(lastMsg.timestamp) : ''}
                  </p>
                  <div className="flex items-center gap-2">
                    <ToneChip score={stressScore} />
                    {needsReply && (
                      <span className="h-2 w-2 rounded-full bg-accent" />
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
